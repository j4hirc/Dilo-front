import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import Swal from 'sweetalert2';

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
  imports: [CommonModule, FormsModule],
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
  /** Ítems de voz pendientes cuando hay que desambiguar un producto primero */
  private itemsVozPendientes: any[] = [];
  private datosVozPendientes: any = null;
  /** Última frase del usuario: evita que la IA elija un producto al azar entre muchos similares */
  private ultimaFraseUsuario: string = '';
  /** Bloquea micrófono/TTS mientras se procesa un clic o selección (evita que se escuche sola) */
  private bloqueoEscucha = false;
  private seleccionEnCurso = false;

  // 🔥 CÁLCULOS alineados con el backend:
  // - precioUnitario = PVP SIN IVA incluido
  // - IVA se suma solo sobre productos con grabaIva
  // - total = bases (tras descuento global) + IVA
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

  /** Suma de líneas con IVA (antes del descuento global) */
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

  /** Base imponible tras prorratear el descuento global */
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

  /** Total a cobrar = bases netas + IVA */
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
          detalles: f.detallesFactura || f.detalles || f.items || []
        }));
        
        this.facturasBase = [...this.facturas]; // 🔥 NUEVO: Guardamos la original para buscar
        
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => this.isLoading = false
    });
  }

  // 🔥 NUEVO: Función para buscar facturas en tiempo real
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
      this.productosList = Array.isArray(productos) ? productos : [];
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
    this.cdr.detectChanges();
  }

  private limpiarTexto(texto: any): string {
    if (!texto) return '';
    return String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  private buscarClientesUniversales(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    if (!txt) return [...this.clientesList];
    
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

    const palabras = txt.split(' ').filter(p => p.length > 2);
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
    this.cdr.detectChanges(); 
  }

  limpiarClienteSeleccionado() {
    this.nuevaFactura.clienteId = null;
    this.esConsumidorFinal = false;
    this.clienteSeleccionadoInfo = null;
    this.terminoBusquedaCliente = '';
    this.clientesFiltrados = [...this.clientesList];
  }

  initSpeechRecognition() {
    const { webkitSpeechRecognition } = window as any;
    if (!webkitSpeechRecognition) return;

    this.recognition = new webkitSpeechRecognition();
    this.recognition.lang = 'es-EC'; 
    this.recognition.continuous = true; 
    this.recognition.interimResults = true; 

    this.recognition.onresult = (event: any) => {
      // Ignorar audio mientras se procesa un clic o la IA está pensando
      if (this.bloqueoEscucha || this.seleccionEnCurso || this.isThinking) return;

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
      // En desambiguación responde más rápido (2.2s); en libre 4.5s
      const espera = this.voiceState === VoiceStep.ELEGIR_OPCION ? 2200 : 4500;
      this.silenceTimer = setTimeout(() => {
          if (this.bloqueoEscucha || this.seleccionEnCurso || this.isThinking) return;
          try { this.recognition.stop(); } catch (e) {}
          if (this.userTranscript) {
              this.isListening = false;
              this.procesarComandoVoz(this.userTranscript);
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
      // aborted / no-speech: no reiniciar si estamos bloqueados
    };

    this.recognition.onend = () => {
      // NUNCA reiniciar solo si hay bloqueo, pensamiento o selección en curso
      if (
        this.voiceState !== VoiceStep.OFF &&
        !this.isThinking &&
        !this.bloqueoEscucha &&
        !this.seleccionEnCurso &&
        this.isListening
      ) {
          try { this.recognition.start(); } catch (e) {}
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
    clearTimeout(this.silenceTimer);
    window.speechSynthesis.cancel();
    if (this.recognition) {
      try { this.recognition.abort(); } catch (e) {}
    }
    this.cdr.detectChanges();
  }

  /** Corta micrófono + voz de golpe (clic en opción o cambio de estado) */
  private pausarMicYVoz() {
    this.bloqueoEscucha = true;
    this.isListening = false;
    this.isThinking = true;
    this.transcriptAcumulado = '';
    this.userTranscript = '';
    clearTimeout(this.silenceTimer);
    window.speechSynthesis.cancel();
    if (this.recognition) {
      try { this.recognition.abort(); } catch (e) {}
    }
    this.cdr.detectChanges();
  }

  private hablar(texto: string, callback?: () => void) {
    // Mientras habla no debe escuchar (evita eco / confusión)
    this.bloqueoEscucha = true;
    this.isListening = false;
    this.isThinking = true;
    clearTimeout(this.silenceTimer);
    this.transcriptAcumulado = '';
    window.speechSynthesis.cancel();
    if (this.recognition) {
      try { this.recognition.abort(); } catch (e) {}
    }

    setTimeout(() => {
        if (this.voiceState === VoiceStep.OFF) return;

        this.voiceMessage = texto;
        this.userTranscript = '';
        this.cdr.detectChanges();

        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = 'es-ES';
        utterance.rate = 1.35;
        utterance.pitch = 1.2;

        let voices = window.speechSynthesis.getVoices();
        let femaleVoice = voices.find(v =>
          v.lang.startsWith('es') &&
          /(sabina|paulina|helena|monica|victoria|lucia|sofia|laura|isabel|carmen|female|mujer|google español)/i.test(v.name)
        );
        if (!femaleVoice) {
          femaleVoice = voices.find(v =>
            v.lang.startsWith('es') && !/(pablo|jorge|diego|carlos|male|hombre)/i.test(v.name)
          );
        }
        if (femaleVoice) utterance.voice = femaleVoice;

        const fin = () => {
          this.isThinking = false;
          this.bloqueoEscucha = false;
          if (callback && this.voiceState !== VoiceStep.OFF && !this.seleccionEnCurso) {
            callback();
          }
        };
        utterance.onend = fin;
        utterance.onerror = fin;

        window.speechSynthesis.speak(utterance);
    }, 80);
  }

  private escuchar() {
    if (
      this.voiceState === VoiceStep.OFF ||
      this.voiceState === VoiceStep.INICIANDO ||
      this.bloqueoEscucha ||
      this.seleccionEnCurso ||
      this.isThinking
    ) {
      return;
    }
    this.isListening = true;
    this.cdr.detectChanges();
    try { this.recognition.start(); } catch (e) {}
  }

  private procesarComandoVoz(transcript: string) {
    this.transcriptAcumulado = ''; 
    // Normalizar: minúsculas, sin acentos, sin puntuación al final
    const transcriptLimpio = this.limpiarTexto(transcript).replace(/[.,;:!?¡¿]+/g, ' ').replace(/\s+/g, ' ').trim();

    const comandosLimpiar = ['borra todo', 'borrar todo', 'limpiar carrito', 'reiniciar', 'vaciar ticket', 'cancela todo'];
    if (comandosLimpiar.some(cmd => transcriptLimpio.includes(cmd))) {
        this.nuevaFactura.detalles = [];
        this.limpiarClienteSeleccionado();
        this.nuevaFactura.descuentoGlobal = 0;
        this.nuevaFactura.descuentoGlobalPorcentaje = 0;
        this.nuevaFactura.detallesTarjeta = '';
        this.hablar("He vaciado el ticket por completo. Empecemos de cero.", () => this.escuchar());
        return;
    }

    // 🔥 Desambiguación por número/clic: NO mandar a Groq
    if (this.voiceState === VoiceStep.ELEGIR_OPCION) {
      this.manejarDesambiguacion(transcriptLimpio);
      return;
    }

    // 🔥 Confirmación de emisión: sí / no sin pasar por la IA
    if (this.voiceState === VoiceStep.CONFIRMAR) {
      if (this.esRespuestaAfirmativa(transcriptLimpio)) {
        this.voiceState = VoiceStep.OFF;
        this.hablar("¡Listo! Emitiendo la factura.");
        setTimeout(() => { this.guardarFactura(); }, 800);
        return;
      }
      if (this.esRespuestaNegativa(transcriptLimpio)) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar("De acuerdo, no emitimos aún. ¿Qué deseas cambiar o agregar?", () => this.escuchar());
        return;
      }
      // Si no es sí/no claro, puede estar pidiendo más productos o un descuento → analizar
      // pero no forzamos emisión
    }

    const comandosEmitir = ['emite', 'emitir', 'factura ya', 'cobrar ya', 'guarda la factura', 'guardar factura', 'todo bien', 'listo', 'cobra', 'cobrar'];
    const quiereEmitir = comandosEmitir.some(cmd => transcriptLimpio.includes(cmd));

    this.analizarConGroq(transcriptLimpio, quiereEmitir);
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

    const instruccionCliente = (this.nuevaFactura.clienteId || this.esConsumidorFinal)
      ? `"cliente": null,` 
      : `"cliente": "Extrae el nombre, cédula, o pon 'CONSUMIDOR_FINAL'",`;

    const listaNombresCli = this.clientesList.map(c => c.nombreCompleto || c.primerNombre).join(', ').substring(0, 600);
    const listaNombresProd = this.productosList.map(p => p.nombre).join(', ').substring(0, 600);

    const promptSystem = `
      Eres la IA de un POS. Extrae SOLO lo que el usuario dijo explícitamente. JSON puro, sin texto extra.

      Clientes: [${listaNombresCli}]
      Productos: [${listaNombresProd}]

      Formato:
      {
         ${instruccionCliente}
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | null,
         "detallesTarjeta": null,
         "cuotas": null,
         "descuentoGlobal": null,
         "descuentoGlobalPorcentaje": null,
         "items": [],
         "eliminarProducto": null,
         "emitirFactura": false
      }

      REGLAS ESTRICTAS (no inventes NADA):
      1. metodoPago: SOLO si dijo "efectivo", "transferencia/depósito" o "tarjeta/crédito". Si NO habló de pago → null. NUNCA pongas TARJETA_CREDITO por defecto.
      2. detallesTarjeta / cuotas: SOLO si mencionó tarjeta Y datos de tarjeta o meses. Si no → null.
      3. items: SOLO productos que el usuario nombró. Si solo habló de cliente/pago/descuento → items: []. No inventes productos de la lista.
      4. descuentos: SOLO si los mencionó. Si no dijo descuento → null / 0.
      5. emitirFactura: true SOLO si pide emitir/cobrar/guardar de forma clara.
      6. eliminarProducto: SOLO si pide quitar/borrar un producto. Un descuento NO elimina.
      7. cliente "CONSUMIDOR_FINAL" solo si dijo consumidor final / sin datos.
    `;

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: fraseUsuario }
      ],
      temperature: 0.0,
      max_tokens: 450
    };

    // Mantener mic bloqueado hasta terminar de aplicar (evita eco / comandos fantasma)
    this.bloqueoEscucha = true;
    this.isThinking = true;

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          try {
            let respuestaStr = res.choices[0].message.content;
            let jsonStr = respuestaStr;
            const match = respuestaStr.match(/\{[\s\S]*\}/);
            if (match) jsonStr = match[0];
            jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();

            const datosExtraidos = JSON.parse(jsonStr);
            // Sanear alucinaciones antes de aplicar
            const datosLimpios = this.sanearDatosVoz(datosExtraidos, fraseUsuario);
            const intencionEmitir = quiereEmitirPalabra || String(datosLimpios.emitirFactura).toLowerCase() === 'true';

            this.aplicarDatosExtraidos(datosLimpios, intencionEmitir);
          } catch (e) {
            console.error("Error parseando JSON:", e);
            this.isThinking = false;
            this.hablar("Uy, me enredé con esa frase. ¿Me lo repites?", () => {
              this.bloqueoEscucha = false;
              this.isThinking = false;
              this.escuchar();
            });
          }
        },
        error: () => {
          this.isThinking = false;
          this.hablar("Hubo un fallo de conexión. Repite, por favor.", () => {
            this.bloqueoEscucha = false;
            this.isThinking = false;
            this.escuchar();
          });
        }
      });
  }

  /**
   * Rechaza datos que la IA inventó y el usuario NO dijo (pago, productos, etc.).
   */
  private sanearDatosVoz(datos: any, frase: string): any {
    const f = this.limpiarTexto(frase || this.ultimaFraseUsuario);
    const out: any = { ...(datos || {}) };

    // --- Método de pago: solo si la frase lo respalda ---
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
    // Si la frase sí menciona pago pero la IA puso null, forzar
    if (!out.metodoPago) {
      if (diceTarjeta) out.metodoPago = 'TARJETA_CREDITO';
      else if (diceTransfer) out.metodoPago = 'TRANSFERENCIA';
      else if (diceEfectivo) out.metodoPago = 'EFECTIVO';
    }

    if (!diceTarjeta) {
      out.detallesTarjeta = null;
      out.cuotas = null;
    }

    // --- Descuentos globales: solo si mencionó descuento ---
    const diceDesc = /\b(descuento|rebaja|por\s*ciento|porcentaje)\b/.test(f);
    if (!diceDesc) {
      out.descuentoGlobal = null;
      out.descuentoGlobalPorcentaje = null;
    }

    // --- Items: PERMISIVO (el filtro anterior borraba productos válidos) ---
    if (!Array.isArray(out.items)) out.items = [];
    out.items = out.items.filter((it: any) => it && it.producto && String(it.producto).toLowerCase() !== 'null');

    // Vaciar solo si la frase es claramente SOLO pago/cliente, sin productos
    const pideProducto =
      /\b(agrega|agregue|agregar|añade|añadir|pon|poner|quiero|dame|producto|un|una|unos|unas|dos|tres|cuatro|cinco|\d+)\b/.test(f)
      || this.fraseMencionaProducto(f);

    const soloPagoOCliente =
      !pideProducto &&
      (diceTarjeta || diceTransfer || diceEfectivo || /\b(consumidor\s*final|cliente)\b/.test(f));

    if (soloPagoOCliente) {
      out.items = [];
    } else if (out.items.length === 0 && this.fraseMencionaProducto(f)) {
      // Fallback: la IA no trajo items pero sí hay productos en la frase
      out.items = this.extraerItemsDesdeFrase(f);
    }
    // Si la IA trajo items, se respetan (aunque el nombre no coincida letra por letra con el audio)

    if (out.eliminarProducto && out.eliminarProducto !== 'null') {
      const diceQuitar = /\b(quita|quitar|borra|borrar|elimina|eliminar|saca|sacar)\b/.test(f);
      if (!diceQuitar) out.eliminarProducto = null;
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
      'con', 'del', 'los', 'las', 'por', 'para', 'que'
    ]);
    return tokens.some(t =>
      !stop.has(t) &&
      this.productosList.some(p => this.limpiarTexto(p.nombre).includes(t))
    );
  }

  /** Arma items desde tokens de la frase que matchean el catálogo */
  private extraerItemsDesdeFrase(frase: string): any[] {
    const tokens = this.limpiarTexto(frase).split(/\s+/).filter(t => t.length >= 3);
    const stop = new Set([
      'agrega', 'agregue', 'agregar', 'añade', 'añadir', 'pon', 'poner', 'quiero', 'dame',
      'factura', 'favor', 'porfa', 'descuento', 'cliente', 'consumidor', 'final',
      'efectivo', 'tarjeta', 'credito', 'transferencia', 'con', 'del', 'los', 'las',
      'una', 'uno', 'unos', 'unas', 'por', 'para', 'que'
    ]);
    let cant = 1;
    const mCant = this.limpiarTexto(frase).match(/\b(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
    if (mCant) {
      const mapa: Record<string, number> = {
        un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
        seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10
      };
      cant = mapa[mCant[1]] || parseInt(mCant[1], 10) || 1;
    }

    const usados = new Set<string>();
    const items: any[] = [];
    // Preferir tokens más largos primero (más específicos)
    const ordenados = [...tokens].filter(t => !stop.has(t)).sort((a, b) => b.length - a.length);
    for (const t of ordenados) {
      const hits = this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(t));
      if (hits.length === 0) continue;
      if (usados.has(t)) continue;
      // Evitar tokens cortos contenidos en uno ya usado
      if ([...usados].some(u => u.includes(t) || t.includes(u))) continue;
      usados.add(t);
      items.push({ producto: t, cantidad: cant, descuento: 0, descuentoPorcentaje: 0 });
    }
    return items;
  }

  private aplicarDatosExtraidos(datos: any, quiereEmitir: boolean = false) {
    let algoAgregado = false;
    let mensajesAlerta: string[] = []; 

    if (datos.eliminarProducto && datos.eliminarProducto !== 'null') {
        const index = this.nuevaFactura.detalles.findIndex((d: any) => 
            d.productoNombre.toLowerCase().includes(datos.eliminarProducto.toLowerCase())
        );
        if (index !== -1) {
            const nombreQuitado = this.nuevaFactura.detalles[index].productoNombre;
            this.eliminarDelCarrito(index);
            this.hablar(`Listo, acabo de quitar ${nombreQuitado} del ticket. ¿Qué más hacemos?`, () => this.escuchar());
            return; 
        }
    }

    // metodoPago ya viene saneado: solo aplicar si no es null
    if (datos.metodoPago && datos.metodoPago !== 'null' && datos.metodoPago !== 'NULL') {
        this.nuevaFactura.metodoPago = datos.metodoPago;
        this.metodoPagoConfirmado = true;
    }

    // Tarjeta / cuotas: solo si el método quedó en TARJETA (saneado por frase)
    if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO') {
      if (datos.detallesTarjeta && datos.detallesTarjeta !== 'null') {
        this.nuevaFactura.detallesTarjeta = datos.detallesTarjeta;
      }
      if (datos.cuotas !== undefined && datos.cuotas !== null) {
        const numCuotas = parseInt(datos.cuotas, 10);
        if (!isNaN(numCuotas) && numCuotas > 0) {
          this.nuevaFactura.numeroCuotas = numCuotas;
        }
      }
    }

    // Al emitir sin método explícito → efectivo por defecto (no tarjeta)
    if (quiereEmitir && !this.metodoPagoConfirmado) {
      this.nuevaFactura.metodoPago = 'EFECTIVO';
      this.metodoPagoConfirmado = true;
    }

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

    // 🔥 EVALUAR CLIENTES Y MOSTRAR OPCIONES VISUALES
    let requiereDesambiguacionCli = null;
    if (datos.cliente && datos.cliente !== 'null' && !this.nuevaFactura.clienteId && !this.esConsumidorFinal) {
        if (datos.cliente === 'CONSUMIDOR_FINAL' || String(datos.cliente).toLowerCase().includes('consumidor')) {
            this.setConsumidorFinal();
        } else {
            const matchesCli = this.buscarClientesUniversales(datos.cliente);
            if (matchesCli.length === 1) {
                this.seleccionarCliente(matchesCli[0]); 
            } else if (matchesCli.length > 1) {
                requiereDesambiguacionCli = matchesCli; 
            } else {
                mensajesAlerta.push(`no encontré a ${datos.cliente}`);
            }
        }
    }

    if (requiereDesambiguacionCli) {
        this.quiereEmitirPendiente = quiereEmitir;
        this.iniciarDesambiguacion('CLIENTE', requiereDesambiguacionCli, "Encontré varios clientes parecidos. Di el número o haz clic en la pantalla.");
        return;
    }

    const items = Array.isArray(datos.items) ? datos.items.filter((it: any) => it && it.producto && it.producto !== 'null') : [];

    // Procesar productos: 1 match exacto → agregar; 2+ → opciones (nunca elegir al azar)
    let requiereDesambiguacionProd: any[] | null = null;
    let cantTemp = 1;
    let descTemp = 0;
    let descPctTemp = 0;
    const itemsRestantes: any[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        // Cruza lo que dijo el usuario + lo que devolvió la IA → si hay varias máscaras, lista opciones
        const matchesProd = this.resolverMatchesProductoVoz(String(item.producto), this.ultimaFraseUsuario);

        if (matchesProd.length === 1) {
            const ok = this.intentarAgregarProductoVoz(matchesProd[0], item, mensajesAlerta);
            if (ok) algoAgregado = true;
        } else if (matchesProd.length > 1) {
            // Siempre pedir opción si hay más de uno (nunca elegir al azar)
            requiereDesambiguacionProd = matchesProd;
            cantTemp = Number(item.cantidad);
            if (isNaN(cantTemp) || cantTemp <= 0) cantTemp = 1;
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
        const muestra = requiereDesambiguacionProd.slice(0, 8);
        const nombres = muestra.map((p, idx) => `${idx + 1}) ${p.nombre}`).join('. ');
        const extra = totalOps > 8 ? ` Hay ${totalOps} en total; te muestro las primeras 8.` : '';
        this.iniciarDesambiguacion(
          'PRODUCTO',
          requiereDesambiguacionProd,
          `Encontré ${totalOps} productos parecidos. ${nombres}.${extra} Di el número o toca el correcto.`
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
        // Solo cuando pide emitir → pedir confirmación explícita
        this.voiceState = VoiceStep.CONFIRMAR;
        const msj = `${prefijoAviso}Total a pagar $${this.totalCarrito.toFixed(2)}. ¿Confirmas que emitimos la factura? Di sí o no.`;
        this.hablar(msj, () => this.escuchar());
    } else if (algoAgregado) {
        // Solo agregó productos/descuento: informar y seguir escuchando (sin bloquear en CONFIRMAR)
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`${prefijoAviso}Listo. Total $${this.totalCarrito.toFixed(2)}. ¿Algo más o emitimos?`, () => this.escuchar());
    } else {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`${prefijoAviso}¿Algo más o emitimos?`, () => this.escuchar());
    }
  }             

  /** Agrega un producto resuelto por voz (1 match). Devuelve true si se agregó. */
  private intentarAgregarProductoVoz(prod: any, item: any, mensajesAlerta: string[]): boolean {
    let cant = Number(item.cantidad);
    if (isNaN(cant) || cant <= 0) cant = 1;

    let descPct = Number(item.descuentoPorcentaje || 0);
    let descMonto = Number(item.descuento || 0);
    if (isNaN(descPct) || descPct < 0) descPct = 0;
    if (isNaN(descMonto) || descMonto < 0) descMonto = 0;
    // Solo aplicar descuento si el usuario lo dijo (valores > 0)
    if (descPct > 0) {
      const precioUnit = Number(prod.precioUnitario || 0);
      descMonto = (precioUnit * cant * Math.min(descPct, 100)) / 100;
    }

    let bodegaUsar: any = null;
    let stockActual = 0;
    for (const bod of this.bodegasList) {
      const stockEnBod = this.obtenerStock(prod.id, bod.id) || 0;
      if (stockEnBod > 0) {
        bodegaUsar = bod.id;
        stockActual = stockEnBod;
        break;
      }
    }
    if (!bodegaUsar && this.bodegasList.length > 0) {
      bodegaUsar = this.bodegasList[0].id;
      stockActual = this.obtenerStock(prod.id, bodegaUsar) || 0;
    }
    if (!bodegaUsar) {
      mensajesAlerta.push(`no hay bodegas para ${prod.nombre}`);
      return false;
    }

    const yaEnCarrito = this.nuevaFactura.detalles
      .filter((d: any) => d.productoId === prod.id && d.bodegaId === bodegaUsar)
      .reduce((s: number, d: any) => s + Number(d.cantidad || 0), 0);
    const disponible = Math.max(0, stockActual - yaEnCarrito);

    if (disponible <= 0) {
      mensajesAlerta.push(`no hay stock de ${prod.nombre}`);
      return false;
    }
    if (cant > disponible) {
      mensajesAlerta.push(`solo agregué ${disponible} de ${prod.nombre} (stock)`);
      cant = disponible;
    }
    this.agregarProductoDirecto(prod, cant, bodegaUsar, descMonto, descPct);
    return true;
  }

  /**
   * Resuelve productos por voz SIN auto-elegir cuando hay iguales/parecidos.
   * Regla de oro: si hay 2+ candidatos → SIEMPRE opciones.
   */
  private resolverMatchesProductoVoz(nombreIa: string, fraseUsuario: string): any[] {
    const stop = new Set([
      'agrega', 'agregue', 'agregar', 'añade', 'añadir', 'pon', 'poner', 'quiero', 'dame',
      'uno', 'una', 'unos', 'unas', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
      'ocho', 'nueve', 'diez', 'del', 'de', 'la', 'el', 'los', 'las', 'un', 'al', 'con',
      'por', 'para', 'y', 'o', 'que', 'me', 'te', 'le', 'se', 'producto', 'productos',
      'factura', 'favor', 'porfa', 'descuento', 'porcentaje', 'dolares', 'dolar', 'centavos'
    ]);

    const tokensUsuario = this.limpiarTexto(fraseUsuario)
      .split(/\s+/)
      .filter(t => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));

    // 1) Tokens del usuario: si "mascara" matchea varios → opciones forzadas
    let mejorMulti: any[] = [];
    for (const tok of tokensUsuario) {
      const hits = this.dedupProductos(
        this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(tok))
      );
      if (hits.length > mejorMulti.length) mejorMulti = hits;
    }
    if (mejorMulti.length > 1) return mejorMulti;

    // 2) Búsqueda normal por lo que dijo la IA
    const porIa = this.buscarProductos(nombreIa);

    // 3) Aunque la IA devolvió 1, si ese nombre tiene "hermanos" (misma raíz) → opciones
    if (porIa.length === 1) {
      const hermanos = this.buscarHermanosProducto(porIa[0]);
      if (hermanos.length > 1) return hermanos;
      return porIa;
    }
    if (porIa.length > 1) return porIa;

    // 4) Tokens del nombre IA
    const tokensIa = this.limpiarTexto(nombreIa).split(/\s+/).filter(t => t.length >= 3 && !stop.has(t));
    for (const tok of tokensIa) {
      const hits = this.dedupProductos(
        this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(tok))
      );
      if (hits.length > 1) return hits;
      if (hits.length === 1) {
        const hermanos = this.buscarHermanosProducto(hits[0]);
        return hermanos.length > 1 ? hermanos : hits;
      }
    }

    return mejorMulti.length === 1 ? mejorMulti : [];
  }

  /** Productos con el mismo nombre exacto o que comparten la palabra raíz principal */
  private buscarHermanosProducto(producto: any): any[] {
    if (!producto) return [];
    const nom = this.limpiarTexto(producto.nombre);
    // Mismo nombre exacto (distintos ids / presentaciones)
    const exactos = this.dedupProductos(
      this.productosList.filter(p => this.limpiarTexto(p.nombre) === nom)
    );
    if (exactos.length > 1) return exactos;

    // Raíz: palabra más larga del nombre (≥4) o la primera significativa
    const palabras = nom.split(/\s+/).filter(p => p.length >= 3);
    const raiz = [...palabras].sort((a, b) => b.length - a.length)[0];
    if (!raiz || raiz.length < 4) return [producto];

    const hermanos = this.dedupProductos(
      this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(raiz))
    );
    // Si hay muchos hermanos genéricos, priorizar los que comparten ≥2 palabras
    if (hermanos.length > 12 && palabras.length >= 2) {
      const estrechos = hermanos.filter(p => {
        const n = this.limpiarTexto(p.nombre);
        return palabras.filter(w => n.includes(w)).length >= Math.min(2, palabras.length);
      });
      if (estrechos.length > 1) return estrechos;
    }
    return hermanos.length > 1 ? hermanos : [producto];
  }

  /**
   * Busca productos. Regla estricta:
   * - Solo auto-elige si hay 1 coincidencia EXACTA (nombre o código).
   * - Si hay 2 o más candidatos (nombres parecidos / repetidos), DEVUELVE TODOS
   *   para forzar la pantalla de opciones. Nunca elige "al azar".
   */
  private buscarProductos(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    if (!txt) return [];

    // 1) Nombre exacto
    const exact = this.productosList.filter(p => this.limpiarTexto(p.nombre) === txt);
    if (exact.length === 1) return exact;
    if (exact.length > 1) return exact; // mismos nombres → desambiguar

    // 2) Código exacto
    const porCodigo = this.productosList.filter(p =>
      p.codigoPrincipal && this.limpiarTexto(String(p.codigoPrincipal)) === txt
    );
    if (porCodigo.length === 1) return porCodigo;
    if (porCodigo.length > 1) return porCodigo;

    // 3) El nombre del producto CONTIENE lo dicho (o al revés)
    const partial = this.productosList.filter(p => {
      const nom = this.limpiarTexto(p.nombre);
      return nom.includes(txt) || (txt.length >= 4 && txt.includes(nom));
    });
    // Deduplicar por id
    const uniqPartial = this.dedupProductos(partial);
    if (uniqPartial.length === 1) return uniqPartial;
    if (uniqPartial.length > 1) {
      // Preferir los que empiezan igual, pero SI HAY MÁS DE UNO → todos a opciones
      const starts = uniqPartial.filter(p => this.limpiarTexto(p.nombre).startsWith(txt));
      if (starts.length === 1 && uniqPartial.length <= 3) {
        // Un solo que empieza igual y pocos candidatos: aún así, si hay varios similares, mostrar opciones
        // Usuario pidió: siempre que se repita → opciones. Si starts=1 y hay otros, mostrar todos.
        return uniqPartial;
      }
      return starts.length > 1 ? starts : uniqPartial;
    }

    // 4) Todas las palabras significativas deben aparecer en el nombre
    const palabras = txt.split(/\s+/).filter(p => p.length > 2);
    if (palabras.length > 0) {
      const porPalabras = this.productosList.filter(p => {
        const nom = this.limpiarTexto(p.nombre);
        return palabras.every(pal => nom.includes(pal));
      });
      const uniq = this.dedupProductos(porPalabras);
      if (uniq.length >= 1) return uniq;
    }

    // 5) Fallback suave: al menos una palabra larga (mín 4 chars) — siempre lista para desambiguar
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
    // Orden: nombres más cortos primero (más específicos)
    return out.sort((a, b) => this.limpiarTexto(a.nombre).length - this.limpiarTexto(b.nombre).length);
  }

  private iniciarDesambiguacion(tipo: 'CLIENTE' | 'PRODUCTO', opciones: any[], mensaje: string) {
    this.pausarMicYVoz();
    this.tipoOpciones = tipo;
    this.opcionesVoz = opciones.slice(0, 10);
    this.voiceState = VoiceStep.ELEGIR_OPCION;
    this.seleccionEnCurso = false;
    this.cdr.detectChanges();
    // Hablar y luego escuchar solo el número (sin eco de la propia voz)
    this.hablar(mensaje, () => {
      this.bloqueoEscucha = false;
      this.isThinking = false;
      this.escuchar();
    });
  }

  seleccionarOpcionVozManual(index: number) {
    if (this.voiceState !== VoiceStep.ELEGIR_OPCION || this.seleccionEnCurso) return;
    if (index < 0 || index >= this.opcionesVoz.length) return;

    // Clic: cortar mic + voz YA para que no se confunda
    this.seleccionEnCurso = true;
    this.pausarMicYVoz();
    const seleccionado = this.opcionesVoz[index];
    // Pequeño delay para que abort del mic termine
    setTimeout(() => {
      this.procesarSeleccionDesambiguacion(seleccionado);
    }, 120);
  }

  private manejarDesambiguacion(transcript: string) {
    if (this.seleccionEnCurso) return;

    const t = (transcript || '').trim();
    // Frases largas = ruido / eco de Zoe, no una opción
    if (t.length > 45) {
      this.hablar("Di solo el número de la opción, por ejemplo: uno, dos o tres.", () => {
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

    // Match por nombre solo si es corto y específico (no frases sueltas)
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
    if (this.tipoOpciones === 'CLIENTE' && t.length >= 3) {
      const porNombre = this.opcionesVoz.filter(c => {
        const nom = this.limpiarTexto(c.nombreCompleto || `${c.primerNombre || ''} ${c.apellidoPaterno || ''}`);
        return nom.includes(t) || t.includes(nom);
      });
      if (porNombre.length === 1) {
        this.seleccionEnCurso = true;
        this.pausarMicYVoz();
        this.procesarSeleccionDesambiguacion(porNombre[0]);
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
        this.seleccionEnCurso = false;
        this.aplicarDatosExtraidos({}, this.quiereEmitirPendiente);
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

  // =======================================================
  // 🔥 CARRITO Y PDF
  // =======================================================
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

    const precioUnit = Number(prodSelect.precioUnitario || 0);
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

  /**
   * Usa el PVP (precioUnitario). Fusiona si el mismo producto+bodega ya está en el carrito.
   * Respeta grabaIva del producto.
   */
  private agregarProductoDirecto(
    producto: any,
    cantidad: number,
    bodegaId: any,
    descuento: number = 0,
    descuentoPorcentaje: number = 0
  ) {
    if (!producto || !bodegaId || cantidad <= 0) return;

    const precio = Number(producto.precioUnitario || 0);
    if (precio <= 0) {
      Swal.fire('Error', `El producto "${producto.nombre}" no tiene precio de venta configurado.`, 'error');
      return;
    }

    const grabaIva = !!producto.grabaIva;
    const bodSelect = this.bodegasList.find((b: any) => b.id === bodegaId);
    const bodegaNombre = bodSelect ? bodSelect.nombre : 'Principal';

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
        Swal.fire('Error', `El descuento no puede ser mayor al precio total de ${producto.nombre}.`, 'error');
        return;
      }
      existente.cantidad = nuevaCant;
      existente.descuento = nuevoDesc;
      existente.descuentoPorcentaje = nuevoPct;
      existente.subtotal = nuevoSub;
      existente.grabaIva = grabaIva;
      this.cdr.detectChanges();
      return;
    }

    const subtotal = (precio * cantidad) - descuento;
    if (subtotal < 0) {
      Swal.fire('Error', `El descuento no puede ser mayor al precio total de ${producto.nombre}.`, 'error');
      return;
    }

    this.nuevaFactura.detalles.push({
      productoId: producto.id,
      bodegaId: bodegaId,
      bodegaNombre: bodegaNombre,
      cantidad: cantidad,
      productoNombre: producto.nombre,
      precioUnitario: precio,
      descuento: descuento,
      descuentoPorcentaje: descuentoPorcentaje || 0,
      grabaIva: grabaIva,
      subtotal: subtotal
    });
    this.cdr.detectChanges();
  }

  eliminarDelCarrito(index: number) {
    this.nuevaFactura.detalles.splice(index, 1);
  }

  /** Confirmación obligatoria antes de emitir (botón manual y voz). */
  confirmarYGuardarFactura() {
    if ((!this.nuevaFactura.clienteId && !this.esConsumidorFinal) || this.nuevaFactura.detalles.length === 0) {
      Swal.fire('Error', 'Faltan datos para emitir la factura (cliente y al menos un producto).', 'error');
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

    this.isSaving = true;
    Swal.fire({ title: 'Emitiendo Factura...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // Sincronizar monto de descuento global desde % si aplica
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

    // emailUsuario lo exige el backend para el emisor
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
          this.showModal = false;
          if (this.negocioId) this.cargarTodasLasFacturas(this.negocioId);

          // Snapshot del carrito en pantalla → el PDF debe coincidir con lo que vio el usuario
          const detallesCarrito = this.nuevaFactura.detalles.map((d: any) => ({ ...d }));
          const totalApi = Number(res.totalFactura ?? res.total ?? 0);
          const ivaApi = Number(res.totalIva ?? 0);
          const sub0Api = Number(res.subtotalIva0 ?? 0);
          const subGravApi = Number(res.subtotalIvaAplicado ?? 0);

          const facturaParaPDF = {
            numero: res.numeroFactura || 'S/N',
            cliente: res.clienteNombre || (this.esConsumidorFinal ? 'Consumidor Final' : 'Cliente'),
            fecha: res.fechaEmision ? new Date(res.fechaEmision).toLocaleDateString() : new Date().toLocaleDateString(),
            // Preferir carrito si el API no trajo IVA (campos nulos / 0 por mapper)
            monto: totalApi > 0 ? totalApi : this.totalCarrito,
            tipo: res.formaPago || this.nuevaFactura.metodoPago || 'Manual',
            descuentoGlobal: descGlobal,
            subtotalIva0: sub0Api > 0 ? sub0Api : this.subtotalExento,
            subtotalIvaAplicado: subGravApi > 0 ? subGravApi : this.subtotalGravado,
            totalIva: ivaApi > 0 ? ivaApi : this.montoIva,
            porcentajeIva: Number(res.porcentajeIvaAplicado || (this.ivaActual * 100)),
            // Detalles del carrito garantizan PVP y descuentos de línea iguales a la web
            detalles: (res.detallesFactura || res.detalles || []).length
              ? this.fusionarDetallesPdf(res.detallesFactura || res.detalles, detallesCarrito)
              : detallesCarrito
          };

          this.imprimirFacturaPDF(facturaParaPDF);
          Swal.fire({ icon: 'success', title: '¡Factura Emitida!', timer: 1500, showConfirmButton: false });
        },
        error: (err) => {
          this.isSaving = false;
          const msg = typeof err.error === 'string' ? err.error : (err.error?.message || 'Error al emitir');
          Swal.fire('Error', msg, 'error');
        }
      });
  }

  descargarPDF(fac: any) {
    this.imprimirFacturaPDF(fac);
  }

  /**
   * Mezcla detalles del API con los del carrito para no perder PVP / descuento de línea.
   */
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

  /**
   * Calcula subtotal / IVA / total desde líneas (mismo criterio que el carrito web).
   */
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

    // 1) Totales explícitos si vienen bien del API / snapshot
    let iva = Number(fac.totalIva);
    let subtotal = Number(fac.subtotalIva0 || 0) + Number(fac.subtotalIvaAplicado || 0);
    let total = Number(fac.monto || 0);
    let descuentoGlobal = descuentoGlobalIn;

    // 2) Si IVA falta o es 0 con productos gravados → recalcular como en la web
    const calc = this.calcularTotalesDesdeDetalles(detalles, descuentoGlobalIn, tasa || this.ivaActual);
    const hayGravados = detalles.some((d: any) => !!(d.grabaIva ?? d.producto?.grabaIva));

    if (!(iva > 0) || !(subtotal > 0) || !(total > 0) || (hayGravados && !(iva > 0))) {
      subtotal = calc.subtotal;
      iva = calc.iva;
      total = calc.total;
      descuentoGlobal = calc.descuentoGlobal;
    } else {
      // Ajustar subtotal si solo vino el total
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
                      <div class="total-row">
                          <span>Subtotal (Sin IVA)</span>
                          <span class="font-bold">$${subtotal.toFixed(2).replace('.', ',')}</span>
                      </div>
                      ${htmlDescuento}
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