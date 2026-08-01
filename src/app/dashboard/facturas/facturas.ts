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
  facturasBase: any[] = []; 
  terminoBusqueda: string = ''; 
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

  // 🔥 NUEVA ESTRUCTURA (CON CAMPOS DE TARJETA SIMULADOS)
  nuevaFactura: any = {
    clienteId: null,
    metodoPago: 'EFECTIVO',
    numeroCuotas: 0,
    detallesTarjeta: '', // Cadena que se envía a BD (Ej. Terminada en 1234)
    tarjetaNumero: '', // Campo simulado
    tarjetaVence: '',  // Campo simulado
    tarjetaCvc: '',    // Campo simulado
    descuentoGlobalPorcentaje: null,
    detalles: []
  };

  itemTemp: any = {
    productoId: null,
    bodegaId: null,
    cantidad: null,
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

  productoPendientePorBodega: any = null;
  cantidadPendientePorBodega: number = 1;
  descuentoPendientePorBodega: number = 0;

  get subtotalCarrito(): number {
    return this.nuevaFactura.detalles.reduce((sum: number, item: any) => sum + (item.subtotal || 0), 0);
  }

  get montoDescuentoGlobal(): number {
    const descPct = Number(this.nuevaFactura.descuentoGlobalPorcentaje || 0);
    return this.subtotalCarrito * (descPct / 100);
  }

  get totalCarrito(): number {
    const total = this.subtotalCarrito - this.montoDescuentoGlobal;
    return total > 0 ? total : 0;
  }

  get montoIva(): number {
    const total = this.totalCarrito;
    const subtotal = total / (1 + this.ivaActual);
    return total - subtotal;
  }

  get subtotalSinIva(): number {
      return this.totalCarrito / (1 + this.ivaActual);
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
    return inv ? Number(inv.cantidadActual || 0) : 0;
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
          detalles: f.detallesFactura || f.detalles || f.items || [] 
        }));
        
        this.facturasBase = [...this.facturas]; 
        
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
    this.nuevaFactura = { 
        clienteId: null, 
        metodoPago: 'EFECTIVO', 
        numeroCuotas: 0, 
        detallesTarjeta: '', 
        tarjetaNumero: '', 
        tarjetaVence: '', 
        tarjetaCvc: '', 
        descuentoGlobalPorcentaje: null, 
        detalles: [] 
    };
    this.itemTemp = { productoId: null, bodegaId: null, cantidad: null, descuentoPorcentaje: null, productoNombre: '' };
    this.terminoBusquedaCliente = '';
    this.clienteSeleccionadoInfo = null;
    this.mostrarDropdownClientes = false;
    this.esConsumidorFinal = false;
    
    this.opcionesVoz = [];
    this.tipoOpciones = null;
    this.metodoPagoConfirmado = false;
    this.quiereEmitirPendiente = false;

    this.productoPendientePorBodega = null;

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
      this.silenceTimer = setTimeout(() => {
          this.recognition.stop();
          if (this.userTranscript) {
              this.isListening = false;
              this.procesarComandoVoz(this.userTranscript);
          } else {
              this.escuchar();
          }
      }, 5000); 
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        this.isListening = false;
        Swal.fire('Micrófono bloqueado', 'Permite el acceso al micrófono en el navegador.', 'error');
        this.cancelarAsistenteVoz();
      }
    };

    this.recognition.onend = () => {
      if (this.voiceState !== VoiceStep.OFF && !this.isThinking) {
          try { this.recognition.start(); } catch(e){}
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
        this.voiceMessage = "Hola, soy tu asistente Zoe. ¿A quién le facturamos y qué le agregamos?";
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
    this.transcriptAcumulado = '';
    this.productoPendientePorBodega = null;
    clearTimeout(this.silenceTimer);
    window.speechSynthesis.cancel();
    if (this.recognition) this.recognition.abort();
    this.cdr.detectChanges();
  }

  private hablar(texto: string, callback?: () => void) {
    window.speechSynthesis.cancel(); 
    clearTimeout(this.silenceTimer);
    this.transcriptAcumulado = ''; 
    
    setTimeout(() => {
        this.voiceMessage = texto;
        this.userTranscript = ''; 
        this.cdr.detectChanges();

        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = 'es-ES';
        
        // 🔥 HABLA A UNA VELOCIDAD MEDIA-RÁPIDA (Ni tan lenta, ni inentendible)
        utterance.rate = 1.25; 
        utterance.pitch = 1.2; 
        
        let voices = window.speechSynthesis.getVoices();
        
        // 🔥 OBLIGA A ZOE A USAR VOZ DE MUJER
        let femaleVoice = voices.find(v => v.lang.startsWith('es') && /(sabina|paulina|helena|monica|victoria|lucia|sofia|laura|isabel|carmen|female|mujer)/i.test(v.name));
        
        if (!femaleVoice) {
            femaleVoice = voices.find(v => v.lang.startsWith('es') && !/(pablo|jorge|diego|carlos|male|hombre)/i.test(v.name));
        }
        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }

        utterance.onend = () => { if (callback && this.voiceState !== VoiceStep.OFF) callback(); };
        utterance.onerror = () => { if (callback && this.voiceState !== VoiceStep.OFF) callback(); };

        window.speechSynthesis.speak(utterance);
    }, 50); 
  }

  private escuchar() {
    if (this.voiceState === VoiceStep.OFF || this.voiceState === VoiceStep.INICIANDO) return;
    this.isListening = true;
    this.cdr.detectChanges();
    try { this.recognition.start(); } catch (e) {}
  }

  private procesarComandoVoz(transcript: string) {
    this.transcriptAcumulado = ''; 
    const transcriptLimpio = transcript.toLowerCase().trim();

    const comandosLimpiar = ['borra todo', 'borrar todo', 'limpiar carrito', 'reiniciar', 'vaciar ticket', 'cancela todo'];
    if (comandosLimpiar.some(cmd => transcriptLimpio.includes(cmd))) {
        this.nuevaFactura.detalles = [];
        this.limpiarClienteSeleccionado();
        this.nuevaFactura.descuentoGlobalPorcentaje = null;
        this.nuevaFactura.detallesTarjeta = '';
        this.nuevaFactura.tarjetaNumero = '';
        this.nuevaFactura.tarjetaVence = '';
        this.nuevaFactura.tarjetaCvc = '';
        this.hablar("He vaciado el ticket por completo. Empecemos de cero.", () => this.escuchar());
        return;
    }

    if (this.voiceState === VoiceStep.ELEGIR_OPCION && this.opcionesVoz.length > 0) {
        this.manejarDesambiguacion(transcriptLimpio);
        return;
    }

    const comandosEmitir = ['emite', 'emitir', 'factura ya', 'cobrar ya', 'guarda la factura', 'guardar factura', 'todo bien', 'listo', 'cobra', 'cobrar'];
    const quiereEmitir = comandosEmitir.some(cmd => transcriptLimpio.includes(cmd));

    if (this.voiceState === VoiceStep.CONFIRMAR && (quiereEmitir || transcriptLimpio.includes('si') || transcriptLimpio.includes('sí') || transcriptLimpio.includes('ok') || transcriptLimpio.includes('dale'))) {
        this.voiceState = VoiceStep.OFF;
        this.hablar("¡Listo! Emitiendo Factura de inmediato.");
        setTimeout(() => { this.guardarFactura(); }, 800);
        return;
    }

    this.analizarConGroq(transcriptLimpio, quiereEmitir);
  }

  private analizarConGroq(fraseUsuario: string, quiereEmitirPalabra: boolean) {
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
    const listaBodegas = this.bodegasList.map(b => b.nombre).join(', ');

    // 🔥 PROMPT ESTRICTO PARA ZOE (Mujer, No pide Tarjetas)
    const promptSystem = `
      Eres Zoe, la veloz asistente virtual con identidad de MUJER de un sistema POS. 
      NUNCA pidas los datos de la tarjeta de crédito al usuario (ni numero, ni vencimiento, ni CVC). Esos campos son opcionales y manuales. Si el usuario te dicta números de tarjeta, ignóralos por seguridad y solo establece el método como TARJETA_CREDITO.
      
      Listas de BD:
      Clientes: [${listaNombresCli}]
      Productos: [${listaNombresProd}]
      Bodegas: [${listaBodegas}]

      Formato EXACTO:
      {
         ${instruccionCliente}
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | null,
         "cuotas": numero_entero_o_null,
         "descuentoGlobalPorcentaje": numero_o_null,
         "items": [ { "producto": "Nombre", "cantidad": numero_entero_o_null, "descuentoPorcentaje": numero_o_0, "bodega": "Nombre de la bodega o null" } ],
         "eliminarProducto": "Nombre del producto a quitar del carrito (o null)",
         "emitirFactura": true o false
      }
      
      REGLAS:
      1. Si dice "Consumidor final", cliente es "CONSUMIDOR_FINAL".
      2. "emitirFactura": true SIEMPRE que insinúe terminar.
      3. TARJETA: Si menciona "tarjeta" o "crédito" es TARJETA_CREDITO. Si dice "meses" extrae el número a "cuotas". Recuerda, NO pidas la tarjeta.
      4. DESCUENTOS (%): Solo extrae números puros para "descuentoGlobalPorcentaje" y "descuentoPorcentaje".
      5. BODEGAS: Si el usuario pide explícitamente sacar de una bodega específica, escríbelo en "bodega" dentro de "items". Si no, pon null.
      6. NO devuelvas texto fuera del JSON.
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

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          this.isThinking = false;
          try {
            let respuestaStr = res.choices[0].message.content;
            let jsonStr = respuestaStr;
            const match = respuestaStr.match(/\{[\s\S]*\}/);
            if (match) jsonStr = match[0];
            jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
            
            const datosExtraidos = JSON.parse(jsonStr);
            const intencionEmitir = quiereEmitirPalabra || String(datosExtraidos.emitirFactura).toLowerCase() === 'true';
            
            this.aplicarDatosExtraidos(datosExtraidos, intencionEmitir);
          } catch (e) {
            console.error("Error parseando JSON:", e);
            this.hablar("Uy, me enredé con esa frase. ¿Me lo repites?", () => this.escuchar());
          }
        },
        error: () => {
          this.isThinking = false;
          this.hablar("Hubo un fallo de conexión. Repite, por favor.", () => this.escuchar());
        }
      });
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
            this.hablar(`Listo, quité ${nombreQuitado}. ¿Qué más hacemos?`, () => this.escuchar());
            return; 
        }
    }

    if (datos.metodoPago && datos.metodoPago !== 'null' && datos.metodoPago !== 'NULL') {
        this.nuevaFactura.metodoPago = datos.metodoPago;
        this.metodoPagoConfirmado = true;
    }

    if (datos.cuotas !== undefined && datos.cuotas !== null) {
        let numCuotas = parseInt(datos.cuotas, 10);
        if (!isNaN(numCuotas) && numCuotas > 0) {
            this.nuevaFactura.numeroCuotas = numCuotas;
            if (this.nuevaFactura.metodoPago !== 'TARJETA_CREDITO') {
                this.nuevaFactura.metodoPago = 'TARJETA_CREDITO';
                this.metodoPagoConfirmado = true;
            }
        }
    } else if (quiereEmitir && !this.metodoPagoConfirmado) {
        this.nuevaFactura.metodoPago = 'EFECTIVO'; 
        this.metodoPagoConfirmado = true;
    }

    if (datos.descuentoGlobalPorcentaje !== undefined && datos.descuentoGlobalPorcentaje !== null) {
        const descGlobal = parseFloat(datos.descuentoGlobalPorcentaje);
        if (!isNaN(descGlobal) && descGlobal > 0) {
            this.nuevaFactura.descuentoGlobalPorcentaje = descGlobal;
            algoAgregado = true;
        }
    }

    let pedirCedula = false;
    if (datos.cliente && datos.cliente !== 'null' && !this.nuevaFactura.clienteId && !this.esConsumidorFinal) {
        if (datos.cliente === 'CONSUMIDOR_FINAL' || String(datos.cliente).toLowerCase().includes('consumidor')) {
            this.setConsumidorFinal();
        } else {
            const matchesCli = this.buscarClientesUniversales(datos.cliente);
            if (matchesCli.length === 1) {
                this.seleccionarCliente(matchesCli[0]); 
            } else if (matchesCli.length > 1) {
                pedirCedula = true; 
                this.iniciarDesambiguacion('CLIENTE', matchesCli, "Hay varios clientes con ese nombre. Dime el número del correcto: " + matchesCli.slice(0,3).map((c, i) => `${i+1}, ${c.nombreCompleto || c.primerNombre}`).join('. '));
                return;
            } else {
                mensajesAlerta.push(`no encontré a ${datos.cliente}`);
            }
        }
    }

    if (pedirCedula) {
        this.quiereEmitirPendiente = quiereEmitir;
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar("Por favor, díctame la cédula de ese cliente para estar segura.", () => this.escuchar());
        return;
    }

    const items = datos.items || [];
    let pedirAclaracionProd = null;

    for (let item of items) {
        if (!item.producto || item.producto === 'null') continue;
        
        const matchesProd = this.buscarProductos(item.producto);
        if (matchesProd.length === 1) {
            let prod = matchesProd[0]; 
            let cant = Number(item.cantidad);
            if (isNaN(cant) || cant <= 0) cant = 1;
            let descPct = Number(item.descuentoPorcentaje || 0);

            const bodegasConStock = this.bodegasList.filter(b => {
                const stock = this.obtenerStock(prod.id, b.id);
                return stock !== null && stock > 0;
            });

            let bodegaElegidaId = null;

            if (item.bodega && item.bodega !== 'null') {
                const bodCoincidencia = this.bodegasList.find(b => this.limpiarTexto(b.nombre).includes(this.limpiarTexto(item.bodega)));
                if (bodCoincidencia) {
                    bodegaElegidaId = bodCoincidencia.id;
                }
            }

            if (!bodegaElegidaId) {
                if (bodegasConStock.length === 1) {
                    bodegaElegidaId = bodegasConStock[0].id;
                } else if (bodegasConStock.length > 1) {
                    this.productoPendientePorBodega = prod;
                    this.cantidadPendientePorBodega = cant;
                    this.descuentoPendientePorBodega = descPct;
                    this.iniciarDesambiguacion('BODEGA', bodegasConStock, `Ese producto está en varias bodegas. ¿De cuál quieres que lo saque? ` + bodegasConStock.map((b, i) => `${i+1}, ${b.nombre}`).join('. '));
                    return; 
                } else {
                    mensajesAlerta.push(`no hay stock de ${prod.nombre}`);
                    continue;
                }
            }

            if (bodegaElegidaId) {
                const stockActual = this.obtenerStock(prod.id, bodegaElegidaId);
                
                if (stockActual === null || stockActual <= 0) {
                    mensajesAlerta.push(`no hay stock de ${prod.nombre}`);
                } else {
                    if (cant > stockActual) {
                        cant = stockActual;
                        mensajesAlerta.push(`solo metí ${cant} de ${prod.nombre} porque se acabó el stock`);
                    }
                    this.agregarProductoDirecto(prod, cant, bodegaElegidaId, descPct);
                    algoAgregado = true;
                }
            }
        } else if (matchesProd.length > 1) {
            pedirAclaracionProd = item.producto; 
            this.iniciarDesambiguacion('PRODUCTO', matchesProd, `Tengo varios productos que suenan igual. Dime el número del correcto: ` + matchesProd.slice(0,3).map((p, i) => `${i+1}, ${p.nombre}`).join('. '));
            return; 
        } else if (matchesProd.length === 0) {
            mensajesAlerta.push(`no tengo ${item.producto} en el catálogo`);
        }
    }

    this.cdr.detectChanges();

    const faltaCliente = !this.nuevaFactura.clienteId && !this.esConsumidorFinal;
    const faltaItems = this.nuevaFactura.detalles.length === 0;

    let prefijoAviso = mensajesAlerta.length > 0 ? `A ver, ${mensajesAlerta.join(', y ')}. ` : '';

    if ((quiereEmitir || this.quiereEmitirPendiente) && !faltaCliente && !faltaItems) {
        this.quiereEmitirPendiente = false;
        this.voiceState = VoiceStep.OFF;
        this.hablar(`${prefijoAviso}Todo listo. Emitiendo factura ahora mismo.`);
        setTimeout(() => { this.guardarFactura(); }, 1200);
        return;
    }

    this.quiereEmitirPendiente = false;
    this.voiceState = VoiceStep.ESCUCHA_LIBRE;

    if (faltaCliente) {
        this.hablar(`${prefijoAviso}Me falta el cliente. ¿A quién le facturamos?`, () => this.escuchar());
    } 
    else if (faltaItems) {
        this.hablar(`${prefijoAviso}El ticket está vacío. ¿Qué agregamos?`, () => this.escuchar());
    } 
    else {
        this.voiceState = VoiceStep.CONFIRMAR;
        let msj = algoAgregado
            ? `${prefijoAviso}A cobrar $${this.totalCarrito.toFixed(2)}. ¿Te emito la factura?`
            : `${prefijoAviso}Todo listo, son $${this.totalCarrito.toFixed(2)}. ¿Deseas emitir ya?`;
        this.hablar(msj, () => this.escuchar());
    }
  }

  private buscarProductos(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    let exact = this.productosList.filter(p => this.limpiarTexto(p.nombre) === txt);
    if (exact.length > 0) return exact;

    let partial = this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(txt) || txt.includes(this.limpiarTexto(p.nombre)));
    if (partial.length > 0) return partial;

    const palabras = txt.split(' ').filter(p => p.length > 2); 
    if (palabras.length > 0) {
        let agresivo = this.productosList.filter(p => {
            const nom = this.limpiarTexto(p.nombre);
            return palabras.some(pal => nom.includes(pal)); 
        });
        if (agresivo.length > 0) return agresivo;
    }
    return [];
  }

  private iniciarDesambiguacion(tipo: 'CLIENTE' | 'PRODUCTO' | 'BODEGA', opciones: any[], mensaje: string) {
    this.tipoOpciones = tipo;
    this.opcionesVoz = opciones.slice(0, 5); 
    this.voiceState = VoiceStep.ELEGIR_OPCION;
    this.cdr.detectChanges();
    this.hablar(mensaje, () => this.escuchar());
  }

  private manejarDesambiguacion(transcript: string) {
    const num = this.extraerIndice(transcript, this.opcionesVoz.length);

    if (num >= 0 && num < this.opcionesVoz.length) {
      const seleccionado = this.opcionesVoz[num];
      
      if (this.tipoOpciones === 'CLIENTE') {
          this.seleccionarCliente(seleccionado);
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          
          if (this.quiereEmitirPendiente) {
              this.aplicarDatosExtraidos({}, true);
          } else {
              this.aplicarDatosExtraidos({}); 
          }
      } 
      else if (this.tipoOpciones === 'PRODUCTO') {
          let prod = seleccionado;
          let cant = this.itemTemp.cantidad || 1;
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          
          this.aplicarDatosExtraidos({
              items: [{ producto: prod.nombre, cantidad: cant, descuentoPorcentaje: 0 }]
          });
      }
      else if (this.tipoOpciones === 'BODEGA') {
          let bodega = seleccionado;
          let prod = this.productoPendientePorBodega;
          let cant = this.cantidadPendientePorBodega;
          let desc = this.descuentoPendientePorBodega;
          
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          this.productoPendientePorBodega = null;

          const stockActual = this.obtenerStock(prod.id, bodega.id);
          if (stockActual !== null && stockActual > 0) {
              if (cant > stockActual) cant = stockActual;
              this.agregarProductoDirecto(prod, cant, bodega.id, desc);
              this.hablar(`Listo, lo saqué de ${bodega.nombre}. ¿Qué más?`, () => this.escuchar());
          } else {
              this.hablar(`Uy, no hay stock de ${prod.nombre} en ${bodega.nombre}. ¿Hacemos otra cosa?`, () => this.escuchar());
          }
      }
    } else {
      this.hablar("No te entendí. Dime qué número es.", () => this.escuchar());
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
    if (!this.itemTemp.productoId || !this.itemTemp.bodegaId || this.itemTemp.cantidad <= 0) return;
    const prodSelect = this.productosList.find(p => p.id === this.itemTemp.productoId);
    
    let cant = Math.abs(this.itemTemp.cantidad);
    const stockActual = this.obtenerStock(prodSelect.id, this.itemTemp.bodegaId);
    if (stockActual !== null && cant > stockActual) {
        cant = stockActual;
        Swal.fire('Stock Limitado', `Solo quedan ${stockActual} unidades disponibles.`, 'info');
    }
    
    let descPct = Number(this.itemTemp.descuentoPorcentaje || 0);

    if (cant > 0) {
        this.agregarProductoDirecto(prodSelect, cant, this.itemTemp.bodegaId, descPct);
    }
    this.itemTemp = { productoId: null, bodegaId: this.itemTemp.bodegaId, cantidad: null, descuentoPorcentaje: null, productoNombre: '' }; 
  }

  private agregarProductoDirecto(producto: any, cantidad: number, bodegaId: any, descuentoPorcentaje: number = 0) {
    if (!producto || !bodegaId || cantidad <= 0) return;

    let precio = Number(producto.costoPromedioActual || 0);
    if (precio <= 0) precio = Number(producto.precioUnitario || 0);

    const descMonto = (precio * cantidad) * (descuentoPorcentaje / 100);
    const subtotal = (precio * cantidad) - descMonto;

    const bodSelect = this.bodegasList.find(b => b.id === bodegaId);
    const bodegaNombre = bodSelect ? bodSelect.nombre : 'Principal';
    
    this.nuevaFactura.detalles.push({
      productoId: producto.id,
      bodegaId: bodegaId,
      bodegaNombre: bodegaNombre,
      cantidad: cantidad,
      productoNombre: producto.nombre,
      precioUnitario: precio,
      descuentoPorcentaje: descuentoPorcentaje, 
      descuentoMonto: descMonto, 
      subtotal: subtotal
    });
    this.cdr.detectChanges();
  }

  eliminarDelCarrito(index: number) {
    this.nuevaFactura.detalles.splice(index, 1);
  }

  guardarFactura() {
    if ((!this.nuevaFactura.clienteId && !this.esConsumidorFinal) || this.nuevaFactura.detalles.length === 0) {
      Swal.fire('Error', 'Faltan datos para emitir la factura.', 'error');
      return;
    }

    this.isSaving = true;
    Swal.fire({ title: 'Emitiendo Factura...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // 🔥 PREPARAR LA TARJETA SIMULADA PARA EL RECIBO
    if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO' && this.nuevaFactura.tarjetaNumero) {
        const numClean = this.nuevaFactura.tarjetaNumero.replace(/\D/g, '');
        if (numClean.length >= 4) {
            this.nuevaFactura.detallesTarjeta = `Tarjeta terminada en ${numClean.slice(-4)}`;
        } else {
            this.nuevaFactura.detallesTarjeta = 'Pago con Tarjeta';
        }
    }

    const payload = {
      clienteId: this.nuevaFactura.clienteId, 
      metodoPago: this.nuevaFactura.metodoPago,
      tarjeta: this.nuevaFactura.detallesTarjeta, 
      numeroCuotas: this.nuevaFactura.numeroCuotas,
      descuentoGlobal: this.montoDescuentoGlobal || 0, 
      detalles: this.nuevaFactura.detalles.map((d: any) => ({
        productoId: d.productoId,
        bodegaId: d.bodegaId,
        cantidad: d.cantidad,
        descuento: d.descuentoMonto || 0 
      }))
    };

    this.http.post<any>(`${this.apiUrl}/negocios/${this.negocioId}/facturas`, payload, { headers: this.getAuthHeaders() })
      .subscribe({
        next: (res) => {
          this.isSaving = false;
          this.showModal = false;
          if (this.negocioId) this.cargarTodasLasFacturas(this.negocioId);

          const facturaParaPDF = {
            numero: res.numeroFactura || 'S/N',
            cliente: res.clienteNombre || (this.esConsumidorFinal ? 'Consumidor Final' : 'Cliente'),
            fecha: res.fechaEmision ? new Date(res.fechaEmision).toLocaleDateString() : new Date().toLocaleDateString(),
            monto: Number(res.totalFactura || res.total || 0),
            tipo: res.formaPago || 'Manual',
            descuentoGlobal: this.montoDescuentoGlobal || 0,
            detalles: res.detallesFactura || res.detalles || this.nuevaFactura.detalles 
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

  imprimirFacturaPDF(fac: any) {
    const total = fac.monto;
    const subtotal = total / (1 + this.ivaActual);
    const iva = total - subtotal;
    
    const descuentoGlobal = Number(fac.descuentoGlobal || 0);
    
    let filasProductos = '';
    const baseUrl = window.location.origin; 
    
    if (fac.detalles && fac.detalles.length > 0) {
      fac.detalles.forEach((item: any) => {
        const cantidad = item.cantidad || 1;
        const descripcion = item.producto?.nombre || item.productoNombre || item.descripcion || 'Producto / Servicio';
        const precioUnit = Number(item.precioUnitario || item.precio || 0);
        
        const descItem = Number(item.descuento || item.descuentoMonto || 0);
        const subtotalItem = Number(item.subtotal || item.subtotalItem || ((cantidad * precioUnit) - descItem));
        
        let descHtml = descItem > 0 ? `<br><small style="color: #ea580c; font-weight: bold;">(Descuento: -$${descItem.toFixed(2)})</small>` : '';

        filasProductos += `
          <tr>
            <td class="center">${cantidad}</td>
            <td>${descripcion} ${descHtml}</td>
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
    
    const porcentajeIvaMostrar = (this.ivaActual * 100).toFixed(0);

    let htmlDescuento = descuentoGlobal > 0 ? `
        <div class="total-row">
            <span>Descuento Global Adicional</span>
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