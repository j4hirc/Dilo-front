import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import Swal from 'sweetalert2';
import { NgSelectModule } from '@ng-select/ng-select';

enum VoiceStep {
  OFF = 'OFF',
  INICIANDO = 'INICIANDO',
  ESCUCHA_LIBRE = 'ESCUCHA_LIBRE',
  ELEGIR_OPCION = 'ELEGIR_OPCION',
  CONFIRMAR = 'CONFIRMAR'
}

@Component({
  selector: 'app-facturas',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
  templateUrl: './facturas.html',
  styleUrls: ['./facturas.css'],
})
export class Facturas implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  facturas: any[] = [];
  facturasBase: any[] = []; // Guarda la lista original para el buscador
  terminoBusqueda: string = ''; // La variable que pide el HTML
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = environment.apiUrl;
  private groqApiKey = environment.groqApiKey;

  ivaActual: number = 0.15;

  showModal = false;
  showPreviewFactura = false;
  isLoadingPreview = false;
  facturaPreview: any = null;
  isSaving = false;

  clientesList: any[] = [];
  productosList: any[] = [];
  bodegasList: any[] = [];
  inventarioList: any[] = [];

  terminoBusquedaCliente: string = '';
  clientesFiltrados: any[] = [];
  mostrarDropdownClientes = false;
  clienteSeleccionadoInfo: any = null;
  esConsumidorFinal: boolean = false;

  // 🔥 NUEVO ESTADO DE LA FACTURA BLINDADO
  nuevaFactura: any = {
    clienteId: null,
    metodoPago: 'EFECTIVO',
    numeroCuotas: 0,
    detallesTarjeta: '',
    descuentoGlobal: 0,
    descuentoGlobalPorcentaje: 0,
    detalles: []
  };

  itemTemp: any = {
    productoId: null,
    bodegaId: null,
    cantidad: null,
    descuento: null,
    descuentoPorcentaje: null,
    productoNombre: ''
  };

  voiceState: VoiceStep = VoiceStep.OFF;
  voiceMessage: string = '';
  userTranscript: string = '';
  transcriptAcumulado: string = '';
  isListening: boolean = false;
  isThinking: boolean = false;
  private recognition: any;
  private silenceTimer: any;
  opcionesVoz: any[] = [];
  tipoOpciones: 'CLIENTE' | 'BODEGA' | 'PRODUCTO' | null = null;
  metodoPagoConfirmado: boolean = false;
  quiereEmitirPendiente: boolean = false;
  private itemsVozPendientes: any[] = [];
  private datosVozPendientes: any = null;
  private ultimaFraseUsuario: string = '';
  private bloqueoEscucha = false;
  private seleccionEnCurso = false;
  /** Producto esperando que el usuario elija bodega */
  private productoPendienteBodega: any = null;
  private itemPendienteBodega: any = null;
  private esperandoBodega = false;
  /** Hasta este timestamp (ms) se ignora el mic: evita eco de la propia voz de Zoe */
  private silencioPostHablaUntil = 0;
  private ultimoTextoHablado = '';
  /** Bodega dicha en la frase → se reutiliza para todos los productos de ese comando */
  private bodegaPreferidaVoz: any = null;

  private precioParaFactura(producto: any): number {
    const costo = Number(producto?.costoPromedioActual ?? producto?.costoPromedio ?? 0);
    if (costo > 0) return costo;
    return Number(producto?.precioUnitario ?? producto?.precio ?? 0);
  }

  get subtotalCarrito(): number {
    return this.nuevaFactura.detalles.reduce((sum: number, item: any) => sum + (Number(item.subtotal) || 0), 0);
  }

  get descuentoGlobalMonto(): number {
    const pct = Number(this.nuevaFactura.descuentoGlobalPorcentaje || 0);
    if (pct > 0) {
      return Math.min((this.subtotalCarrito * pct) / 100, this.subtotalCarrito);
    }
    return Math.min(Number(this.nuevaFactura.descuentoGlobal || 0), this.subtotalCarrito);
  }

  get subtotalGravado(): number {
    return this.nuevaFactura.detalles
      .filter((d: any) => d.grabaIva)
      .reduce((s: number, d: any) => s + (Number(d.subtotal) || 0), 0);
  }

  get subtotalExento(): number {
    return this.nuevaFactura.detalles
      .filter((d: any) => !d.grabaIva)
      .reduce((s: number, d: any) => s + (Number(d.subtotal) || 0), 0);
  }

  get baseImponible(): number {
    const desc = this.descuentoGlobalMonto;
    const totalBruto = this.subtotalCarrito;
    if (totalBruto <= 0) return 0;
    const gravado = this.subtotalGravado;
    const descSobreGravado = desc * (gravado / totalBruto);
    return Math.max(0, gravado - descSobreGravado);
  }

  get baseExenta(): number {
    const desc = this.descuentoGlobalMonto;
    const totalBruto = this.subtotalCarrito;
    if (totalBruto <= 0) return 0;
    const exento = this.subtotalExento;
    const descSobreExento = desc * (exento / totalBruto);
    return Math.max(0, exento - descSobreExento);
  }

  get montoIva(): number {
    return this.baseImponible * this.ivaActual;
  }

  get subtotalSinIva(): number {
    return this.baseImponible + this.baseExenta;
  }

  get totalCarrito(): number {
    const total = this.subtotalSinIva + this.montoIva;
    return total > 0 ? total : 0;
  }

  get stockDisponible(): number | null {
    return this.obtenerStock(this.itemTemp.productoId, this.itemTemp.bodegaId);
  }

  private obtenerStock(productoId: any, bodegaId: any): number | null {
    if (!productoId || !bodegaId) return null;
    const inv = this.inventarioList.find(i =>
      (i.productoId === productoId || i.producto?.id === productoId) &&
      (i.bodegaId === bodegaId || i.bodega?.id === bodegaId)
    );

    return inv ? Number(inv.cantidadActual || inv.cantidad || inv.stock || 0) : 0;
  }

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;

    this.cargarIvaDelSistema();

    if (this.negocioId) {
      this.cargarTodasLasFacturas(this.negocioId);
    } else {
      this.isLoading = false;
    }

    this.initSpeechRecognition();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  ngOnDestroy(): void {
    this.cancelarAsistenteVoz();
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cargarIvaDelSistema() {
    this.http.get<any>(`${this.apiUrl}/parametros/iva`, { headers: this.getAuthHeaders() }).subscribe({
      next: (res) => {
        if (res && res.ivaActual) {
          this.ivaActual = parseFloat(res.ivaActual);
        }
      },
      error: (err) => {
        console.warn("No se pudo cargar el IVA, usando 15%", err);
      }
    });
  }

  cargarTodasLasFacturas(id: number) {
    this.isLoading = true;
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers: this.getAuthHeaders() }).subscribe({
      next: (data) => {
        const arregloSeguro = Array.isArray(data) ? data : [];
        this.facturas = arregloSeguro.map(f => ({
          id: f.id,
          numero: f.numeroFactura || 'S/N',
          cliente: f.clienteNombre || f.cliente?.nombre || f.cliente?.razonSocial || 'Consumidor Final',
          tipo: f.formaPago || 'Manual',
          fecha: f.fechaEmision || new Date().toLocaleDateString(),
          monto: Number(f.totalFactura || f.total || 0),
          estado: f.estadoSri || 'Emitida',
          descuentoGlobal: Number(f.totalDescuento || f.descuentoGlobal || 0),
          subtotalIva0: Number(f.subtotalIva0 || 0),
          subtotalIvaAplicado: Number(f.subtotalIvaAplicado || 0),
          totalIva: Number(f.totalIva || 0),
          porcentajeIva: Number(f.porcentajeIvaAplicado || (this.ivaActual * 100)),
          detalles: (f.detallesFactura || f.detalles || f.items || []).map((d: any) => ({
            productoId: d.productoId ?? d.producto?.id,
            productoNombre: d.productoNombre || d.producto?.nombre || d.descripcion || d.nombre || 'Producto',
            bodegaNombre: d.bodegaNombre || d.bodega?.nombre || '',
            cantidad: Number(d.cantidad ?? 1),
            precioUnitario: Number(d.precioUnitario ?? d.precio ?? 0),
            descuento: Number(d.descuento ?? 0),
            subtotal: Number(d.subtotal ?? d.subtotalItem ?? 0),
            grabaIva: !!(d.grabaIva ?? d.producto?.grabaIva)
          }))
        }));

        this.facturasBase = [...this.facturas]; // 🔥 NUEVO: Guardamos la original para buscar

        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => this.isLoading = false
    });
  }

  buscarFacturas() {
    if (!this.terminoBusqueda.trim()) {
      this.facturas = [...this.facturasBase];
      return;
    }
    const term = this.terminoBusqueda.toLowerCase().trim();
    this.facturas = this.facturasBase.filter(f =>
      f.numero.toLowerCase().includes(term) ||
      f.cliente.toLowerCase().includes(term)
    );
  }

  abrirModalNuevo(porVoz = false) {
    this.showModal = true;
    this.cdr.detectChanges();

    this.cargarCatalogos();
    this.nuevaFactura = { clienteId: null, metodoPago: 'EFECTIVO', numeroCuotas: 0, detallesTarjeta: '', descuentoGlobal: 0, descuentoGlobalPorcentaje: 0, detalles: [] };
    this.itemTemp = { productoId: null, bodegaId: null, cantidad: null, descuento: null, descuentoPorcentaje: null, productoNombre: '' };
    this.terminoBusquedaCliente = '';
    this.clienteSeleccionadoInfo = null;
    this.mostrarDropdownClientes = false;
    this.esConsumidorFinal = false;

    this.opcionesVoz = [];
    this.tipoOpciones = null;
    this.metodoPagoConfirmado = false;
    this.quiereEmitirPendiente = false;
    this.itemsVozPendientes = [];
    this.datosVozPendientes = null;
    this.ultimaFraseUsuario = '';
    this.bloqueoEscucha = false;
    this.seleccionEnCurso = false;
    this.productoPendienteBodega = null;
    this.itemPendienteBodega = null;
    this.esperandoBodega = false;
    this.silencioPostHablaUntil = 0;
    this.ultimoTextoHablado = '';
    this.bodegaPreferidaVoz = null;

    if (porVoz) {
      window.speechSynthesis.resume();
      window.speechSynthesis.cancel();
      this.iniciarFacturaPorVoz();
    } else {
      this.voiceState = VoiceStep.OFF;
    }
  }

  cerrarModal() {
    this.showModal = false;
    this.cancelarAsistenteVoz();
  }

  customProductSearch(term: string, item: any) {
    term = term.toLowerCase();
    const nombre = item.nombre ? item.nombre.toLowerCase() : '';
    const codigo = item.codigoPrincipal ? String(item.codigoPrincipal).toLowerCase() : '';

    return nombre.includes(term) || codigo.includes(term);
  }

  cargarCatalogos() {
    if (!this.negocioId) return;
    const headers = this.getAuthHeaders();

    forkJoin([
      this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/clientes`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/productos`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/inventario`, { headers }).pipe(catchError(() => of([])))
    ]).subscribe(([clientes, productos, bodegas, inventario]) => {
      this.clientesList = Array.isArray(clientes) ? clientes : [];
      this.clientesFiltrados = [...this.clientesList];
      // PVP + costo promedio (el backend guarda el costo en el detalle de factura)
      this.productosList = (Array.isArray(productos) ? productos : []).map((p: any) => {
        const precioUnitario = Number(p.precioUnitario ?? p.precio ?? 0);
        const costoPromedioActual = Number(p.costoPromedioActual ?? p.costoPromedio ?? 0);
        return {
          ...p,
          precioUnitario,
          costoPromedioActual,
          // Precio visible en factura = costo promedio (o PVP si no hay)
          precioFactura: costoPromedioActual > 0 ? costoPromedioActual : precioUnitario,
          grabaIva: !!p.grabaIva
        };
      });
      this.bodegasList = Array.isArray(bodegas) ? bodegas : [];
      this.inventarioList = Array.isArray(inventario) ? inventario : [];
      this.cdr.detectChanges();
    });
  }

  setConsumidorFinal() {
    this.esConsumidorFinal = true;
    this.nuevaFactura.clienteId = null;
    this.clienteSeleccionadoInfo = {
      nombreCompleto: 'Consumidor Final',
      dni: '9999999999999',
      email: 'N/A'
    };
    this.terminoBusquedaCliente = 'Consumidor Final';
    this.mostrarDropdownClientes = false;
    // Consumidor final NO puede pagar con tarjeta
    this.bloquearTarjetaSiConsumidorFinal(true);
    this.cdr.detectChanges();
  }

  /** Tarjeta solo con cliente registrado (no consumidor final) */
  get permiteTarjetaCredito(): boolean {
    return !this.esConsumidorFinal && !!this.nuevaFactura.clienteId;
  }

  /** Con tarjeta de crédito las cuotas son obligatorias (>= 1). */

  get previewSubtotal(): number {
    const d = this.facturaPreview?.detalles || [];
    return d.reduce((s: number, x: any) => s + Number(x.subtotal || 0), 0);
  }

  get cuotasTarjetaValidas(): boolean {
    if (this.nuevaFactura.metodoPago !== 'TARJETA_CREDITO') return true;
    const n = Number(this.nuevaFactura.numeroCuotas);
    return Number.isFinite(n) && n >= 1;
  }

  /** Valida reglas de tarjeta antes de emitir. Devuelve mensaje de error o null si OK. */
  private validarTarjetaAntesDeEmitir(): string | null {
    if (this.nuevaFactura.metodoPago !== 'TARJETA_CREDITO') return null;
    if (!this.permiteTarjetaCredito) {
      return 'Tarjeta de crédito solo con cliente registrado (no Consumidor Final).';
    }
    if (!this.cuotasTarjetaValidas) {
      return 'Indica el número de cuotas (meses) antes de emitir con tarjeta de crédito.';
    }
    return null;
  }

  /** Limpia campos de tarjeta y fuerza efectivo */
  private forzarEfectivoPorTarjetaInvalida(avisar = false, motivo?: string): void {
    this.nuevaFactura.metodoPago = 'EFECTIVO';
    this.nuevaFactura.numeroCuotas = 0;
    this.nuevaFactura.detallesTarjeta = '';
    this.nuevaFactura.tarjetaNumero = '';
    this.nuevaFactura.tarjetaVence = '';
    this.nuevaFactura.tarjetaCvc = '';
    this.metodoPagoConfirmado = true;
    if (avisar) {
      Swal.fire({
        icon: 'warning',
        title: 'Tarjeta no permitida',
        text: motivo || 'Selecciona un cliente registrado para pagar con tarjeta. Consumidor Final solo admite efectivo o transferencia.',
        confirmButtonColor: '#ed8936'
      });
    }
  }

  private bloquearTarjetaSiConsumidorFinal(avisar = false): boolean {
    if (this.nuevaFactura.metodoPago !== 'TARJETA_CREDITO') return false;
    if (this.esConsumidorFinal) {
      this.forzarEfectivoPorTarjetaInvalida(
        avisar,
        'Con Consumidor Final solo se puede pagar en efectivo o transferencia. Elige un cliente registrado para usar tarjeta de crédito.'
      );
      return true;
    }
    if (!this.nuevaFactura.clienteId) {
      this.forzarEfectivoPorTarjetaInvalida(
        avisar,
        'Selecciona primero un cliente registrado para pagar con tarjeta de crédito.'
      );
      return true;
    }
    return false;
  }

  onMetodoPagoChange() {
    if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO' && !this.permiteTarjetaCredito) {
      const motivo = this.esConsumidorFinal
        ? 'Consumidor Final no puede pagar con tarjeta de crédito. Usa efectivo o transferencia, o selecciona un cliente registrado.'
        : 'Selecciona primero un cliente registrado para pagar con tarjeta.';
      this.forzarEfectivoPorTarjetaInvalida(true, motivo);
    } else {
      this.metodoPagoConfirmado = true;
    }
    this.cdr.detectChanges();
  }


  private aplicarMetodoPagoSeguro(metodo: string | null | undefined, mensajesAlerta: string[], esperarCliente = false): 'ok' | 'bloqueado' | 'pendiente' {
    if (!metodo || metodo === 'null' || metodo === 'NULL') return 'ok';
    const m = String(metodo).toUpperCase();
    if (m === 'TARJETA_CREDITO' || m.includes('TARJETA')) {
      if (this.esConsumidorFinal) {
        this.nuevaFactura.metodoPago = 'EFECTIVO';
        this.metodoPagoConfirmado = true;
        mensajesAlerta.push('tarjeta no permitida con Consumidor Final; usé efectivo');
        return 'bloqueado';
      }
      if (!this.nuevaFactura.clienteId) {
        if (esperarCliente) {
          // El cliente se resuelve más abajo en el mismo comando
          return 'pendiente';
        }
        this.nuevaFactura.metodoPago = 'EFECTIVO';
        this.metodoPagoConfirmado = true;
        mensajesAlerta.push('tarjeta requiere cliente registrado; usé efectivo');
        return 'bloqueado';
      }
      this.nuevaFactura.metodoPago = 'TARJETA_CREDITO';
      this.metodoPagoConfirmado = true;
      return 'ok';
    }
    if (m === 'TRANSFERENCIA' || m.includes('TRANSFER')) {
      this.nuevaFactura.metodoPago = 'TRANSFERENCIA';
      this.metodoPagoConfirmado = true;
      return 'ok';
    }
    if (m === 'EFECTIVO' || m.includes('EFECTIVO') || m.includes('CASH')) {
      this.nuevaFactura.metodoPago = 'EFECTIVO';
      this.metodoPagoConfirmado = true;
      return 'ok';
    }
    return 'ok';
  }

  private limpiarTexto(texto: any): string {
    if (!texto) return '';
    return String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  private buscarClientesUniversales(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    if (!txt) return [...this.clientesList];

    const soloDigitos = txt.replace(/\D/g, '');

    // Cédula / RUC completo o parcial (últimos 3+ dígitos)
    if (soloDigitos.length >= 3) {
      const porDoc = this.clientesList.filter(cli => {
        const doc = String(cli.dni || cli.identificacion || '').replace(/\D/g, '');
        if (!doc) return false;
        if (doc === soloDigitos) return true;
        if (soloDigitos.length >= 3 && doc.endsWith(soloDigitos)) return true;
        if (soloDigitos.length >= 5 && doc.includes(soloDigitos)) return true;
        return false;
      });
      if (porDoc.length > 0) return porDoc;
    }

    // Extraer dígitos embebidos en la frase ("cliente 123", "cedula termina en 456")
    const digitosEnFrase = txt.match(/\d{3,13}/g) || [];
    for (const d of digitosEnFrase) {
      const porFin = this.clientesList.filter(cli => {
        const doc = String(cli.dni || cli.identificacion || '').replace(/\D/g, '');
        return doc && (doc === d || doc.endsWith(d));
      });
      if (porFin.length > 0) return porFin;
    }

    let exact = this.clientesList.filter(cli =>
      this.limpiarTexto(cli.nombreCompleto) === txt || this.limpiarTexto(cli.primerNombre) === txt ||
      this.limpiarTexto(cli.apellidoPaterno) === txt || this.limpiarTexto(cli.dni) === txt ||
      this.limpiarTexto(cli.identificacion) === txt || this.limpiarTexto(cli.email) === txt || this.limpiarTexto(cli.correo) === txt
    );
    if (exact.length > 0) return exact;

    let partial = this.clientesList.filter(cli => {
      const nom = this.limpiarTexto(cli.nombreCompleto || `${cli.primerNombre || ''} ${cli.apellidoPaterno || ''}`);
      const doc = this.limpiarTexto(cli.dni || cli.identificacion || '');
      const corr = this.limpiarTexto(cli.email || cli.correo || '');
      return nom.includes(txt) || txt.includes(nom) || (doc && doc.includes(txt)) || (corr && corr.includes(txt));
    });
    if (partial.length > 0) return partial;

    const palabras = txt.split(' ').filter(p => p.length > 2 && !/^\d+$/.test(p));
    if (palabras.length === 0) return [];
    return this.clientesList.filter(cli => {
      const nom = this.limpiarTexto(cli.nombreCompleto || `${cli.primerNombre || ''} ${cli.apellidoPaterno || ''}`);
      return palabras.every(pal => nom.includes(pal));
    });
  }

  filtrarClientes() {
    this.clientesFiltrados = this.buscarClientesUniversales(this.terminoBusquedaCliente);
  }

  seleccionarCliente(cliente: any) {
    if (!cliente) return;
    this.esConsumidorFinal = false;
    this.nuevaFactura.clienteId = cliente.id;
    this.clienteSeleccionadoInfo = cliente;
    this.terminoBusquedaCliente = cliente.nombreCompleto || `${cliente.primerNombre || ''} ${cliente.apellidoPaterno || ''}`.trim();
    this.mostrarDropdownClientes = false;
    // Al elegir cliente real, tarjeta vuelve a estar permitida (si el usuario la eligió)
    this.cdr.detectChanges();
  }

  limpiarClienteSeleccionado() {
    this.nuevaFactura.clienteId = null;
    this.esConsumidorFinal = false;
    this.clienteSeleccionadoInfo = null;
    this.terminoBusquedaCliente = '';
    this.clientesFiltrados = [...this.clientesList];
    // Sin cliente → no se puede mantener tarjeta
    if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO') {
      this.forzarEfectivoPorTarjetaInvalida(false);
    }
    this.cdr.detectChanges();
  }

  initSpeechRecognition() {
    const { webkitSpeechRecognition } = window as any;
    if (!webkitSpeechRecognition) return;

    this.recognition = new webkitSpeechRecognition();
    this.recognition.lang = 'es-EC';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event: any) => {
      // Ignorar 100% mientras habla, piensa, elige o en cooldown anti-eco
      if (this.bloqueoEscucha || this.seleccionEnCurso || this.isThinking || !this.isListening) {
        this.transcriptAcumulado = '';
        this.userTranscript = '';
        return;
      }
      if (Date.now() < this.silencioPostHablaUntil) {
        this.transcriptAcumulado = '';
        this.userTranscript = '';
        return;
      }

      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript + ' ';
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (final) {
        this.transcriptAcumulado += final;
      }

      this.userTranscript = (this.transcriptAcumulado + interim).toLowerCase().trim().replace(/\.$/, '');
      this.cdr.detectChanges();

      clearTimeout(this.silenceTimer);
      const espera = this.voiceState === VoiceStep.ELEGIR_OPCION ? 1400 : 2800;
      this.silenceTimer = setTimeout(() => {
        if (this.bloqueoEscucha || this.seleccionEnCurso || this.isThinking || !this.isListening) return;
        if (Date.now() < this.silencioPostHablaUntil) return;
        try { this.recognition.stop(); } catch (e) { }
        if (this.userTranscript) {
          this.isListening = false;
          const txt = this.userTranscript.trim();
          if (this.esEcoDeLoHablado(txt)) {
            this.transcriptAcumulado = '';
            this.userTranscript = '';
            this.escuchar();
            return;
          }
          const palabras = txt.split(/\s+/);
          const fraseUtil = palabras.length > 28 ? palabras.slice(-28).join(' ') : txt;
          this.procesarComandoVoz(fraseUtil);
        } else if (!this.bloqueoEscucha) {
          this.escuchar();
        }
      }, espera);
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        this.isListening = false;
        Swal.fire('Micrófono bloqueado', 'Permite el acceso al micrófono en el navegador.', 'error');
        this.cancelarAsistenteVoz();
      }
    };

    this.recognition.onend = () => {
      // No reiniciar durante cooldown anti-eco / bloqueo
      if (Date.now() < this.silencioPostHablaUntil) {
        this.isListening = false;
        this.cdr.detectChanges();
        return;
      }
      if (
        this.voiceState !== VoiceStep.OFF &&
        !this.isThinking &&
        !this.bloqueoEscucha &&
        !this.seleccionEnCurso &&
        this.isListening
      ) {
        try { this.recognition.start(); } catch (e) { }
      } else {
        this.isListening = false;
        this.cdr.detectChanges();
      }
    };
  }

  iniciarFacturaPorVoz() {
    if (!this.recognition) return;
    this.transcriptAcumulado = '';
    this.voiceState = VoiceStep.ESCUCHA_LIBRE;

    if (!this.nuevaFactura.clienteId && !this.esConsumidorFinal) {
      this.voiceMessage = "¿A quién le facturamos y qué le agregamos?";
    } else if (!this.metodoPagoConfirmado) {
      this.voiceMessage = "Cliente listo. ¿Con qué paga?";
    } else {
      this.voiceMessage = "¿Qué productos deseas agregar o modificar?";
    }

    this.cdr.detectChanges();
    this.escuchar();
  }

  cancelarAsistenteVoz() {
    this.voiceState = VoiceStep.OFF;
    this.isListening = false;
    this.isThinking = false;
    this.bloqueoEscucha = false;
    this.seleccionEnCurso = false;
    this.transcriptAcumulado = '';
    this.userTranscript = '';
    this.productoPendienteBodega = null;
    this.itemPendienteBodega = null;
    this.esperandoBodega = false;
    this.silencioPostHablaUntil = 0;
    this.ultimoTextoHablado = '';
    this.bodegaPreferidaVoz = null;
    this.opcionesVoz = [];
    this.tipoOpciones = null;
    clearTimeout(this.silenceTimer);
    window.speechSynthesis.cancel();
    if (this.recognition) {
      try { this.recognition.abort(); } catch (e) { }
    }
    this.cdr.detectChanges();
  }

  private pausarMicYVoz() {
    this.bloqueoEscucha = true;
    this.isListening = false;
    this.isThinking = true;
    this.transcriptAcumulado = '';
    this.userTranscript = '';
    clearTimeout(this.silenceTimer);
    window.speechSynthesis.cancel();
    if (this.recognition) {
      try { this.recognition.abort(); } catch (e) { }
    }
    this.cdr.detectChanges();
  }

  /** Solo voces de mujer en español. Nunca masculinas. */
  private seleccionarVozFemenina(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const vocesEspañol = (voices || []).filter(v =>
      v.lang && v.lang.toLowerCase().startsWith('es') &&
      !/pablo|jorge|diego|carlos|juan|pedro|antonio|male|hombre|david|boy/i.test(v.name)
    );

    if (!vocesEspañol.length) {
      return (voices || []).find(v => /female|mujer|woman/i.test(v.name) || !/male|hombre|boy/i.test(v.name)) || voices[0] || null;
    }

    // PRIORIDAD 1: Voces Neurales/Naturales (Edge, Windows 11). Son las más humanas.
    const vozNeural = vocesEspañol.find(v =>
      (/natural|neural|online/i.test(v.name)) &&
      /mia|elvira|dalia|paloma|elena|camila|lucrecia|salome|ximena/i.test(v.name)
    );
    if (vozNeural) return vozNeural;

    // PRIORIDAD 2: Voces de Apple/iOS (Premium o de alta calidad nativa)
    const vozApple = vocesEspañol.find(v =>
      (/premium|enhanced/i.test(v.name)) ||
      /m[oó]nica|paulina|luc[ií]a|mar[ií]a|isabel|sofia|laura|victoria/i.test(v.name)
    );
    if (vozApple) return vozApple;

    // PRIORIDAD 3: Voces de Google (Chrome)
    const vozGoogle = vocesEspañol.find(v => v.name.toLowerCase().includes('google'));
    if (vozGoogle) return vozGoogle;

    // PRIORIDAD 4: Genéricas
    const vozFemeninaGenerica = vocesEspañol.find(v => /female|mujer/i.test(v.name));
    if (vozFemeninaGenerica) return vozFemeninaGenerica;

    // FALLBACK
    return vocesEspañol[0];
  }

  /** Aplica voz de mujer a cualquier utterance (forzado) y corrige el tono. */
  private aplicarVozMujer(utterance: SpeechSynthesisUtterance): void {
    const voices = window.speechSynthesis.getVoices() || [];
    const female = this.seleccionarVozFemenina(voices);
    if (female) {
      utterance.voice = female;
      utterance.lang = female.lang || 'es-EC';
    } else {
      utterance.lang = 'es-EC';
    }
    // DEBE SER 1.0. Si lo subes, las voces naturales se rompen y suenan robóticas.
    utterance.pitch = 1.0;
  }

  /** ¿El transcript parece eco de lo que Zoe acaba de decir? */
  private esEcoDeLoHablado(transcript: string): boolean {
    const t = this.limpiarTexto(transcript);
    const h = this.limpiarTexto(this.ultimoTextoHablado || this.voiceMessage || '');
    if (!t) return false;

    // Frases típicas que Zoe dice al final → eco casi seguro
    if (/^(listo|total|que mas|que m[aá]s|agregu[eé]|desde|emitiendo|cuota|no encontr|no pude|dime el|di el|ok no emit)/.test(t)
      && t.split(/\s+/).length <= 14) {
      return true;
    }
    // "listo total ... que mas" completo
    if (/\blisto\b/.test(t) && /\btotal\b/.test(t) && t.split(/\s+/).length <= 16) return true;
    if (/\bemitiendo\b/.test(t) && t.split(/\s+/).length <= 8) return true;

    if (!h) return false;
    if (t === h) return true;
    if (t.length >= 5 && (h.includes(t) || t.includes(h.slice(0, Math.min(55, h.length))))) return true;

    const wordsT = t.split(/\s+/).filter(w => w.length > 2);
    const wordsH = new Set(h.split(/\s+/).filter(w => w.length > 2));
    if (wordsT.length >= 2) {
      const comunes = wordsT.filter(w => wordsH.has(w)).length;
      if (comunes / wordsT.length >= 0.4) return true;
      if (comunes >= 2) return true;
    }
    // Ventana post-habla: frases cortas con 1+ palabra en común = eco
    if (Date.now() < this.silencioPostHablaUntil + 600 && wordsT.length <= 6) {
      const comunes = wordsT.filter(w => wordsH.has(w)).length;
      if (comunes >= 1) return true;
    }
    return false;
  }

  private hablar(texto: string, callback?: () => void) {
    // Mic OFF total mientras habla + cooldown largo (anti-eco máximo)
    this.bloqueoEscucha = true;
    this.isListening = false;
    this.isThinking = true;
    this.ultimoTextoHablado = texto || '';
    clearTimeout(this.silenceTimer);
    this.transcriptAcumulado = '';
    this.userTranscript = '';
    window.speechSynthesis.cancel();
    if (this.recognition) {
      try { this.recognition.abort(); } catch (e) { }
      try { this.recognition.stop(); } catch (e) { }
    }
    // Bloquear resultados desde YA (antes de que termine de hablar)
    this.silencioPostHablaUntil = Date.now() + 60000;

    let yaTermino = false;
    const fin = () => {
      if (yaTermino) return;
      yaTermino = true;
      this.isThinking = false;
      this.bloqueoEscucha = true;
      this.isListening = false;
      this.transcriptAcumulado = '';
      this.userTranscript = '';
      // Cooldown anti-eco ~2.4s tras terminar de hablar
      this.silencioPostHablaUntil = Date.now() + 2400;
      this.cdr.detectChanges();

      if (this.voiceState === VoiceStep.OFF) {
        this.bloqueoEscucha = false;
        return;
      }

      // Pausa ~2.2s + abort residual antes de abrir mic
      setTimeout(() => {
        if (this.voiceState === VoiceStep.OFF) return;
        if (this.recognition) {
          try { this.recognition.abort(); } catch (e) { }
        }
        this.transcriptAcumulado = '';
        this.userTranscript = '';
        this.cdr.detectChanges();
        if (this.seleccionEnCurso) return;
        setTimeout(() => {
          if (this.voiceState === VoiceStep.OFF) return;
          this.transcriptAcumulado = '';
          this.userTranscript = '';
          this.bloqueoEscucha = false;
          this.cdr.detectChanges();
          if (callback) callback();
          else this.escuchar();
        }, 250);
      }, 2200);
    };

    setTimeout(() => {
      if (this.voiceState === VoiceStep.OFF) {
        fin();
        return;
      }

      this.voiceMessage = texto;
      this.userTranscript = '';
      this.cdr.detectChanges();

      const utterance = new SpeechSynthesisUtterance(texto);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 0.82;

      this.aplicarVozMujer(utterance);
      utterance.onend = fin;
      utterance.onerror = fin;

      const msSeguro = Math.min(18000, Math.max(2800, texto.length * 70));
      setTimeout(fin, msSeguro);

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        fin();
      }
    }, 100);
  }

  private escuchar() {
    if (
      this.voiceState === VoiceStep.OFF ||
      this.voiceState === VoiceStep.INICIANDO ||
      this.bloqueoEscucha ||
      this.seleccionEnCurso
    ) {
      return;
    }
    if (Date.now() < this.silencioPostHablaUntil) {
      // Aún en cooldown anti-eco → reintentar cuando pase
      const falta = this.silencioPostHablaUntil - Date.now() + 30;
      setTimeout(() => this.escuchar(), Math.max(50, falta));
      return;
    }
    this.isThinking = false;
    this.isListening = true;
    this.cdr.detectChanges();
    try { this.recognition.start(); } catch (e) { }
  }

  /** Público: botones del panel Zoe y reconocimiento de voz */
  procesarComandoVoz(transcript: string) {
    this.transcriptAcumulado = '';
    const transcriptLimpio = this.limpiarTexto(transcript).replace(/[.,;:!?¡¿]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Seguridad anti-eco
    if (this.esEcoDeLoHablado(transcriptLimpio)) {
      this.userTranscript = '';
      this.escuchar();
      return;
    }
    // Nueva frase: bodega solo si la menciona ahora
    this.bodegaPreferidaVoz = this.resolverBodegaDesdeFrase(transcriptLimpio);
    if (!transcriptLimpio) {
      this.escuchar();
      return;
    }

    const comandosLimpiar = ['borra todo', 'borrar todo', 'limpiar carrito', 'reiniciar', 'vaciar ticket', 'cancela todo', 'limpia todo', 'empezar de cero'];
    if (comandosLimpiar.some(cmd => transcriptLimpio.includes(cmd))) {
      this.nuevaFactura.detalles = [];
      this.limpiarClienteSeleccionado();
      this.nuevaFactura.descuentoGlobal = 0;
      this.nuevaFactura.descuentoGlobalPorcentaje = 0;
      this.nuevaFactura.detallesTarjeta = '';
      this.nuevaFactura.numeroCuotas = 0;
      this.metodoPagoConfirmado = false;
      this.hablar("Ticket vacío. Empecemos de cero.", () => this.escuchar());
      return;
    }

    // Desambiguación por número/clic: NO mandar a Groq
    if (this.voiceState === VoiceStep.ELEGIR_OPCION) {
      this.manejarDesambiguacion(transcriptLimpio);
      return;
    }

    // Confirmación de emisión: sí / no / emite
    if (this.voiceState === VoiceStep.CONFIRMAR) {
      if (this.esRespuestaAfirmativa(transcriptLimpio) || this.esComandoEmitirFuerte(transcriptLimpio)) {
        this.emitirFacturaPorVoz();
        return;
      }
      if (this.esRespuestaNegativa(transcriptLimpio)) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar("Ok, no emitimos. ¿Qué más?", () => this.escuchar());
        return;
      }
      // No es sí/no: puede estar cambiando algo → salir de confirmar y analizar
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
    }

    // Emitir DIRECTO solo con comando explícito (nunca por "listo" / eco de Zoe)
    if (this.esSoloEmitirCorto(transcriptLimpio) || (
      this.esComandoEmitirFuerte(transcriptLimpio)
      && !this.fraseMencionaProducto(transcriptLimpio)
      && !/\b(cliente|consumidor|tarjeta|cuotas?|meses?|transferencia|efectivo|descuento|agrega|pon|quita|elimina)\b/.test(transcriptLimpio)
    )) {
      this.emitirFacturaPorVoz();
      return;
    }

    // Solo intención de emitir si la frase trae verbo claro de emitir/cobrar
    const quiereEmitir = this.esComandoEmitirFuerte(transcriptLimpio);

    this.analizarConGroq(transcriptLimpio, quiereEmitir);
  }

  /** Frases cortas SOLO de emitir (sin "listo"/"ya" — provocan emisión por eco) */
  private esSoloEmitirCorto(texto: string): boolean {
    const t = (texto || '').trim();
    if (!t) return false;
    const exactas = [
      'emite', 'emitir', 'cobra', 'cobrar', 'emite ya', 'emitir ya', 'cobra ya', 'cobrar ya',
      'factura ya', 'emite la factura', 'emitir la factura', 'cobra la factura',
      'guarda la factura', 'guardar la factura', 'genera la factura', 'generar la factura',
      'listo emite', 'listo emitir', 'si emite', 'si emitir', 'si cobra',
      'emite por favor', 'emitir por favor', 'cobra por favor'
    ];
    if (exactas.some(e => t === e || t === e + ' por favor' || t === e + ' gracias')) return true;
    const palabras = t.split(/\s+/);
    if (palabras.length <= 6) {
      const tieneEmit = /\b(emite|emitir|cobra|cobrar)\b/.test(t)
        || /\b(guarda|guardar|genera|generar)\s+(la\s+)?factura\b/.test(t);
      const tieneExtra = /\b(agrega|agregar|pon|poner|cliente|producto|tarjeta|cuotas?|descuento|quita|elimina)\b/.test(t);
      if (tieneEmit && !tieneExtra) return true;
    }
    return false;
  }

  /** Emite la factura por voz con validaciones mínimas (sin pedir confirmación extra) */
  private emitirFacturaPorVoz() {
    // Evitar doble emisión
    if (this.isSaving) return;

    const faltaCliente = !this.nuevaFactura.clienteId && !this.esConsumidorFinal;
    const faltaItems = this.nuevaFactura.detalles.length === 0;

    if (faltaCliente) {
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
      this.hablar("Falta el cliente. ¿A quién le facturamos?", () => this.escuchar());
      return;
    }
    if (faltaItems) {
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
      this.hablar("El ticket está vacío. ¿Qué productos agregamos?", () => this.escuchar());
      return;
    }

    const errT = this.validarTarjetaAntesDeEmitir();
    if (errT) {
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
      this.hablar(errT + ' ¿Cuántas cuotas?', () => this.escuchar());
      return;
    }

    // Apagar mic TOTAL antes de hablar/emitir (evita eco al final)
    this.voiceState = VoiceStep.OFF;
    this.bloqueoEscucha = true;
    this.isListening = false;
    this.isThinking = false;
    this.silencioPostHablaUntil = Date.now() + 10000;
    clearTimeout(this.silenceTimer);
    if (this.recognition) {
      try { this.recognition.abort(); } catch (e) { }
      try { this.recognition.stop(); } catch (e) { }
    }
    this.voiceMessage = 'Emitiendo.';
    this.ultimoTextoHablado = 'Emitiendo.';
    this.cdr.detectChanges();
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('Emitiendo.');
      u.rate = 1.05;
      u.volume = 0.8;
      this.aplicarVozMujer(u);
      window.speechSynthesis.speak(u);
    } catch (e) { }
    setTimeout(() => { this.guardarFactura(); }, 280);
  }

  /** Botones del panel Zoe (Sí / No) */
  confirmarEmisionVoz() {
    this.emitirFacturaPorVoz();
  }

  cancelarEmisionVoz() {
    this.voiceState = VoiceStep.ESCUCHA_LIBRE;
    this.hablar("Ok, no emitimos. ¿Qué más?", () => this.escuchar());
  }

  /** Comandos claros de emitir/cobrar (verbos explícitos, no "listo" ni eco) */
  private esComandoEmitirFuerte(texto: string): boolean {
    const t = this.limpiarTexto(texto || '');
    if (!t) return false;
    // Debe haber verbo de emisión, no solo palabras sueltas de confirmación
    if (/\b(emite|emitir|cobra|cobrar)\b/.test(t)) return true;
    if (/\b(guarda|guardar|genera|generar|cierra|cerrar|saca|haz|hacer)\s+(la\s+)?factura\b/.test(t)) return true;
    if (/\bfactura\s+ya\b/.test(t) || /\bcobrar\s+ya\b/.test(t)) return true;
    return false;
  }

  /** Detecta afirmaciones de voz (sí, dale, ok, confirmo, etc.) */
  private esRespuestaAfirmativa(texto: string): boolean {
    const t = texto.trim();
    if (!t) return false;
    // Respuestas cortas exactas
    const exactas = ['si', 'sí', 'ok', 'okay', 'dale', 'claro', 'listo', 'confirmo', 'confirmado', 'de acuerdo', 'afirmativo', 'hazlo', 'emite', 'emitir', 'cobra', 'cobrar'];
    if (exactas.some(e => t === e || t === e + ' por favor' || t === e + ' gracias')) return true;
    // Frases típicas
    const frases = [
      'si por favor', 'si dale', 'si emite', 'si emitir', 'si cobra',
      'de una', 'de una vez', 'adelante', 'vamos', 'esta bien', 'esta bueno',
      'confirmamos', 'confirma', 'si confirma', 'si confirmo', 'si listo'
    ];
    if (frases.some(f => t.includes(f))) return true;
    // "si" como palabra completa (evita falsos positivos en otras palabras)
    if (/(^|\s)(si|sí)(\s|$)/.test(t) && t.length <= 40) return true;
    return false;
  }

  private esRespuestaNegativa(texto: string): boolean {
    const t = texto.trim();
    if (!t) return false;
    const neg = ['no', 'nop', 'nel', 'cancelar', 'cancela', 'espera', 'aun no', 'todavia no', 'todavía no', 'no emitas', 'no cobrar', 'revisar'];
    return neg.some(n => t === n || t.startsWith(n + ' ') || t.includes(n));
  }

  private analizarConGroq(fraseUsuario: string, quiereEmitirPalabra: boolean) {
    this.ultimaFraseUsuario = fraseUsuario || '';
    this.isThinking = true;
    this.cdr.detectChanges();

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    // Siempre permitir cambiar cliente por voz (null si no lo mencionó)
    const instruccionCliente = `"cliente": "Extrae el nombre/cédula si lo dijo, o 'CONSUMIDOR_FINAL' si dijo consumidor final; si NO habló de cliente → null",`;

    const listaNombresCli = this.clientesList.map(c => c.nombreCompleto || c.primerNombre).join(', ').substring(0, 800);
    const listaNombresProd = this.productosList.map(p => p.nombre).join(', ').substring(0, 900);

    const promptSystem = `
      Eres la IA de un POS en Ecuador. Extrae SOLO lo que el usuario dijo. JSON puro, sin markdown ni texto extra.
      Campos y valores en español.
      Clientes disponibles: [${listaNombresCli}]
      Productos disponibles: [${listaNombresProd}]

      Formato exacto:
      {
         ${instruccionCliente}
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | null,
         "detallesTarjeta": null,
         "cuotas": null,
         "descuentoGlobal": null,
         "descuentoGlobalPorcentaje": null,
         "items": [{"producto":"nombre","cantidad":1,"descuento":0,"descuentoPorcentaje":0}],
         "eliminarProducto": null,
         "modificarCantidad": null,
         "emitirFactura": false
      }

      REGLAS (no inventes nada):
      1. metodoPago: SOLO si dijo efectivo/contado, transferencia/depósito, o tarjeta/crédito/visa/mastercard. Si no habló de pago → null.
      2. cuotas: número entero si dijo "N cuotas", "N meses", "en N", "a N cuotas", "cambia a N", "pon N cuotas". Puede ir solo (sin repetir tarjeta). Rango 1-48.
      3. items: SOLO productos a AGREGAR. Si solo cambia cantidad o quita → items: [].
         - Cantidad: un/una=1, dos=2…diez=10, docena=12. Solo dígitos 1–200 si los dijo junto al producto.
         - NUNCA inventes cantidades grandes. Si no dijo cantidad → 1. No uses precios, cédulas ni códigos como cantidad.
      4. eliminarProducto: nombre si dijo quita/borra/elimina/saca TODO el ítem. Si dijo "quita N unidades de X" → modificarCantidad con cantidad = actual-N o usa {"producto":"X","cantidad":N,"modo":"restar"}.
      5. modificarCantidad: {"producto":"nombre","cantidad":N} cantidad FINAL deseada. Si dijo "quita 5 de mouse" → restar; si "deja 2 mouse" → cantidad 2.
      6. emitirFactura: true SOLO si pide emitir/cobrar/guardar/finalizar de forma clara.
      7. cliente "CONSUMIDOR_FINAL" solo si dijo consumidor final / sin datos / público en general.
      8. descuentos: SOLO si los mencionó (porcentaje o monto).
      9. Si la frase es larga, extrae TODO lo útil (cliente + pago + varios productos + cuotas) en un solo JSON.
    `;

    const payload = {
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: fraseUsuario }
      ],
      temperature: 0.0,
      max_tokens: 600
    };

    this.bloqueoEscucha = true;
    this.isThinking = true;

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          try {
            let respuestaStr = res.choices?.[0]?.message?.content || '';
            let jsonStr = respuestaStr;
            const match = respuestaStr.match(/\{[\s\S]*\}/);
            if (match) jsonStr = match[0];
            jsonStr = jsonStr
              .replace(/```json/gi, '')
              .replace(/```/g, '')
              .replace(/,\s*([\]}])/g, '$1') // trailing commas
              .trim();

            let datosExtraidos: any;
            try {
              datosExtraidos = JSON.parse(jsonStr);
            } catch {
              // Segundo intento: arreglar comillas simples / basura
              const soft = jsonStr
                .replace(/'/g, '"')
                .replace(/\n/g, ' ')
                .replace(/(\w+)\s*:/g, '"$1":')
                .replace(/""+/g, '"');
              try {
                datosExtraidos = JSON.parse(soft);
              } catch {
                // Fallback local: no decir "me enredé", interpretar la frase aquí
                datosExtraidos = this.construirDatosLocalesDesdeFrase(fraseUsuario, quiereEmitirPalabra);
              }
            }

            const datosLimpios = this.sanearDatosVoz(datosExtraidos, fraseUsuario);
            // Si la IA no trajo items pero la frase sí menciona productos → completar
            if ((!Array.isArray(datosLimpios.items) || datosLimpios.items.length === 0)
              && this.fraseMencionaProducto(fraseUsuario)) {
              datosLimpios.items = this.extraerItemsDesdeFrase(fraseUsuario);
            }
            // Groq puede poner emitirFactura=true por error; solo confiar si la frase lo pide
            const intencionEmitir = quiereEmitirPalabra
              && (this.esComandoEmitirFuerte(fraseUsuario)
                || String(datosLimpios.emitirFactura).toLowerCase() === 'true');
            this.aplicarDatosExtraidos(datosLimpios, intencionEmitir);
          } catch (e) {
            console.error("Error procesando voz:", e);
            // Último recurso: extracción 100% local
            try {
              const local = this.sanearDatosVoz(
                this.construirDatosLocalesDesdeFrase(fraseUsuario, quiereEmitirPalabra),
                fraseUsuario
              );
              this.aplicarDatosExtraidos(local, quiereEmitirPalabra);
            } catch (e2) {
              this.isThinking = false;
              this.hablar("No capté bien. Di de nuevo los productos, uno por uno o en lista.", () => {
                this.bloqueoEscucha = false;
                this.isThinking = false;
                this.escuchar();
              });
            }
          }
        },
        error: () => {
          // Sin internet/API: igual intentar local
          try {
            const local = this.sanearDatosVoz(
              this.construirDatosLocalesDesdeFrase(fraseUsuario, quiereEmitirPalabra),
              fraseUsuario
            );
            this.aplicarDatosExtraidos(local, quiereEmitirPalabra);
          } catch {
            this.isThinking = false;
            this.hablar("Sin conexión a la IA. Di los productos otra vez.", () => {
              this.bloqueoEscucha = false;
              this.isThinking = false;
              this.escuchar();
            });
          }
        }
      });
  }

  /**
   * Interpreta la frase sin IA: cliente, pago, cuotas, productos en lista.
   * Usado cuando Groq falla o devuelve JSON inválido.
   */
  private construirDatosLocalesDesdeFrase(frase: string, quiereEmitir: boolean): any {
    const f = this.limpiarTexto(frase || '');
    const out: any = {
      cliente: null,
      metodoPago: null,
      cuotas: null,
      items: [],
      eliminarProducto: null,
      modificarCantidad: null,
      emitirFactura: !!quiereEmitir,
      descuentoGlobal: null,
      descuentoGlobalPorcentaje: null
    };

    if (/\b(consumidor\s*final|sin\s*datos|publico|público)\b/.test(f)) {
      out.cliente = 'CONSUMIDOR_FINAL';
    } else {
      // Cédula en la frase
      const mDoc = f.match(/\b(\d{3,13})\b/);
      if (mDoc) {
        const hits = this.buscarClientesUniversales(mDoc[1]);
        if (hits.length === 1) {
          out.cliente = hits[0].nombreCompleto || hits[0].primerNombre || mDoc[1];
        } else if (hits.length > 1) {
          out.cliente = mDoc[1]; // desambiguación después
        }
      }
      // "cliente Juan Pérez" / nombre suelto
      const mCli = f.match(/\b(?:cliente|para|a)\s+([a-záéíóúñü\s]{3,40}?)(?:\s*,|\s+un\s|\s+una\s|\s+agrega|\s+con\s|\s+efectivo|\s+tarjeta|$)/);
      if (!out.cliente && mCli) {
        const nom = mCli[1].replace(/\b(consumidor|final|bodega|central)\b/g, '').trim();
        if (nom.length >= 3) out.cliente = nom;
      }
    }

    if (/\b(tarjeta|credito|visa|mastercard)\b/.test(f)) out.metodoPago = 'TARJETA_CREDITO';
    else if (/\b(transferencia|deposito|depósito|banco)\b/.test(f)) out.metodoPago = 'TRANSFERENCIA';
    else if (/\b(efectivo|cash|contado)\b/.test(f)) out.metodoPago = 'EFECTIVO';

    const cuotas = this.extraerCuotasDeFrase(f);
    if (cuotas) out.cuotas = cuotas;

    out.items = this.extraerItemsDesdeFrase(f);

    if (/\b(quita|quitar|borra|borrar|elimina|saca)\b/.test(f)) {
      const mRestar = f.match(
        /\b(?:quita|quitar|borra|borrar|elimina|eliminar|saca|sacar)\s+(\d{1,3}|un|una|dos|tres|cuatro|cinco)\s*(?:unidades?)?\s*(?:de\s+|del\s+)?(.+)/
      );
      if (mRestar) {
        const c = this.parseCantidadToken(mRestar[1]) || 1;
        out.modificarCantidad = { producto: mRestar[2].trim(), cantidad: c, modo: 'restar' };
      } else {
        const mQ = f.match(/\b(?:quita|quitar|borra|borrar|elimina|eliminar|saca|sacar)\s+(?:el|la|los|las)?\s*(.+)$/);
        if (mQ) out.eliminarProducto = mQ[1].trim();
      }
    }

    return out;
  }


  private extraerCuotasDeFrase(frase: string): number | null {
    const f = this.limpiarTexto(frase || '');
    // Números en palabras → dígito
    const mapa: Record<string, number> = {
      una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
      seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
      once: 11, doce: 12, quince: 15, dieciocho: 18, veinte: 20,
      veinticuatro: 24, treinta: 30, treintaiseis: 36, treintayseis: 36
    };
    const patterns = [
      /\b(\d{1,2})\s*(cuotas?|meses?|mes)\b/,
      /\ben\s+(\d{1,2})\s*(cuotas?|meses?)?\b/,
      /\ba\s+(\d{1,2})\s*(cuotas?|meses?)?\b/,
      /\b(cuotas?|meses?)\s*(de\s*)?(\d{1,2})\b/,
      /\b(cambia|cambiar|pon|poner|deja|dejar|actualiza|actualizar)\s+(?:a\s+)?(\d{1,2})\s*(cuotas?|meses?)?\b/,
      /\b(\d{1,2})\s*(pagos?)\b/,
    ];
    for (const re of patterns) {
      const m = f.match(re);
      if (m) {
        const n = parseInt(m[1] || m[2] || m[3], 10);
        if (!isNaN(n) && n >= 1 && n <= 48) return n;
      }
    }
    // "tres cuotas", "seis meses", etc.
    for (const [palabra, num] of Object.entries(mapa)) {
      const rePal = new RegExp(`\\b${palabra}\\s*(cuotas?|meses?|mes|pagos?)\\b`);
      if (rePal.test(f)) return num;
      const rePal2 = new RegExp(`\\b(en|a|de)\\s+${palabra}\\s*(cuotas?|meses?)?\\b`);
      if (rePal2.test(f)) return num;
    }
    return null;
  }

  private sanearDatosVoz(datos: any, frase: string): any {
    const f = this.limpiarTexto(frase || this.ultimaFraseUsuario);
    const out: any = { ...(datos || {}) };

    const diceTarjeta = /\b(tarjeta|credito|visa|mastercard|american\s*express)\b/.test(f);
    const diceTransfer = /\b(transferencia|transferir|deposito|deposito|banco)\b/.test(f);
    const diceEfectivo = /\b(efectivo|cash|contado)\b/.test(f);

    const m = String(out.metodoPago || '').toUpperCase();
    if (m.includes('TARJETA')) {
      out.metodoPago = diceTarjeta ? 'TARJETA_CREDITO' : null;
    } else if (m.includes('TRANSFERENCIA')) {
      out.metodoPago = diceTransfer ? 'TRANSFERENCIA' : null;
    } else if (m.includes('EFECTIVO')) {
      out.metodoPago = diceEfectivo ? 'EFECTIVO' : null;
    } else {
      out.metodoPago = null;
    }
    if (!out.metodoPago) {
      if (diceTarjeta) out.metodoPago = 'TARJETA_CREDITO';
      else if (diceTransfer) out.metodoPago = 'TRANSFERENCIA';
      else if (diceEfectivo) out.metodoPago = 'EFECTIVO';
    }

    // ¿La frase pide cambiar a un cliente real? (nombre, cédula, "cliente 421")
    const pideClienteReal =
      (out.cliente && out.cliente !== 'null' && !String(out.cliente).toUpperCase().includes('CONSUMIDOR'))
      || /\b(cliente|cedula|c[eé]dula|ruc)\b/.test(f)
      || /\b\d{3,13}\b/.test(f);
    const diceConsumidorAhora = /\b(consumidor\s*final|sin\s*datos)\b/.test(f)
      || String(out.cliente || '').toUpperCase().includes('CONSUMIDOR');

    // Solo bloquear tarjeta si SIGUE siendo consumidor final y NO está cambiando a cliente real
    const seraConsumidorFinal = diceConsumidorAhora || (this.esConsumidorFinal && !pideClienteReal);
    if (seraConsumidorFinal && out.metodoPago === 'TARJETA_CREDITO') {
      out.metodoPago = diceEfectivo ? 'EFECTIVO' : (diceTransfer ? 'TRANSFERENCIA' : 'EFECTIVO');
      out.detallesTarjeta = null;
      out.cuotas = null;
      (out as any)._tarjetaBloqueadaConsumidor = true;
    } else {
      // Va a cambiar de cliente → NO bloquear tarjeta/cuotas todavía
      (out as any)._tarjetaBloqueadaConsumidor = false;
    }

    // No borrar cuotas si el usuario ya está en tarjeta o está pidiendo tarjeta+cuotas con cliente nuevo
    const yaEnTarjeta = this.nuevaFactura.metodoPago === 'TARJETA_CREDITO' && this.permiteTarjetaCredito;
    if (seraConsumidorFinal && !pideClienteReal) {
      out.detallesTarjeta = null;
      out.cuotas = null;
    } else if (!diceTarjeta && !yaEnTarjeta && !this.extraerCuotasDeFrase(f)) {
      out.detallesTarjeta = null;
      if (!this.extraerCuotasDeFrase(f)) out.cuotas = null;
    }
    // Si dijo cuotas en la frase, asegurar que se conserven
    const cuotasFrase = this.extraerCuotasDeFrase(f);
    if (cuotasFrase && !out.cuotas) out.cuotas = cuotasFrase;
    if (diceTarjeta && !out.metodoPago) out.metodoPago = 'TARJETA_CREDITO';

    const diceDesc = /\b(descuento|rebaja|por\s*ciento|porcentaje)\b/.test(f);
    if (!diceDesc) {
      out.descuentoGlobal = null;
      out.descuentoGlobalPorcentaje = null;
    }

    // --- Items: PERMISIVO + cantidades saneadas ---
    if (!Array.isArray(out.items)) out.items = [];
    out.items = out.items
      .filter((it: any) => it && it.producto && String(it.producto).toLowerCase() !== 'null')
      .map((it: any) => ({
        ...it,
        cantidad: this.normalizarCantidadVoz(it.cantidad)
      }));

    // Vaciar solo si la frase es claramente SOLO pago/cliente/cuotas, sin productos
    const pideProducto =
      /\b(agrega|agregue|agregar|añade|añadir|pon|poner|quiero|dame|producto|un|una|unos|unas|dos|tres|cuatro|cinco)\b/.test(f)
      || this.fraseMencionaProducto(f);

    const soloPagoOCliente =
      !pideProducto &&
      (diceTarjeta || diceTransfer || diceEfectivo
        || /\b(consumidor\s*final|cliente|cuotas?|meses?)\b/.test(f));

    if (soloPagoOCliente) {
      out.items = [];
    } else if (out.items.length === 0 && this.fraseMencionaProducto(f)) {
      out.items = this.extraerItemsDesdeFrase(f);
    } else if (out.items.length > 0 && this.fraseMencionaProducto(f)) {
      const fallback = this.extraerItemsDesdeFrase(f);
      if (fallback.length > out.items.length) {
        const yaNombres = new Set<string>(out.items.map((it: any) => this.limpiarTexto(String(it.producto))));
        for (const fb of fallback) {
          const n = this.limpiarTexto(String(fb.producto));
          if (![...yaNombres].some(y => y.includes(n) || n.includes(y))) {
            out.items.push({ ...fb, cantidad: this.normalizarCantidadVoz(fb.cantidad) });
            yaNombres.add(n);
          }
        }
      }
    }

    // Re-clamp por si la IA mandó 50000 etc.
    out.items = (out.items || []).map((it: any) => ({
      ...it,
      cantidad: this.normalizarCantidadVoz(it.cantidad)
    }));

    if (out.eliminarProducto && out.eliminarProducto !== 'null') {
      const diceQuitar = /\b(quita|quitar|borra|borrar|elimina|eliminar|saca|sacar)\b/.test(f);
      if (!diceQuitar) out.eliminarProducto = null;
      else {
        // Quitar y agregar en la misma frase se buguea → solo quitar
        out.items = [];
      }
    }
    // Si la frase es de quitar/restar unidades, no agregar productos
    if (/\b(quita|quitar|borra|borrar|elimina|eliminar|saca|sacar)\b/.test(f)) {
      out.items = [];
    }

    // Cuotas: de la IA o de la frase ("5 cuotas", "cambia a 3 meses")
    // También si YA está en tarjeta y solo dice "cambia a 5 cuotas"
    {
      const desdeFrase = this.extraerCuotasDeFrase(f);
      const desdeIa = out.cuotas != null ? parseInt(String(out.cuotas), 10) : NaN;
      if (!isNaN(desdeIa) && desdeIa >= 1) {
        out.cuotas = desdeIa;
      } else if (desdeFrase) {
        out.cuotas = desdeFrase;
      }
      // Si menciona cuotas/meses sin método, y ya hay tarjeta → mantener tarjeta
      if (out.cuotas && !out.metodoPago && this.nuevaFactura.metodoPago === 'TARJETA_CREDITO') {
        // no tocar metodoPago; solo actualizamos cuotas más abajo
      }
    }

    // Quitar N unidades / todo el producto
    // "quita 5 unidades de mouse", "elimina 2 del colchón", "saca el mouse"
    {
      const mRestar = f.match(
        /\b(?:quita|quitar|borra|borrar|elimina|eliminar|saca|sacar)\s+(\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:unidades?|unds?|uds?)?\s*(?:de\s+|del\s+|de\s+la\s+)?(.+?)(?:\s+y\s+|\s*,\s*|$)/
      );
      if (mRestar) {
        const cantR = this.parseCantidadToken(mRestar[1]) || this.normalizarCantidadVoz(mRestar[1]);
        let prodR = (mRestar[2] || '')
          .replace(/\b(del ticket|de la factura|por favor|unidades?)\b/g, '')
          .trim();
        // Cortar si viene "y agrega..."
        prodR = prodR.split(/\s+y\s+(?:agrega|añade|pon|dame)/)[0].trim();
        if (prodR.length >= 2 && cantR >= 1) {
          out.modificarCantidad = { producto: prodR, cantidad: cantR, modo: 'restar' };
          out.eliminarProducto = null;
        }
      } else if (!out.eliminarProducto || out.eliminarProducto === 'null') {
        const mQ = f.match(
          /\b(?:quita|quitar|borra|borrar|elimina|eliminar|saca|sacar)\s+(?:el|la|los|las|todo\s+el|toda\s+la)?\s*(.+?)(?:\s+y\s+(?:agrega|añade|pon|dame)|$)/
        );
        if (mQ) {
          const nom = mQ[1].replace(/\b(del ticket|de la factura|por favor)\b/g, '').trim();
          if (nom.length >= 2 && !/^\d+$/.test(nom)) out.eliminarProducto = nom;
        }
      }
    }

    // modificarCantidad: cantidad FINAL
    // "cambia cantidad de mouse a 3", "pon 2 de teclado", "deja 5 mouse"
    if (!out.modificarCantidad || out.modificarCantidad === 'null') {
      const patronesCant = [
        /(?:cambia|cambiar|actualiza|actualizar)\s+(?:la\s+)?cantidad\s+(?:de\s+)?(.+?)\s+a\s+(\d{1,3})/,
        /(?:deja|dejar)\s+(\d{1,3}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:de\s+)?(.+)/,
        /(?:pon|poner)\s+(\d{1,3}|un|una|dos|tres|cuatro|cinco)\s+(?:de\s+)?(.+?)(?:\s+en\s+el\s+ticket|$)/,
      ];
      for (const re of patronesCant) {
        const m = f.match(re);
        if (!m) continue;
        let prod: string;
        let cant: number | null;
        if (re.source.includes('cantidad')) {
          prod = m[1];
          cant = this.parseCantidadToken(m[2]) ?? this.normalizarCantidadVoz(m[2]);
        } else {
          cant = this.parseCantidadToken(m[1]) ?? this.normalizarCantidadVoz(m[1]);
          prod = m[2];
        }
        prod = (prod || '').replace(/\b(del ticket|por favor|unidades?)\b/g, '').trim();
        if (prod && cant != null && cant >= 0 && cant <= 200) {
          out.modificarCantidad = { producto: prod, cantidad: cant, modo: 'set' };
          break;
        }
      }
    }

    // Sanear modificarCantidad de la IA
    if (out.modificarCantidad && typeof out.modificarCantidad === 'object') {
      out.modificarCantidad.cantidad = this.normalizarCantidadVoz(out.modificarCantidad.cantidad);
      if (out.modificarCantidad.cantidad > 200) out.modificarCantidad.cantidad = 1;
    }

    return out;
  }

  /** ¿Algún token de la frase coincide con un producto del catálogo? */
  private fraseMencionaProducto(frase: string): boolean {
    const tokens = this.limpiarTexto(frase).split(/\s+/).filter(t => t.length >= 3);
    const stop = new Set([
      'agrega', 'agregue', 'agregar', 'añade', 'añadir', 'pon', 'poner', 'quiero', 'dame',
      'factura', 'favor', 'porfa', 'descuento', 'cliente', 'consumidor', 'final',
      'efectivo', 'tarjeta', 'credito', 'transferencia', 'emitir', 'cobrar', 'listo',
      'con', 'del', 'los', 'las', 'por', 'para', 'que', 'tambien', 'también', 'mas', 'más',
      'cuotas', 'meses', 'pago', 'pagar'
    ]);
    return tokens.some(t =>
      !stop.has(t) &&
      this.productosList.some(p => this.limpiarTexto(p.nombre).includes(t))
    );
  }

  /** Cantidad válida de voz: palabras o dígitos 1–200. Nunca miles ni basura. */
  private parseCantidadToken(tok: string): number | null {
    const t = this.limpiarTexto(tok);
    const mapa: Record<string, number> = {
      un: 1, una: 1, uno: 1, unos: 1, unas: 1,
      dos: 2, tres: 3, cuatro: 4, cinco: 5,
      seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
      once: 11, doce: 12, media: 6, docena: 12,
      quince: 15, veinte: 20, treinta: 30, cincuenta: 50, cien: 100
    };
    if (mapa[t] != null) return mapa[t];
    // Solo dígitos puros, sin puntos/comas de precios
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = parseInt(t, 10);
    if (isNaN(n) || n < 1 || n > 200) return null;
    return n;
  }

  /** Normaliza cantidad de un ítem de voz: máx 200, default 1. */
  private normalizarCantidadVoz(raw: any): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 1;
    if (n > 200) return 1; // cifras absurdas (precios, cédulas mal interpretadas) → 1
    return Math.floor(n);
  }

  /**
   * Extrae varios productos en secuencia desde la frase.
   * Ej: "un mouse, un colchón, una almohada, una crema nivea"
   * También: "dos teclados y una pantalla"
   * Deja el nombre tal cual para que resolverMatchesProductos decida opciones si hay iguales.
   */
  private extraerItemsDesdeFrase(frase: string): any[] {
    const f = this.limpiarTexto(frase || '');
    const stop = new Set([
      'agrega', 'agregue', 'agregar', 'añade', 'añadir', 'pon', 'poner', 'quiero', 'dame',
      'factura', 'favor', 'porfa', 'descuento', 'cliente', 'consumidor', 'final',
      'efectivo', 'tarjeta', 'credito', 'transferencia', 'con', 'del', 'los', 'las',
      'por', 'para', 'que', 'tambien', 'también', 'mas', 'más', 'y', 'e', 'o',
      'cuotas', 'meses', 'pago', 'pagar', 'emite', 'emitir', 'cobra', 'cobrar',
      'listo', 'gracias', 'bodega', 'central', 'principal', 'tal', 'producto', 'productos',
      'cualquier', 'varios', 'unas', 'unos', 'siguientes', 'siguiente', 'agregame',
      'agregame', 'añademe', 'deme', 'necesito', 'quiero', 'desde', 'hasta'
    ]);

    // Quitar preámbulos típicos para no ensuciar segmentos
    let cuerpo = f
      .replace(/^.*?\b(?:agrega(?:me)?|añade(?:me)?|pon(?:me)?|dame|quiero|necesito)\b\s*/i, '')
      .replace(/\b(?:de\s+la\s+)?bodega\s+\w+\b/g, ' ')
      .replace(/\b(?:los|las)\s+siguientes\s+productos?\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Segmentos por coma / y / e / además
    let segmentos = cuerpo
      .split(/\s*(?:,|;| y | e | ademas | además | tambien | también )\s*/)
      .map(s => s.trim())
      .filter(s => s.length >= 2);

    // Si no hubo comas, partir también por "un/una/unos/unas/N " repetidos
    if (segmentos.length <= 1) {
      const partes = cuerpo.split(/\s+(?=(?:un|una|unos|unas|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\s+)/);
      if (partes.length > 1) {
        segmentos = partes.map(s => s.trim()).filter(s => s.length >= 2);
      }
    }

    const items: any[] = [];
    const nombresUsados = new Set<string>();

    const intentarMatch = (texto: string): boolean => {
      let tokens = texto.split(/\s+/).filter(t => t.length >= 2 && !stop.has(t));
      if (!tokens.length) return false;

      let cant = 1;
      if (tokens.length >= 1) {
        const c0 = this.parseCantidadToken(tokens[0]);
        if (c0 != null) {
          cant = c0;
          tokens = tokens.slice(1);
        }
      }
      if (!tokens.length) return false;

      // Nombre candidato: uni tokens (ej. "crema nivea")
      const nombreCand = tokens.join(' ');
      const clave = this.limpiarTexto(nombreCand);
      if (nombresUsados.has(clave)) return false;

      // ¿Hay algún producto del catálogo que matchee al menos un token?
      const hayHit = tokens.some(t =>
        t.length >= 3 && this.productosList.some(p => this.limpiarTexto(p.nombre).includes(t))
      );
      if (!hayHit) return false;

      nombresUsados.add(clave);
      // Guardar el nombre dicho; resolverMatches se encarga de opciones si hay varios iguales
      items.push({
        producto: nombreCand,
        cantidad: cant,
        descuento: 0,
        descuentoPorcentaje: 0
      });
      return true;
    };

    for (const seg of segmentos) {
      intentarMatch(seg);
    }

    // Fallback: escanear tokens de toda la frase
    if (items.length === 0) {
      const tokens = cuerpo.split(/\s+/).filter(t => t.length >= 3 && !stop.has(t));
      let cantActual = 1;
      for (const t of tokens) {
        const c = this.parseCantidadToken(t);
        if (c != null) {
          cantActual = c;
          continue;
        }
        if (nombresUsados.has(t)) continue;
        const hits = this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(t));
        if (hits.length === 0) continue;
        nombresUsados.add(t);
        items.push({ producto: t, cantidad: cantActual, descuento: 0, descuentoPorcentaje: 0 });
        cantActual = 1;
      }
    }

    return items;
  }

  private aplicarDatosExtraidos(datos: any, quiereEmitir: boolean = false) {
    let algoAgregado = false;
    let mensajesAlerta: string[] = [];

    // Si dijo "de la bodega X" en esta frase → fijar para todos los productos del comando
    const bodFrase = this.resolverBodegaDesdeFrase(this.ultimaFraseUsuario || '');
    if (bodFrase) {
      this.bodegaPreferidaVoz = bodFrase;
    }

    // ── QUITAR / RESTAR: SOLO eso en esta frase (no mezclar con agregar) ──
    const tieneQuitar = !!(datos.eliminarProducto && datos.eliminarProducto !== 'null');
    const tieneRestar = !!(datos.modificarCantidad && datos.modificarCantidad !== 'null'
      && String(datos.modificarCantidad?.modo || '').toLowerCase() === 'restar');
    const tieneModSet = !!(datos.modificarCantidad && datos.modificarCantidad !== 'null'
      && String(datos.modificarCantidad?.modo || '').toLowerCase() !== 'restar');

    if (tieneQuitar || tieneRestar) {
      // No procesar items de agregar en la misma frase (evita bugs)
      datos.items = [];

      if (tieneQuitar) {
        const idx = this.buscarIndiceEnCarrito(String(datos.eliminarProducto));
        if (idx !== -1) {
          const nombreQuitado = this.nuevaFactura.detalles[idx].productoNombre;
          this.eliminarDelCarrito(idx);
          this.hablar(`Listo, quité ${nombreQuitado}. Total $${this.totalCarrito.toFixed(2)}. ¿Qué más?`, () => {
            this.bloqueoEscucha = false;
            this.isThinking = false;
            this.escuchar();
          });
          return;
        }
        this.hablar(`No encontré "${datos.eliminarProducto}" en el ticket. ¿Qué más?`, () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
        return;
      }

      if (tieneRestar) {
        const mod = datos.modificarCantidad;
        let cant = this.normalizarCantidadVoz(mod.cantidad);
        const idx = this.buscarIndiceEnCarrito(String(mod.producto));
        if (idx !== -1) {
          const actual = Number(this.nuevaFactura.detalles[idx].cantidad) || 0;
          cant = Math.max(0, actual - cant);
          const ok = this.modificarCantidadEnCarrito(String(mod.producto), cant);
          if (ok) {
            const msg = cant === 0
              ? `Quité ${mod.producto}. Total $${this.totalCarrito.toFixed(2)}.`
              : `${mod.producto} queda en ${cant}. Total $${this.totalCarrito.toFixed(2)}.`;
            this.hablar(`${msg} ¿Qué más?`, () => {
              this.bloqueoEscucha = false;
              this.isThinking = false;
              this.escuchar();
            });
            return;
          }
        }
        this.hablar(`No pude quitar unidades de "${mod.producto}". ¿Qué más?`, () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
        return;
      }
    }

    // Cambiar cantidad FINAL (deja N de X) — sin agregar en la misma frase
    if (tieneModSet) {
      datos.items = [];
      const mod = datos.modificarCantidad;
      const cant = this.normalizarCantidadVoz(mod.cantidad);
      const ok = this.modificarCantidadEnCarrito(String(mod.producto), cant);
      if (ok) {
        this.hablar(`${mod.producto} queda en ${cant}. Total $${this.totalCarrito.toFixed(2)}. ¿Qué más?`, () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
        return;
      }
      mensajesAlerta.push(`no pude ajustar "${mod.producto}"`);
    }

    // ── 1) CLIENTE primero (sale de Consumidor Final si aplica) ──
    let requiereDesambiguacionCli = null;
    // Si no vino cliente en JSON pero hay dígitos de cédula en la frase, buscar
    if ((!datos.cliente || datos.cliente === 'null') && this.ultimaFraseUsuario) {
      const digs = this.limpiarTexto(this.ultimaFraseUsuario).match(/\d{3,13}/g);
      if (digs && digs.length) {
        for (const d of digs) {
          const hits = this.buscarClientesUniversales(d);
          if (hits.length >= 1) {
            datos.cliente = hits.length === 1
              ? (hits[0].nombreCompleto || hits[0].primerNombre || d)
              : d;
            break;
          }
        }
      }
    }
    if (datos.cliente && datos.cliente !== 'null') {
      if (datos.cliente === 'CONSUMIDOR_FINAL' || String(datos.cliente).toLowerCase().includes('consumidor')) {
        this.setConsumidorFinal();
        algoAgregado = true;
      } else {
        const matchesCli = this.buscarClientesUniversales(String(datos.cliente));
        if (matchesCli.length === 1) {
          this.seleccionarCliente(matchesCli[0]); // limpia esConsumidorFinal
          algoAgregado = true;
        } else if (matchesCli.length > 1) {
          requiereDesambiguacionCli = matchesCli;
        } else {
          mensajesAlerta.push(`no encontré a ${datos.cliente}`);
        }
      }
    }

    // Si hay varios clientes, guardar TODO (incluye tarjeta) y resolver después
    if (requiereDesambiguacionCli) {
      this.quiereEmitirPendiente = quiereEmitir;
      this.datosVozPendientes = {
        ...datos,
        cliente: null,
        items: Array.isArray(datos.items) ? datos.items : []
      };
      this.itemsVozPendientes = Array.isArray(datos.items) ? [...datos.items] : [];

      // 🔥 NUEVO: Generar el texto para que Zoe lea las opciones de clientes diferenciados por Cédula
      const totalOps = requiereDesambiguacionCli.length;
      const muestra = requiereDesambiguacionCli.slice(0, 5); // Leer máximo 5 opciones para no aburrir
      const nombresCli = muestra.map((c, idx) => {
        const nom = c.nombreCompleto || `${c.primerNombre || ''} ${c.apellidoPaterno || ''}`.trim() || 'Cliente';
        const doc = c.dni || c.identificacion || '';
        const ultimos = doc.length >= 3 ? doc.slice(-3) : doc;
        return `${idx + 1}) ${nom}${ultimos ? ' termina en ' + ultimos : ''}`;
      }).join('. ');

      const extraCli = totalOps > 5 ? ` (${totalOps} en total)` : '';
      
      this.iniciarDesambiguacion(
        'CLIENTE',
        requiereDesambiguacionCli,
        `Hay ${totalOps} clientes parecidos${extraCli}: ${nombresCli}. Di el número o su cédula.`
      );
      return;
    }

    // ── 2) MÉTODO DE PAGO + CUOTAS (después del cliente ya resuelto) ──
    // Si el cliente ya es real, no aplicar bloqueo de consumidor aunque viniera de la IA
    if (this.permiteTarjetaCredito) {
      (datos as any)._tarjetaBloqueadaConsumidor = false;
    }

    // Restaurar tarjeta/cuotas desde la frase si sanear las borró por el consumidor anterior
    const frasePago = this.limpiarTexto(this.ultimaFraseUsuario || '');
    if (!datos.metodoPago || datos.metodoPago === 'null') {
      if (/\b(tarjeta|credito|cr[eé]dito|visa|mastercard)\b/.test(frasePago)) {
        datos.metodoPago = 'TARJETA_CREDITO';
      } else if (/\b(transferencia|deposito|dep[oó]sito)\b/.test(frasePago)) {
        datos.metodoPago = 'TRANSFERENCIA';
      } else if (/\b(efectivo|contado|cash)\b/.test(frasePago)) {
        datos.metodoPago = 'EFECTIVO';
      }
    }
    if ((datos.cuotas == null || datos.cuotas === 'null') && frasePago) {
      const cf = this.extraerCuotasDeFrase(frasePago);
      if (cf) datos.cuotas = cf;
    }

    if ((datos as any)._tarjetaBloqueadaConsumidor && !this.permiteTarjetaCredito) {
      mensajesAlerta.push('tarjeta no permitida con Consumidor Final');
    }

    this.aplicarMetodoPagoSeguro(
      datos.metodoPago,
      mensajesAlerta,
      false
    );

    // Si dijo cuotas + (tarjeta o ya está en tarjeta o permite tarjeta), aplicar
    const quiereTarjeta = String(datos.metodoPago || '').toUpperCase().includes('TARJETA')
      || this.nuevaFactura.metodoPago === 'TARJETA_CREDITO'
      || /\b(tarjeta|credito|cr[eé]dito)\b/.test(frasePago);

    if (quiereTarjeta && this.permiteTarjetaCredito) {
      this.nuevaFactura.metodoPago = 'TARJETA_CREDITO';
      this.metodoPagoConfirmado = true;
      if (datos.detallesTarjeta && datos.detallesTarjeta !== 'null') {
        this.nuevaFactura.detallesTarjeta = datos.detallesTarjeta;
      }
      const numCuotas = datos.cuotas != null ? parseInt(String(datos.cuotas), 10) : NaN;
      if (!isNaN(numCuotas) && numCuotas >= 1 && numCuotas <= 48) {
        this.nuevaFactura.numeroCuotas = numCuotas;
        algoAgregado = true;
        (datos as any)._cuotasActualizadas = numCuotas;
      } else if (!this.nuevaFactura.numeroCuotas || this.nuevaFactura.numeroCuotas < 1) {
        // Dijo tarjeta pero sin cuotas → dejar pendiente, no forzar efectivo
        algoAgregado = true;
      }
    } else if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO' && !this.permiteTarjetaCredito) {
      this.bloquearTarjetaSiConsumidorFinal(false);
    } else if (datos.cuotas != null && this.nuevaFactura.metodoPago !== 'TARJETA_CREDITO' && !this.permiteTarjetaCredito) {
      const n = parseInt(String(datos.cuotas), 10);
      if (!isNaN(n) && n >= 1) {
        mensajesAlerta.push('para usar cuotas elige primero un cliente registrado y tarjeta');
      }
    } else if (datos.cuotas != null && this.permiteTarjetaCredito && quiereTarjeta === false) {
      // Solo dijo cuotas con cliente real → activar tarjeta
      const n = parseInt(String(datos.cuotas), 10);
      if (!isNaN(n) && n >= 1) {
        this.nuevaFactura.metodoPago = 'TARJETA_CREDITO';
        this.metodoPagoConfirmado = true;
        this.nuevaFactura.numeroCuotas = n;
        algoAgregado = true;
        (datos as any)._cuotasActualizadas = n;
      }
    }

    // Al emitir sin método explícito → efectivo por defecto
    if (quiereEmitir && !this.metodoPagoConfirmado) {
      this.nuevaFactura.metodoPago = 'EFECTIVO';
      this.metodoPagoConfirmado = true;
    }

    // Solo bloquear tarjeta si AÚN es consumidor (después de cambiar cliente no debería)
    if (!this.permiteTarjetaCredito) {
      this.bloquearTarjetaSiConsumidorFinal(false);
    }

    // ── 3) DESCUENTO GLOBAL ──
    if (datos.descuentoGlobalPorcentaje !== undefined && datos.descuentoGlobalPorcentaje !== null) {
      const pct = parseFloat(datos.descuentoGlobalPorcentaje);
      if (!isNaN(pct) && pct > 0) {
        this.nuevaFactura.descuentoGlobalPorcentaje = Math.min(pct, 100);
        this.nuevaFactura.descuentoGlobal = 0;
        algoAgregado = true;
      }
    } else if (datos.descuentoGlobal !== undefined && datos.descuentoGlobal !== null) {
      const descGlobal = parseFloat(datos.descuentoGlobal);
      if (!isNaN(descGlobal) && descGlobal > 0) {
        this.nuevaFactura.descuentoGlobal = descGlobal;
        this.nuevaFactura.descuentoGlobalPorcentaje = 0;
        algoAgregado = true;
      }
    }

    const items = Array.isArray(datos.items) ? datos.items.filter((it: any) => it && it.producto && it.producto !== 'null') : [];

    // Procesar productos: 1 match exacto → agregar; 2+ → opciones (nunca elegir al azar)
    let requiereDesambiguacionProd: any[] | null = null;
    let cantTemp = 1;
    let descTemp = 0;
    let descPctTemp = 0;
    const itemsRestantes: any[] = [];

    // Agregar todos los que tengan match claro; pausar en ambiguo o al pedir bodega
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const matchesProd = this.resolverMatchesProductoVoz(String(item.producto), String(item.producto));

      if (matchesProd.length === 1) {
        const ok = this.intentarAgregarProductoVoz(matchesProd[0], item, mensajesAlerta);
        if (ok) algoAgregado = true;
        // Esperando bodega → guardar el resto de la lista
        if (this.esperandoBodega) {
          for (let j = i + 1; j < items.length; j++) itemsRestantes.push(items[j]);
          this.itemsVozPendientes = itemsRestantes;
          this.quiereEmitirPendiente = quiereEmitir;
          return; // iniciarDesambiguacion ya habló
        }
      } else if (matchesProd.length > 1) {
        requiereDesambiguacionProd = matchesProd;
        cantTemp = this.normalizarCantidadVoz(item.cantidad);
        descTemp = Number(item.descuento || 0) || 0;
        descPctTemp = Number(item.descuentoPorcentaje || 0) || 0;
        for (let j = i + 1; j < items.length; j++) itemsRestantes.push(items[j]);
        break;
      } else {
        mensajesAlerta.push(`no tengo "${item.producto}" en el catálogo`);
      }
    }
    this.cdr.detectChanges();

    if (requiereDesambiguacionProd) {
      this.quiereEmitirPendiente = quiereEmitir;
      this.itemsVozPendientes = itemsRestantes;
      this.datosVozPendientes = { ...datos, items: itemsRestantes };
      this.itemTemp.cantidad = cantTemp;
      this.itemTemp.descuento = descTemp;
      this.itemTemp.descuentoPorcentaje = descPctTemp > 0 ? descPctTemp : null;
      const totalOps = requiereDesambiguacionProd.length;
      const muestra = requiereDesambiguacionProd.slice(0, 6);
      const nombres = muestra.map((p, idx) => `${idx + 1}) ${p.nombre}`).join('. ');
      const extra = totalOps > 6 ? ` (${totalOps} en total)` : '';
      this.iniciarDesambiguacion(
        'PRODUCTO',
        requiereDesambiguacionProd,
        `${totalOps} opciones${extra}: ${nombres}. Di el número o toca.`
      );
      return;
    }

    const faltaCliente = !this.nuevaFactura.clienteId && !this.esConsumidorFinal;
    const faltaItems = this.nuevaFactura.detalles.length === 0;
    let prefijoAviso = mensajesAlerta.length > 0 ? `A ver, ${mensajesAlerta.join(', y ')}. ` : '';

    this.quiereEmitirPendiente = false;

    if (faltaCliente) {
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
      this.hablar(`${prefijoAviso}Para cobrar necesito el cliente. ¿A quién le facturamos?`, () => this.escuchar());
    }
    else if (faltaItems) {
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
      this.hablar(`${prefijoAviso}El ticket está vacío. ¿Qué le agregamos?`, () => this.escuchar());
    }
    else if (quiereEmitir) {
      // Tarjeta sin cuotas → pedir cuotas
      if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO' && !this.cuotasTarjetaValidas) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(
          `${prefijoAviso}Tarjeta: ¿cuántas cuotas? Ejemplo: 3 cuotas o 6 meses.`,
          () => this.escuchar()
        );
      } else if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO' && !this.permiteTarjetaCredito) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(
          `${prefijoAviso}Tarjeta solo con cliente registrado. Elige cliente o cambia a efectivo.`,
          () => this.escuchar()
        );
      } else {
        // Emitir: mic OFF total (sin eco al final)
        this.voiceState = VoiceStep.OFF;
        this.bloqueoEscucha = true;
        this.isListening = false;
        this.isThinking = false;
        this.silencioPostHablaUntil = Date.now() + 10000;
        clearTimeout(this.silenceTimer);
        if (this.recognition) {
          try { this.recognition.abort(); } catch (e) { }
          try { this.recognition.stop(); } catch (e) { }
        }
        const cuotasTxt = this.nuevaFactura.metodoPago === 'TARJETA_CREDITO'
          ? ` en ${this.nuevaFactura.numeroCuotas} cuota(s)`
          : '';
        this.voiceMessage = `${prefijoAviso}Total $${this.totalCarrito.toFixed(2)}${cuotasTxt}. Emitiendo.`;
        this.ultimoTextoHablado = this.voiceMessage;
        this.cdr.detectChanges();
        try {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance('Emitiendo.');
          u.rate = 1.05;
          u.volume = 0.8;
          this.aplicarVozMujer(u);
          window.speechSynthesis.speak(u);
        } catch (e) { }
        setTimeout(() => { this.guardarFactura(); }, 280);
      }
    } else if (algoAgregado) {
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
      const extraCuotas = (datos as any)._cuotasActualizadas
        ? ` ${(datos as any)._cuotasActualizadas} cuota(s).`
        : (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO' && this.cuotasTarjetaValidas
          ? ` Tarjeta a ${this.nuevaFactura.numeroCuotas} cuota(s).`
          : '');
      // Mensajes más cortos → menos demora y menos confusión en sesiones largas
      this.hablar(
        `${prefijoAviso}Listo.${extraCuotas} Total $${this.totalCarrito.toFixed(2)}. ¿Más o emitimos?`,
        () => this.escuchar()
      );
    } else {
      this.voiceState = VoiceStep.ESCUCHA_LIBRE;
      this.hablar(`${prefijoAviso}¿Más o emitimos?`, () => this.escuchar());
    }
  }

  /** Agrega un producto resuelto por voz (1 match). Devuelve true si se agregó. */
  /** Resuelve bodega por nombre dicho: "bodega central", "central", etc. */
  private resolverBodegaDesdeFrase(frase: string): any | null {
    const f = this.limpiarTexto(frase || '');
    if (!f || !this.bodegasList.length) return null;

    // "bodega X" / "de la bodega X"
    const m = f.match(/\bbodega\s+(?:de\s+)?([a-záéíóúñü0-9\s]{2,40}?)(?:\s*,|\s+agrega|\s+añade|\s+un\s|\s+una\s|\s+dos\s|\s+y\s|$)/);
    let nombre = m ? m[1].trim() : '';

    // También "desde central", "en principal"
    if (!nombre) {
      const m2 = f.match(/\b(?:desde|en)\s+(?:la\s+)?(?:bodega\s+)?([a-záéíóúñü0-9]{3,30})\b/);
      if (m2) nombre = m2[1].trim();
    }

    if (!nombre) {
      // ¿Algún nombre de bodega aparece completo en la frase?
      for (const b of this.bodegasList) {
        const bn = this.limpiarTexto(b.nombre);
        if (bn.length >= 3 && f.includes(bn)) return b;
      }
      return null;
    }

    const hits = this.bodegasList.filter(b => {
      const bn = this.limpiarTexto(b.nombre);
      return bn === nombre || bn.includes(nombre) || nombre.includes(bn);
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      // Preferir match más exacto
      const exact = hits.find(b => this.limpiarTexto(b.nombre) === nombre);
      return exact || hits[0];
    }
    return null;
  }

  /**
   * Agrega producto.
   * - Si el usuario ya dijo la bodega en la frase → usa esa (sin preguntar).
   * - Si no hay stock ahí → avisa y no agrega.
   * - Si no dijo bodega y hay 2+ → pregunta.
   */
  private intentarAgregarProductoVoz(prod: any, item: any, mensajesAlerta: string[]): boolean {
    let cant = this.normalizarCantidadVoz(item?.cantidad);

    let descPct = Number(item.descuentoPorcentaje || 0);
    let descMonto = Number(item.descuento || 0);
    if (isNaN(descPct) || descPct < 0) descPct = 0;
    if (isNaN(descMonto) || descMonto < 0) descMonto = 0;
    if (descPct > 0) {
      const precioUnit = this.precioParaFactura(prod);
      descMonto = (precioUnit * cant * Math.min(descPct, 100)) / 100;
    }

    if (!this.bodegasList.length) {
      mensajesAlerta.push(`no hay bodegas configuradas`);
      return false;
    }

    // Bodega ya dicha en la frase (o preferida del comando)
    const preferida = this.bodegaPreferidaVoz;
    if (preferida) {
      const stock = this.obtenerStock(prod.id, preferida.id) || 0;
      if (stock <= 0) {
        mensajesAlerta.push(`no hay stock de ${prod.nombre} en ${preferida.nombre}`);
        return false;
      }
      return this.agregarProductoConBodega(prod, cant, preferida.id, descMonto, descPct, mensajesAlerta);
    }

    const conStock = this.bodegasList.filter(b => (this.obtenerStock(prod.id, b.id) || 0) > 0);
    const opcionesBod = conStock.length > 0 ? conStock : [...this.bodegasList];

    // Preguntar solo si hay más de una y el usuario NO dijo bodega
    if (opcionesBod.length > 1) {
      this.productoPendienteBodega = prod;
      this.itemPendienteBodega = {
        cantidad: cant,
        descuento: descMonto,
        descuentoPorcentaje: descPct
      };
      this.esperandoBodega = true;
      const lista = opcionesBod.slice(0, 8).map((b, i) => {
        const st = this.obtenerStock(prod.id, b.id) || 0;
        return `${i + 1}) ${b.nombre}${st > 0 ? ` (${st})` : ''}`;
      }).join('. ');
      this.iniciarDesambiguacion(
        'BODEGA',
        opcionesBod,
        `¿De qué bodega tomo ${prod.nombre}? ${lista}. Di el número.`
      );
      return false;
    }

    const bodegaUsar = opcionesBod[0].id;
    return this.agregarProductoConBodega(prod, cant, bodegaUsar, descMonto, descPct, mensajesAlerta);
  }

  private agregarProductoConBodega(
    prod: any,
    cant: number,
    bodegaId: any,
    descMonto: number,
    descPct: number,
    mensajesAlerta: string[]
  ): boolean {
    const stockActual = this.obtenerStock(prod.id, bodegaId) || 0;
    const yaEnCarrito = this.nuevaFactura.detalles
      .filter((d: any) => d.productoId === prod.id && d.bodegaId === bodegaId)
      .reduce((s: number, d: any) => s + Number(d.cantidad || 0), 0);
    const disponible = Math.max(0, stockActual - yaEnCarrito);

    if (disponible <= 0) {
      mensajesAlerta.push(`no hay stock de ${prod.nombre} en esa bodega`);
      return false;
    }
    if (cant > disponible) {
      mensajesAlerta.push(`solo agregué ${disponible} de ${prod.nombre} (stock)`);
      cant = disponible;
    }
    this.agregarProductoDirecto(prod, cant, bodegaId, descMonto, descPct);
    return true;
  }

  /**
   * Resuelve UN producto por su nombre (nombreIa).
   * - Si hay varios con el MISMO nombre exacto → siempre opciones.
   * - Si hay varios "iguales" (misma palabra principal / muy parecidos) → opciones.
   * - Solo auto-elige cuando hay un ganador claro y único.
   */
  private resolverMatchesProductoVoz(nombreIa: string, _fraseUsuario: string): any[] {
    const txt = this.limpiarTexto(nombreIa || '');
    if (!txt) return [];

    const stop = new Set([
      'agrega', 'agregue', 'agregar', 'añade', 'añadir', 'pon', 'poner', 'quiero', 'dame',
      'uno', 'una', 'unos', 'unas', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
      'ocho', 'nueve', 'diez', 'del', 'de', 'la', 'el', 'los', 'las', 'un', 'al', 'con',
      'por', 'para', 'y', 'o', 'que', 'me', 'te', 'le', 'se', 'producto', 'productos',
      'factura', 'favor', 'porfa', 'descuento', 'bodega', 'central', 'principal'
    ]);

    // 1) Nombre exacto idéntico (varias presentaciones / ids distintos)
    const exactos = this.dedupProductos(
      this.productosList.filter(p => this.limpiarTexto(p.nombre) === txt)
    );
    if (exactos.length === 1) return exactos;
    if (exactos.length > 1) return exactos.slice(0, 10); // iguales → opciones

    // 2) Iguales por palabra principal del nombre dicho (ej. varios "Mouse …")
    const tokens = txt.split(/\s+/).filter(t => t.length >= 3 && !stop.has(t));
    const tokenPrincipal = [...tokens].sort((a, b) => b.length - a.length)[0] || txt;

    if (tokenPrincipal.length >= 3) {
      // Coincidencia de palabra completa (límites de palabra)
      const rePalabra = new RegExp(`(?:^|\\s)${tokenPrincipal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
      const porPalabra = this.dedupProductos(
        this.productosList.filter(p => rePalabra.test(this.limpiarTexto(p.nombre)))
      );
      if (porPalabra.length > 1) {
        // Si todos empiezan igual o el token es el nombre completo → opciones sí o sí
        const todosMuyParecidos = porPalabra.every(p => {
          const n = this.limpiarTexto(p.nombre);
          return n === tokenPrincipal || n.startsWith(tokenPrincipal) || n.includes(tokenPrincipal);
        });
        if (todosMuyParecidos) return porPalabra.slice(0, 10);
      }
      if (porPalabra.length === 1) return porPalabra;
    }

    // 3) buscarProductos clásico
    const porNombre = this.buscarProductos(txt);
    if (porNombre.length === 1) {
      // Si ese único tiene clones de nombre exacto → opciones
      const clones = this.buscarHermanosProducto(porNombre[0]);
      return clones.length > 1 ? clones.slice(0, 10) : porNombre;
    }
    if (porNombre.length > 1) {
      // Rankear; si empate fuerte → opciones
      const scored = this.puntuarCandidatosProducto(porNombre, txt, tokens);
      return this.decidirMatchOpciones(scored);
    }

    // 4) Fallback por includes de tokens
    let candidatos: any[] = [];
    if (tokens.length > 0) {
      const pool: any[] = [];
      for (const t of tokens) {
        for (const p of this.productosList) {
          if (this.limpiarTexto(p.nombre).includes(t)) pool.push(p);
        }
      }
      candidatos = this.dedupProductos(pool);
    }
    if (candidatos.length === 0) return [];
    if (candidatos.length === 1) return candidatos;

    const scored = this.puntuarCandidatosProducto(candidatos, txt, tokens);
    return this.decidirMatchOpciones(scored);
  }

  private puntuarCandidatosProducto(candidatos: any[], txt: string, tokens: string[]): { p: any; score: number; nom: string }[] {
    return candidatos.map(p => {
      const nom = this.limpiarTexto(p.nombre);
      let score = 0;
      if (nom === txt) score += 100;
      if (nom.startsWith(txt)) score += 40;
      if (txt.startsWith(nom) && nom.length >= 4) score += 25;
      if (nom.includes(txt)) score += 20;
      for (const t of tokens) {
        if (nom === t) score += 30;
        else if (nom.startsWith(t)) score += 15;
        else if (nom.includes(t)) score += 8;
      }
      score -= Math.min(nom.length, 40) * 0.05;
      return { p, score, nom };
    }).sort((a, b) => b.score - a.score);
  }

  /** Si hay empate o varios con score casi igual → opciones; si no, el ganador. */
  private decidirMatchOpciones(scored: { p: any; score: number; nom: string }[]): any[] {
    if (!scored.length) return [];
    const top = scored[0];
    const segundo = scored[1];
    // Varios con el mismo nombre limpio → siempre opciones
    const mismoNombre = scored.filter(s => s.nom === top.nom);
    if (mismoNombre.length > 1) {
      return this.dedupProductos(mismoNombre.map(s => s.p)).slice(0, 10);
    }
    // Empate cercano (diferencia < 8) → opciones
    if (segundo && (top.score - segundo.score) < 8) {
      const empateMin = top.score - 6;
      return this.dedupProductos(
        scored.filter(s => s.score >= empateMin).map(s => s.p)
      ).slice(0, 10);
    }
    // Ganador claro
    if (top.score >= 15) return [top.p];
    // Scores bajos pero varios → opciones por si acaso
    if (scored.length > 1 && top.score >= 8) {
      return this.dedupProductos(scored.slice(0, 6).map(s => s.p));
    }
    return [top.p];
  }

  /** Productos con el mismo nombre exacto (presentaciones / ids distintos). */
  private buscarHermanosProducto(producto: any): any[] {
    if (!producto) return [];
    const nom = this.limpiarTexto(producto.nombre);
    const exactos = this.dedupProductos(
      this.productosList.filter(p => this.limpiarTexto(p.nombre) === nom)
    );
    return exactos.length > 0 ? exactos : [producto];
  }


  private buscarProductos(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    if (!txt) return [];

    const exact = this.productosList.filter(p => this.limpiarTexto(p.nombre) === txt);
    if (exact.length === 1) return exact;
    if (exact.length > 1) return exact; // mismos nombres → desambiguar

    const porCodigo = this.productosList.filter(p =>
      p.codigoPrincipal && this.limpiarTexto(String(p.codigoPrincipal)) === txt
    );
    if (porCodigo.length === 1) return porCodigo;
    if (porCodigo.length > 1) return porCodigo;

    const partial = this.productosList.filter(p => {
      const nom = this.limpiarTexto(p.nombre);
      return nom.includes(txt) || (txt.length >= 4 && txt.includes(nom));
    });
    const uniqPartial = this.dedupProductos(partial);
    if (uniqPartial.length === 1) return uniqPartial;
    if (uniqPartial.length > 1) {
      const starts = uniqPartial.filter(p => this.limpiarTexto(p.nombre).startsWith(txt));
      if (starts.length === 1 && uniqPartial.length <= 3) {
        return uniqPartial;
      }
      return starts.length > 1 ? starts : uniqPartial;
    }

    const palabras = txt.split(/\s+/).filter(p => p.length > 2);
    if (palabras.length > 0) {
      const porPalabras = this.productosList.filter(p => {
        const nom = this.limpiarTexto(p.nombre);
        return palabras.every(pal => nom.includes(pal));
      });
      const uniq = this.dedupProductos(porPalabras);
      if (uniq.length >= 1) return uniq;
    }

    const largas = txt.split(/\s+/).filter(p => p.length >= 4);
    if (largas.length > 0) {
      const suaves = this.productosList.filter(p => {
        const nom = this.limpiarTexto(p.nombre);
        return largas.some(pal => nom.includes(pal));
      });
      return this.dedupProductos(suaves);
    }

    return [];
  }

  private dedupProductos(lista: any[]): any[] {
    const seen = new Set<any>();
    const out: any[] = [];
    for (const p of lista) {
      if (p && p.id != null && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    return out.sort((a, b) => this.limpiarTexto(a.nombre).length - this.limpiarTexto(b.nombre).length);
  }

  private iniciarDesambiguacion(tipo: 'CLIENTE' | 'PRODUCTO' | 'BODEGA', opciones: any[], mensaje: string) {
    this.pausarMicYVoz();
    this.tipoOpciones = tipo;
    this.opcionesVoz = opciones.slice(0, 10);
    this.voiceState = VoiceStep.ELEGIR_OPCION;
    this.seleccionEnCurso = false;
    this.cdr.detectChanges();
    this.hablar(mensaje, () => {
      this.bloqueoEscucha = false;
      this.isThinking = false;
      this.escuchar();
    });
  }

  seleccionarOpcionVozManual(index: number) {
    if (this.voiceState !== VoiceStep.ELEGIR_OPCION || this.seleccionEnCurso) return;
    if (index < 0 || index >= this.opcionesVoz.length) return;

    this.seleccionEnCurso = true;
    this.pausarMicYVoz();
    const seleccionado = this.opcionesVoz[index];
    setTimeout(() => {
      this.procesarSeleccionDesambiguacion(seleccionado);
    }, 60);
  }

  private manejarDesambiguacion(transcript: string) {
    if (this.seleccionEnCurso) return;

    const t = (transcript || '').trim();
    if (t.length > 50) {
      this.hablar("Solo el número: uno, dos o tres.", () => {
        this.bloqueoEscucha = false;
        this.isThinking = false;
        this.escuchar();
      });
      return;
    }

    const num = this.extraerIndice(t, this.opcionesVoz.length);

    if (num >= 0 && num < this.opcionesVoz.length) {
      this.seleccionEnCurso = true;
      this.pausarMicYVoz();
      this.procesarSeleccionDesambiguacion(this.opcionesVoz[num]);
      return;
    }

    if (this.tipoOpciones === 'PRODUCTO' && t.length >= 3) {
      const porNombre = this.opcionesVoz.filter(p => {
        const nom = this.limpiarTexto(p.nombre);
        return nom === t || nom.startsWith(t) || (t.length >= 4 && nom.includes(t));
      });
      if (porNombre.length === 1) {
        this.seleccionEnCurso = true;
        this.pausarMicYVoz();
        this.procesarSeleccionDesambiguacion(porNombre[0]);
        return;
      }
      if (porNombre.length > 1) {
        this.hablar("Hay varias con ese nombre. Di el número de la lista.", () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
        return;
      }
    }
   if (this.tipoOpciones === 'CLIENTE') {
      // 1) Intentar buscar si el usuario dijo parte de la cédula (ej: "termina en 123" o solo "123")
      const soloNumeros = t.replace(/\D/g, '');
      if (soloNumeros.length >= 2) {
        const porDoc = this.opcionesVoz.filter(c => {
          const doc = String(c.dni || c.identificacion || '').replace(/\D/g, '');
          return doc.includes(soloNumeros) || doc.endsWith(soloNumeros);
        });
        
        if (porDoc.length === 1) {
          this.seleccionEnCurso = true;
          this.pausarMicYVoz();
          this.procesarSeleccionDesambiguacion(porDoc[0]);
          return;
        }
      }

      // 2) Intentar buscar por nombre si dijo letras
      if (t.length >= 3 && !/^\d+$/.test(t)) {
        const porNombre = this.opcionesVoz.filter(c => {
          const nom = this.limpiarTexto(c.nombreCompleto || `${c.primerNombre || ''} ${c.apellidoPaterno || ''}`);
          return nom.includes(t) || t.includes(nom);
        });
        
        if (porNombre.length === 1) {
          this.seleccionEnCurso = true;
          this.pausarMicYVoz();
          this.procesarSeleccionDesambiguacion(porNombre[0]);
          return;
        } else if (porNombre.length > 1) {
          // Si el usuario repite el mismo nombre y siguen habiendo varios
          this.hablar("Siguen habiendo varios. Di el número de la lista, uno, dos, o el final de su cédula.", () => {
            this.bloqueoEscucha = false;
            this.isThinking = false;
            this.escuchar();
          });
          return;
        }
      }
    }

    if (this.tipoOpciones === 'BODEGA' && t.length >= 2) {
      // 1. Limpiamos palabras de relleno comunes que el usuario dice por inercia
      const tLimpio = t.replace(/\b(de|la|el|en|bodega|desde|quiero|sacar|toma)\b/g, ' ').replace(/\s+/g, ' ').trim();

      const porNombre = this.opcionesVoz.filter(b => {
        const nom = this.limpiarTexto(b.nombre);
        // Validamos todas las combinaciones posibles
        return nom === t || 
               nom.startsWith(t) || 
               (t.length >= 3 && nom.includes(t)) || 
               (nom.length >= 3 && t.includes(nom)) || // 🔥 Esto atrapa "bodega central" si el nombre es "central"
               (tLimpio.length >= 3 && nom.includes(tLimpio));
      });

      if (porNombre.length === 1) {
        this.seleccionEnCurso = true;
        this.pausarMicYVoz();
        this.procesarSeleccionDesambiguacion(porNombre[0]);
        return;
      } else if (porNombre.length > 1) {
        this.hablar("Tengo varias bodegas que coinciden. Por favor di el número exacto.", () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
        return;
      }
    }

    this.hablar("No capté la opción. Di el número: uno, dos, tres...", () => {
      this.bloqueoEscucha = false;
      this.isThinking = false;
      this.escuchar();
    });
  }

  private procesarSeleccionDesambiguacion(seleccionado: any) {
    const tipo = this.tipoOpciones;
    this.opcionesVoz = [];
    this.tipoOpciones = null;
    this.voiceState = VoiceStep.ESCUCHA_LIBRE;

    if (tipo === 'CLIENTE') {
      this.seleccionarCliente(seleccionado);
      const emitir = this.quiereEmitirPendiente;
      const pendientes = this.datosVozPendientes
        ? { ...this.datosVozPendientes, cliente: null }
        : {};
      this.datosVozPendientes = null;
      this.itemsVozPendientes = [];
      this.quiereEmitirPendiente = false;
      this.seleccionEnCurso = false;
      // Reaplica productos + método de pago (tarjeta) que ya se dijeron
      this.aplicarDatosExtraidos(pendientes, emitir);
      return;
    }

    if (tipo === 'BODEGA') {
      const prod = this.productoPendienteBodega;
      const item = this.itemPendienteBodega || { cantidad: 1, descuento: 0, descuentoPorcentaje: 0 };
      this.productoPendienteBodega = null;
      this.itemPendienteBodega = null;
      this.esperandoBodega = false;
      this.seleccionEnCurso = false;

      // Recordar bodega elegida para el resto de productos pendientes
      if (seleccionado) {
        this.bodegaPreferidaVoz = seleccionado;
      }

      const alertas: string[] = [];
      let ok = false;
      if (prod && seleccionado) {
        ok = this.agregarProductoConBodega(
          prod,
          this.normalizarCantidadVoz(item.cantidad),
          seleccionado.id,
          Number(item.descuento || 0),
          Number(item.descuentoPorcentaje || 0),
          alertas
        );
      }

      const pendientes = [...this.itemsVozPendientes];
      const emitir = this.quiereEmitirPendiente;
      this.itemsVozPendientes = [];
      this.datosVozPendientes = null;

      if (pendientes.length > 0) {
        this.aplicarDatosExtraidos({ items: pendientes }, emitir);
        return;
      }

      if (!ok && alertas.length > 0) {
        this.hablar(`${alertas.join(', ')}. ¿Qué más?`, () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
        return;
      }

      if (emitir) {
        this.aplicarDatosExtraidos({}, true);
      } else {
        this.hablar(`Listo, ${prod?.nombre || 'producto'} desde ${seleccionado?.nombre || 'bodega'}. Total $${this.totalCarrito.toFixed(2)}. ¿Qué más?`, () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
      }
      return;
    }

    if (tipo === 'PRODUCTO') {
      const itemFake = {
        cantidad: this.itemTemp.cantidad || 1,
        descuento: this.itemTemp.descuento || 0,
        descuentoPorcentaje: this.itemTemp.descuentoPorcentaje || 0
      };
      const alertas: string[] = [];
      const ok = this.intentarAgregarProductoVoz(seleccionado, itemFake, alertas);

      this.itemTemp.cantidad = null;
      this.itemTemp.descuento = null;
      this.itemTemp.descuentoPorcentaje = null;

      // Si pidió bodega, no continuar aún
      if (this.esperandoBodega) {
        this.seleccionEnCurso = false;
        return;
      }

      const pendientes = [...this.itemsVozPendientes];
      const emitir = this.quiereEmitirPendiente;
      this.itemsVozPendientes = [];
      this.datosVozPendientes = null;
      this.seleccionEnCurso = false;

      if (pendientes.length > 0) {
        this.aplicarDatosExtraidos({ items: pendientes }, emitir);
        return;
      }

      if (!ok && alertas.length > 0) {
        this.hablar(`${alertas.join(', ')}. ¿Qué más agregamos?`, () => {
          this.bloqueoEscucha = false;
          this.isThinking = false;
          this.escuchar();
        });
        return;
      }

      if (emitir) {
        this.aplicarDatosExtraidos({}, true);
      } else {
        this.hablar(
          `Agregué ${seleccionado.nombre}. Total $${this.totalCarrito.toFixed(2)}. ¿Algo más o emitimos?`,
          () => {
            this.bloqueoEscucha = false;
            this.isThinking = false;
            this.escuchar();
          }
        );
      }
    } else {
      this.seleccionEnCurso = false;
      this.bloqueoEscucha = false;
      this.isThinking = false;
    }
  }

  private extraerIndice(texto: string, maxOpciones: number): number {
    const matchDigito = texto.match(/\d+/);
    if (matchDigito) {
      const idx = parseInt(matchDigito[0], 10) - 1;
      if (idx >= 0 && idx < maxOpciones) return idx;
    }
    if (texto.includes('primer') || texto.includes('uno')) return 0;
    if (texto.includes('segund') || texto.includes('dos')) return 1;
    if (texto.includes('tercer') || texto.includes('tres')) return 2;
    if (texto.includes('cuart') || texto.includes('cuatro')) return 3;
    if (texto.includes('quint') || texto.includes('cinco')) return 4;
    return -1;
  }


  agregarAlCarrito() {
    if (!this.itemTemp.productoId || !this.itemTemp.bodegaId || this.itemTemp.cantidad <= 0) {
      Swal.fire('Atención', 'Selecciona producto, bodega y una cantidad válida.', 'warning');
      return;
    }
    const prodSelect = this.productosList.find(p => p.id === this.itemTemp.productoId);
    if (!prodSelect) return;

    let cant = Math.abs(Number(this.itemTemp.cantidad));
    const stockActual = this.obtenerStock(prodSelect.id, this.itemTemp.bodegaId);
    if (stockActual !== null && cant > stockActual) {
      cant = stockActual;
      Swal.fire('Stock Limitado', `Solo quedan ${stockActual} unidades disponibles.`, 'info');
    }

    const precioUnit = this.precioParaFactura(prodSelect);
    let descPct = Number(this.itemTemp.descuentoPorcentaje || 0);
    let descMonto = Number(this.itemTemp.descuento || 0);
    if (descPct > 0) {
      descMonto = (precioUnit * cant * descPct) / 100;
    }

    if (cant > 0) {
      this.agregarProductoDirecto(prodSelect, cant, this.itemTemp.bodegaId, descMonto, descPct);
    }
    this.itemTemp = {
      productoId: null,
      bodegaId: this.itemTemp.bodegaId,
      cantidad: null,
      descuento: null,
      descuentoPorcentaje: null,
      productoNombre: ''
    };
  }


  private agregarProductoDirecto(
    producto: any,
    cantidad: number,
    bodegaId: any,
    descuento: number = 0,
    descuentoPorcentaje: number = 0
  ) {
    if (!producto || !bodegaId || cantidad <= 0) return;

    const precio = this.precioParaFactura(producto);
    if (precio <= 0) {
      Swal.fire('Error', `El producto "${producto.nombre}" no tiene costo promedio ni precio configurado.`, 'error');
      return;
    }

    const grabaIva = !!producto.grabaIva;
    const bodSelect = this.bodegasList.find((b: any) => b.id === bodegaId);
    const bodegaNombre = bodSelect ? bodSelect.nombre : 'Principal';
    const costoProm = Number(producto.costoPromedioActual || producto.costoPromedio || 0);

    const idxExistente = this.nuevaFactura.detalles.findIndex(
      (d: any) => d.productoId === producto.id && d.bodegaId === bodegaId
    );

    if (idxExistente !== -1) {
      const existente = this.nuevaFactura.detalles[idxExistente];
      const nuevaCant = Number(existente.cantidad) + cantidad;
      let nuevoDesc = Number(existente.descuento || 0) + descuento;
      let nuevoPct = Number(existente.descuentoPorcentaje || 0);
      if (descuentoPorcentaje > 0) {
        nuevoPct = descuentoPorcentaje;
        nuevoDesc = (precio * nuevaCant * nuevoPct) / 100;
      }
      const nuevoSub = (precio * nuevaCant) - nuevoDesc;
      if (nuevoSub < 0) {
        Swal.fire('Error', `El descuento no puede ser mayor al total de ${producto.nombre}.`, 'error');
        return;
      }
      existente.cantidad = nuevaCant;
      existente.descuento = nuevoDesc;
      existente.descuentoPorcentaje = nuevoPct;
      existente.subtotal = nuevoSub;
      existente.precioUnitario = precio; // costo promedio (o PVP fallback)
      existente.costoPromedioActual = costoProm;
      existente.grabaIva = grabaIva;
      this.cdr.detectChanges();
      return;
    }

    const subtotal = (precio * cantidad) - descuento;
    if (subtotal < 0) {
      Swal.fire('Error', `El descuento no puede ser mayor al total de ${producto.nombre}.`, 'error');
      return;
    }

    this.nuevaFactura.detalles.push({
      productoId: producto.id,
      bodegaId: bodegaId,
      bodegaNombre: bodegaNombre,
      cantidad: cantidad,
      productoNombre: producto.nombre,
      precioUnitario: precio,
      costoPromedioActual: costoProm,
      descuento: descuento,
      descuentoPorcentaje: descuentoPorcentaje || 0,
      grabaIva: grabaIva,
      subtotal: subtotal
    });
    this.cdr.detectChanges();
  }

  private buscarIndiceEnCarrito(nombreBuscado: string): number {
    const t = this.limpiarTexto(nombreBuscado);
    if (!t) return -1;
    let idx = this.nuevaFactura.detalles.findIndex((d: any) =>
      this.limpiarTexto(d.productoNombre).includes(t) || t.includes(this.limpiarTexto(d.productoNombre))
    );
    if (idx !== -1) return idx;
    const pals = t.split(/\s+/).filter(p => p.length > 2);
    if (pals.length === 0) return -1;
    return this.nuevaFactura.detalles.findIndex((d: any) => {
      const nom = this.limpiarTexto(d.productoNombre);
      return pals.every(p => nom.includes(p));
    });
  }


  private modificarCantidadEnCarrito(nombreProducto: string, nuevaCantidad: number): boolean {
    const idx = this.buscarIndiceEnCarrito(nombreProducto);
    if (idx === -1) return false;
    const line = this.nuevaFactura.detalles[idx];
    if (!Number.isFinite(nuevaCantidad) || nuevaCantidad < 0) return false;

    if (nuevaCantidad === 0) {
      this.eliminarDelCarrito(idx);
      return true;
    }

    const stock = this.obtenerStock(line.productoId, line.bodegaId);
    let cant = Math.floor(nuevaCantidad);
    if (stock !== null && cant > stock) {
      cant = stock;
    }

    const precio = Number(line.precioUnitario) || 0;
    let desc = Number(line.descuento || 0);
    const pct = Number(line.descuentoPorcentaje || 0);
    if (pct > 0) {
      desc = (precio * cant * pct) / 100;
    }
    const sub = (precio * cant) - desc;
    if (sub < 0) return false;

    line.cantidad = cant;
    line.descuento = desc;
    line.subtotal = sub;
    this.cdr.detectChanges();
    return true;
  }

  eliminarDelCarrito(index: number) {
    this.nuevaFactura.detalles.splice(index, 1);
    this.cdr.detectChanges();
  }

  confirmarYGuardarFactura() {
    if ((!this.nuevaFactura.clienteId && !this.esConsumidorFinal) || this.nuevaFactura.detalles.length === 0) {
      Swal.fire('Error', 'Faltan datos para emitir la factura (cliente y al menos un producto).', 'error');
      return;
    }
    const errTarjeta = this.validarTarjetaAntesDeEmitir();
    if (errTarjeta) {
      Swal.fire('Tarjeta incompleta', errTarjeta, 'warning');
      return;
    }
    const total = this.totalCarrito;
    Swal.fire({
      title: '¿Confirmar emisión?',
      html: `Total a cobrar: <strong>$${total.toFixed(2)}</strong><br>Se registrará la factura y se descontará el stock.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#ed8936',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, emitir',
      cancelButtonText: 'Revisar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.guardarFactura();
      }
    });
  }

  guardarFactura() {
    if ((!this.nuevaFactura.clienteId && !this.esConsumidorFinal) || this.nuevaFactura.detalles.length === 0) {
      Swal.fire('Error', 'Faltan datos para emitir la factura.', 'error');
      return;
    }

    const errTarjeta = this.validarTarjetaAntesDeEmitir();
    if (errTarjeta) {
      this.isSaving = false;
      Swal.fire('Tarjeta incompleta', errTarjeta, 'warning');
      return;
    }

    // Cortar voz al emitir → modal no se queda colgado
    this.cancelarAsistenteVoz();
    this.isSaving = true;
    Swal.fire({
      title: 'Emitiendo...',
      allowOutsideClick: false,
      timer: 8000,
      didOpen: () => Swal.showLoading()
    });

    const descGlobal = this.descuentoGlobalMonto;
    this.nuevaFactura.descuentoGlobal = descGlobal;

    const payload = {
      clienteId: this.nuevaFactura.clienteId,
      metodoPago: this.nuevaFactura.metodoPago,
      tarjeta: this.nuevaFactura.detallesTarjeta,
      numeroCuotas: this.nuevaFactura.numeroCuotas,
      descuentoGlobal: descGlobal,
      detalles: this.nuevaFactura.detalles.map((d: any) => ({
        productoId: d.productoId,
        bodegaId: d.bodegaId,
        cantidad: d.cantidad,
        descuento: d.descuento || 0
      }))
    };

    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    const emailUsuario = encodeURIComponent(usuarioLogueado?.email || '');

    this.http.post<any>(
      `${this.apiUrl}/negocios/${this.negocioId}/facturas?emailUsuario=${emailUsuario}`,
      payload,
      { headers: this.getAuthHeaders() }
    ).subscribe({
      next: (res) => {
        this.isSaving = false;
        // Cerrar modal YA (antes del PDF / toast)
        this.showModal = false;
        this.cancelarAsistenteVoz();
        this.cdr.detectChanges();

        const detallesCarrito = this.nuevaFactura.detalles.map((d: any) => ({ ...d }));
        const totalApi = Number(res.totalFactura ?? res.total ?? 0);
        const ivaApi = Number(res.totalIva ?? 0);
        const sub0Api = Number(res.subtotalIva0 ?? 0);
        const subGravApi = Number(res.subtotalIvaAplicado ?? 0);

        const facturaParaPDF = {
          numero: res.numeroFactura || 'S/N',
          cliente: res.clienteNombre || (this.esConsumidorFinal ? 'Consumidor Final' : 'Cliente'),
          fecha: res.fechaEmision ? new Date(res.fechaEmision).toLocaleDateString() : new Date().toLocaleDateString(),
          monto: totalApi > 0 ? totalApi : this.totalCarrito,
          tipo: res.formaPago || this.nuevaFactura.metodoPago || 'Manual',
          descuentoGlobal: descGlobal,
          subtotalIva0: sub0Api > 0 ? sub0Api : this.subtotalExento,
          subtotalIvaAplicado: subGravApi > 0 ? subGravApi : this.subtotalGravado,
          totalIva: ivaApi > 0 ? ivaApi : this.montoIva,
          porcentajeIva: Number(res.porcentajeIvaAplicado || (this.ivaActual * 100)),
          detalles: (res.detallesFactura || res.detalles || []).length
            ? this.fusionarDetallesPdf(res.detallesFactura || res.detalles, detallesCarrito)
            : detallesCarrito
        };

        Swal.close();
        Swal.fire({
          icon: 'success',
          title: '¡Factura emitida!',
          timer: 900,
          showConfirmButton: false
        });
        // PDF un instante después para no retrasar el cierre del modal
        setTimeout(() => this.imprimirFacturaPDF(facturaParaPDF), 50);
        if (this.negocioId) this.cargarTodasLasFacturas(this.negocioId);
      },
      error: (err) => {
        this.isSaving = false;
        const msg = typeof err.error === 'string' ? err.error : (err.error?.message || 'Error al emitir');
        Swal.fire('Error', msg, 'error');
      }
    });
  }


  /** Normaliza líneas de factura (API o lista) para el preview. */
  private normalizarDetallesPreview(raw: any[]): any[] {
    return (raw || []).map((d: any) => {
      const cant = Number(d.cantidad ?? 1);
      const precio = Number(d.precioUnitario ?? d.precio ?? d.costoPromedioActual ?? 0);
      const desc = Number(d.descuento ?? d.descuentoItem ?? 0);
      const sub = Number(d.subtotal ?? d.subtotalItem ?? (precio * cant - desc));
      return {
        productoId: d.productoId ?? d.producto?.id ?? null,
        productoNombre: d.productoNombre || d.producto?.nombre || d.descripcion || d.nombre || 'Producto',
        bodegaNombre: d.bodegaNombre || d.bodega?.nombre || '',
        cantidad: cant,
        precioUnitario: precio,
        descuento: desc,
        subtotal: sub,
        grabaIva: !!(d.grabaIva ?? d.producto?.grabaIva)
      };
    });
  }

  abrirPreviewFactura(fac: any) {
    if (!fac) return;
    this.facturaPreview = {
      ...fac,
      detalles: this.normalizarDetallesPreview(fac.detalles || [])
    };
    this.showPreviewFactura = true;
    this.cdr.detectChanges();

    // Si la lista no trajo productos, pedir detalle al backend
    const needsFetch = !this.facturaPreview.detalles?.length && fac.id && this.negocioId;
    if (!needsFetch) return;

    this.isLoadingPreview = true;
    this.http.get<any>(
      `${this.apiUrl}/negocios/${this.negocioId}/facturas/${fac.id}`,
      { headers: this.getAuthHeaders() }
    ).subscribe({
      next: (res) => {
        const det = res?.detallesFactura || res?.detalles || res?.items || [];
        this.facturaPreview = {
          ...this.facturaPreview,
          numero: res?.numeroFactura || this.facturaPreview.numero,
          cliente: res?.clienteNombre || this.facturaPreview.cliente,
          tipo: res?.formaPago || this.facturaPreview.tipo,
          monto: Number(res?.totalFactura ?? res?.total ?? this.facturaPreview.monto),
          descuentoGlobal: Number(res?.totalDescuento ?? res?.descuentoGlobal ?? this.facturaPreview.descuentoGlobal ?? 0),
          subtotalIva0: Number(res?.subtotalIva0 ?? this.facturaPreview.subtotalIva0 ?? 0),
          subtotalIvaAplicado: Number(res?.subtotalIvaAplicado ?? this.facturaPreview.subtotalIvaAplicado ?? 0),
          totalIva: Number(res?.totalIva ?? this.facturaPreview.totalIva ?? 0),
          porcentajeIva: Number(res?.porcentajeIvaAplicado ?? this.facturaPreview.porcentajeIva ?? (this.ivaActual * 100)),
          detalles: this.normalizarDetallesPreview(det)
        };
        this.isLoadingPreview = false;
        this.cdr.detectChanges();
      },
      error: () => {
        // Fallback: intentar lista anidada con query
        this.http.get<any[]>(
          `${this.apiUrl}/negocios/${this.negocioId}/facturas/${fac.id}/detalles`,
          { headers: this.getAuthHeaders() }
        ).subscribe({
          next: (det) => {
            this.facturaPreview = {
              ...this.facturaPreview,
              detalles: this.normalizarDetallesPreview(Array.isArray(det) ? det : [])
            };
            this.isLoadingPreview = false;
            this.cdr.detectChanges();
          },
          error: () => {
            this.isLoadingPreview = false;
            this.cdr.detectChanges();
          }
        });
      }
    });
  }

  cerrarPreviewFactura() {
    this.showPreviewFactura = false;
    this.facturaPreview = null;
    this.isLoadingPreview = false;
  }

  descargarPDF(fac: any) {
    this.imprimirFacturaPDF(fac);
  }

  private fusionarDetallesPdf(apiDetalles: any[], carrito: any[]): any[] {
    return apiDetalles.map((api: any, i: number) => {
      const cart = carrito.find((c: any) => c.productoId === (api.productoId || api.producto?.id))
        || carrito[i];
      const precio = Number(api.precioUnitario ?? api.precio ?? cart?.precioUnitario ?? 0);
      const cant = Number(api.cantidad ?? cart?.cantidad ?? 1);
      const desc = Number(api.descuento ?? cart?.descuento ?? 0);
      const sub = Number(api.subtotalItem ?? api.subtotal ?? cart?.subtotal ?? (precio * cant - desc));
      return {
        ...api,
        productoNombre: api.producto?.nombre || api.productoNombre || cart?.productoNombre || 'Producto',
        precioUnitario: precio,
        cantidad: cant,
        descuento: desc,
        subtotal: sub,
        grabaIva: api.grabaIva ?? api.producto?.grabaIva ?? cart?.grabaIva ?? false
      };
    });
  }


  private calcularTotalesDesdeDetalles(detalles: any[], descuentoGlobal: number, tasaIva: number) {
    let gravado = 0;
    let exento = 0;
    for (const item of detalles || []) {
      const precio = Number(item.precioUnitario ?? item.precio ?? 0);
      const cant = Number(item.cantidad ?? 1);
      const desc = Number(item.descuento ?? 0);
      const sub = Number(item.subtotal ?? item.subtotalItem ?? (precio * cant - desc));
      const graba = !!(item.grabaIva ?? item.producto?.grabaIva);
      if (graba) gravado += sub;
      else exento += sub;
    }
    const bruto = gravado + exento;
    const desc = Math.min(Math.max(0, descuentoGlobal), bruto);
    const descGrav = bruto > 0 ? desc * (gravado / bruto) : 0;
    const descEx = desc - descGrav;
    const baseGrav = Math.max(0, gravado - descGrav);
    const baseEx = Math.max(0, exento - descEx);
    const iva = baseGrav * tasaIva;
    const total = baseGrav + baseEx + iva;
    return {
      subtotal: baseGrav + baseEx,
      baseGravada: baseGrav,
      baseExenta: baseEx,
      iva,
      total,
      descuentoGlobal: desc
    };
  }

  imprimirFacturaPDF(fac: any) {
    const detalles = Array.isArray(fac.detalles) ? fac.detalles : [];
    const descuentoGlobalIn = Number(fac.descuentoGlobal || 0);
    const tasa = (fac.porcentajeIva != null ? Number(fac.porcentajeIva) : (this.ivaActual * 100)) / 100;
    const porcentajeIvaMostrar = (tasa * 100).toFixed(0);

    let iva = Number(fac.totalIva);
    let subtotal = Number(fac.subtotalIva0 || 0) + Number(fac.subtotalIvaAplicado || 0);
    let total = Number(fac.monto || 0);
    let descuentoGlobal = descuentoGlobalIn;

    const calc = this.calcularTotalesDesdeDetalles(detalles, descuentoGlobalIn, tasa || this.ivaActual);
    const hayGravados = detalles.some((d: any) => !!(d.grabaIva ?? d.producto?.grabaIva));

    if (!(iva > 0) || !(subtotal > 0) || !(total > 0) || (hayGravados && !(iva > 0))) {
      subtotal = calc.subtotal;
      iva = calc.iva;
      total = calc.total;
      descuentoGlobal = calc.descuentoGlobal;
    } else {
      if (!(subtotal > 0) && total > 0) {
        subtotal = Math.max(0, total - iva);
      }
    }

    let filasProductos = '';
    const baseUrl = window.location.origin;

    if (detalles.length > 0) {
      detalles.forEach((item: any) => {
        const cantidad = Number(item.cantidad || 1);
        const descripcion = item.producto?.nombre || item.productoNombre || item.descripcion || 'Producto / Servicio';
        const precioUnit = Number(item.precioUnitario || item.precio || 0);
        const descItem = Number(item.descuento || 0);
        const subtotalItem = Number(item.subtotal || item.subtotalItem || ((cantidad * precioUnit) - descItem));
        const descHtml = descItem > 0
          ? `<br><small style="color: #ea580c; font-weight: bold;">(Desc. línea: -$${descItem.toFixed(2)})</small>`
          : '';

        filasProductos += `
          <tr>
            <td class="center">${cantidad}</td>
            <td>${descripcion}${descHtml}</td>
            <td class="text-right">$${precioUnit.toFixed(2).replace('.', ',')}</td>
            <td class="text-right font-bold">$${subtotalItem.toFixed(2).replace('.', ',')}</td>
          </tr>`;
      });
    } else {
      filasProductos = `
        <tr>
          <td class="center">1</td>
          <td>Consumo general</td>
          <td class="text-right">$${subtotal.toFixed(2).replace('.', ',')}</td>
          <td class="text-right font-bold">$${subtotal.toFixed(2).replace('.', ',')}</td>
        </tr>`;
    }

    const htmlDescuento = descuentoGlobal > 0 ? `
        <div class="total-row">
            <span>Descuento Factura</span>
            <span class="font-bold" style="color: #ea580c;">-$${descuentoGlobal.toFixed(2).replace('.', ',')}</span>
        </div>` : '';

    const ventana = window.open('', '', 'width=900,height=700');
    ventana?.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Factura_${fac.numero}</title>
          <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
              body { font-family: 'Inter', sans-serif; color: #1e293b; margin: 0; padding: 0; background-color: #f8fafc; }
              .invoice-container { max-width: 800px; margin: 0 auto; background: #fff; padding: 50px; box-sizing: border-box; }
              .top-bar { height: 8px; background: linear-gradient(90deg, #ed8936, #ea580c); width: 100%; margin-bottom: 30px; border-radius: 4px; }
              .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
              
              .logo img { max-height: 50px; object-fit: contain; margin-bottom: 10px; }
              
              .company-details { font-size: 13px; color: #64748b; line-height: 1.6; }
              .invoice-title-area { text-align: right; }
              .invoice-title-area h1 { margin: 0 0 5px 0; font-size: 32px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 1px;}
              .invoice-title-area .invoice-no { font-size: 16px; color: #ed8936; font-weight: 700; }
              .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px; background: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #e2e8f0; }
              .info-block h3 { margin: 0 0 10px 0; font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; }
              .info-block p { margin: 0 0 5px 0; font-size: 15px; font-weight: 600; color: #0f172a; }
              .info-block span { display: block; font-size: 14px; color: #475569; font-weight: 400; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
              th { background-color: #0f172a; color: white; padding: 14px 15px; text-align: left; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;}
              th:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
              th:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
              td { padding: 16px 15px; font-size: 14px; color: #334155; border-bottom: 1px solid #e2e8f0; }
              .text-right { text-align: right; }
              .center { text-align: center; }
              .font-bold { font-weight: 700; color: #0f172a; }
              .totals-wrapper { display: flex; justify-content: flex-end; margin-bottom: 40px; }
              .totals-box { width: 320px; }
              .total-row { display: flex; justify-content: space-between; padding: 12px 15px; font-size: 14px; color: #475569; border-bottom: 1px solid #f1f5f9; }
              .total-row.grand-total { background: #0f172a; color: white; border-radius: 8px; font-size: 18px; font-weight: 700; border: none; margin-top: 10px; padding: 16px 20px;}
              .total-row.grand-total span:last-child { color: #ed8936; }
              .footer { text-align: center; padding-top: 30px; border-top: 2px dashed #e2e8f0; color: #64748b; font-size: 13px; }
              .footer p { margin: 5px 0; }
              .footer-bold { font-weight: 600; color: #0f172a; }
          </style>
      </head>
      <body>
          <div class="invoice-container">
              <div class="top-bar"></div>
              <div class="header">
                  <div>
                      <div class="logo">
                          <img src="${baseUrl}/images/Dilo-Logo-2-.png" alt="Dilo">
                      </div>
                      <div class="company-details">
                          <strong>Mi Negocio S.A.</strong><br>
                          RUC: 0102030405001<br>
                          Cuenca, Azuay, Ecuador<br>
                          contacto@minegocio.com
                      </div>
                  </div>
                  <div class="invoice-title-area">
                      <h1>FACTURA</h1>
                      <div class="invoice-no">Nº ${fac.numero}</div>
                  </div>
              </div>

              <div class="info-grid">
                  <div class="info-block">
                      <h3>Facturar a:</h3>
                      <p>${fac.cliente}</p>
                      <span>Consumidor Final / Cliente</span>
                  </div>
                  <div class="info-block" style="text-align: right;">
                      <h3>Detalles del Documento:</h3>
                      <p>Fecha: <span>${fac.fecha}</span></p>
                      <p>Método de Pago: <span>${fac.tipo}</span></p>
                  </div>
              </div>

              <table>
                  <thead>
                      <tr>
                          <th class="center" width="10%">Cant.</th>
                          <th width="50%">Descripción del Producto</th>
                          <th class="text-right" width="20%">P. Unitario</th>
                          <th class="text-right" width="20%">Total</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${filasProductos}
                  </tbody>
              </table>

              <div class="totals-wrapper">
                  <div class="totals-box">
                  ${htmlDescuento}
                      <div class="total-row">
                          <span>Subtotal (Sin IVA)</span>
                          <span class="font-bold">$${subtotal.toFixed(2).replace('.', ',')}</span>
                      </div>
                      <div class="total-row">
                          <span>IVA (${porcentajeIvaMostrar}%)</span>
                          <span class="font-bold">$${iva.toFixed(2).replace('.', ',')}</span>
                      </div>
                      <div class="total-row grand-total">
                          <span>TOTAL</span>
                          <span>$${total.toFixed(2).replace('.', ',')}</span>
                      </div>
                  </div>
              </div>

              <div class="footer">
                  <p class="footer-bold">¡Gracias por preferir nuestros servicios!</p>
                  <p>Documento generado electrónicamente por <strong>Dilo Sistema de Gestión</strong>.</p>
              </div>
          </div>
      </body>
      </html>
    `);

    ventana?.document.close();
    ventana?.focus();

    setTimeout(() => {
      ventana?.print();
    }, 800);

    if (ventana) {
      ventana.onafterprint = () => {
        ventana.close();
      };
    }
  }

  ocultarDropdown() {
    setTimeout(() => {
      this.mostrarDropdownClientes = false;
      this.cdr.detectChanges();
    }, 250);
  }
}
