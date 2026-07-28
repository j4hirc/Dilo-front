import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import Swal from 'sweetalert2';

// 🔥 ESTADOS SIMPLIFICADOS PARA ZOE
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
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = environment.apiUrl;
  private groqApiKey = environment.groqApiKey;

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

  nuevaFactura = {
    clienteId: null,
    metodoPago: 'EFECTIVO',
    numeroCuotas: 0,
    detalles: [] as any[]
  };

  itemTemp = {
    productoId: null,
    bodegaId: null,
    cantidad: 1,
    productoNombre: '' 
  };

  // =========================================
  // 🔥 VARIABLES DE ZOE (VOZ)
  // =========================================
  voiceState: VoiceStep = VoiceStep.OFF;
  voiceMessage: string = ''; 
  userTranscript: string = ''; 
  isListening: boolean = false;
  isThinking: boolean = false; 
  private recognition: any;
  opcionesVoz: any[] = [];
  tipoOpciones: 'CLIENTE' | 'BODEGA' | 'PRODUCTO' | null = null;

  get totalCarrito(): number {
    return this.nuevaFactura.detalles.reduce((sum, item) => sum + (item.subtotal || 0), 0);
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
    
    if (this.negocioId) {
      this.cargarTodasLasFacturas(this.negocioId);
    } else {
      this.isLoading = false;
    }

    this.initSpeechRecognition();
    window.speechSynthesis.getVoices();
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
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => this.isLoading = false
    });
  }

  abrirModalNuevo(porVoz = false) {
    this.showModal = true;
    this.cdr.detectChanges(); 

    this.cargarCatalogos();
    this.nuevaFactura = { clienteId: null, metodoPago: 'EFECTIVO', numeroCuotas: 0, detalles: [] };
    this.itemTemp = { productoId: null, bodegaId: null, cantidad: 1, productoNombre: '' };
    this.terminoBusquedaCliente = '';
    this.clienteSeleccionadoInfo = null;
    this.mostrarDropdownClientes = false;
    this.opcionesVoz = [];
    this.tipoOpciones = null;

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

  verificarCuotas() {
    if (this.nuevaFactura.metodoPago !== 'TARJETA_CREDITO') {
      this.nuevaFactura.numeroCuotas = 0;
    }
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

  // =======================================================
  // 🔥 LÓGICA DE ZOE CON GROQ (NLP INTELIGENTE)
  // =======================================================

  initSpeechRecognition() {
    const { webkitSpeechRecognition } = window as any;
    if (!webkitSpeechRecognition) return;

    this.recognition = new webkitSpeechRecognition();
    this.recognition.lang = 'es-EC'; 
    this.recognition.continuous = false;
    this.recognition.interimResults = false;

    this.recognition.onresult = (event: any) => {
      let transcript = event.results[0][0].transcript.toLowerCase().trim();
      transcript = transcript.replace(/\.$/, ''); 

      this.userTranscript = transcript;
      this.isListening = false;
      this.cdr.detectChanges();

      if (!transcript) {
         setTimeout(() => this.escuchar(), 500);
         return;
      }

      this.procesarComandoVoz(transcript);
    };

    this.recognition.onerror = (event: any) => {
      this.isListening = false;
      this.cdr.detectChanges();
      if (event.error === 'not-allowed') {
        Swal.fire('Micrófono bloqueado', 'Permite el acceso al micrófono.', 'error');
        this.cancelarAsistenteVoz();
      } else if (event.error !== 'aborted') {
        setTimeout(() => this.escuchar(), 1000);
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.cdr.detectChanges();
    };
  }

  iniciarFacturaPorVoz() {
    if (!this.recognition) {
      Swal.fire('Error', 'Navegador no soportado. Usa Chrome.', 'info');
      this.cancelarAsistenteVoz();
      return;
    }
    
    this.voiceState = VoiceStep.ESCUCHA_LIBRE;
    this.voiceMessage = "Te escucho. Dicta el cliente, productos y método de pago...";
    this.cdr.detectChanges();
    this.escuchar();
  }

  cancelarAsistenteVoz() {
    this.voiceState = VoiceStep.OFF;
    this.opcionesVoz = [];
    this.tipoOpciones = null;
    this.isListening = false;
    this.isThinking = false;
    window.speechSynthesis.cancel();
    if (this.recognition) this.recognition.abort();
    this.cdr.detectChanges();
  }

  private hablar(texto: string, callback?: () => void) {
    window.speechSynthesis.cancel(); 
    
    setTimeout(() => {
        this.voiceMessage = texto;
        this.userTranscript = ''; 
        this.cdr.detectChanges();

        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = 'es-ES';
        utterance.rate = 1.05; 
        
        let voices = window.speechSynthesis.getVoices();
        
        let femaleVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google español') || v.name.includes('Sabina') || v.name.includes('Microsoft'))) ||
                          voices.find(v => v.lang.startsWith('es') && v.name.includes('Google')) || 
                          voices.find(v => v.lang.startsWith('es'));
        
        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }

        utterance.onend = () => {
          setTimeout(() => {
              if (callback && this.voiceState !== VoiceStep.OFF) {
                callback();
              }
          }, 200); 
        };

        utterance.onerror = () => {
            if (callback && this.voiceState !== VoiceStep.OFF) setTimeout(() => callback(), 400);
        };

        window.speechSynthesis.speak(utterance);
    }, 50); 
  }

  private escuchar() {
    if (this.voiceState === VoiceStep.OFF || this.voiceState === VoiceStep.INICIANDO) return;
    this.isListening = true;
    this.userTranscript = ''; 
    this.cdr.detectChanges();
    try { this.recognition.start(); } catch (e) {}
  }

  private procesarComandoVoz(transcript: string) {
    const comandosAceptacion = ['si', 'sí', 'emite', 'dale', 'confirmo', 'listo', 'ok', 'todo bien', 'factura', 'guarda'];
    const esComandoPositivo = comandosAceptacion.some(cmd => transcript.includes(cmd));

    if (this.voiceState === VoiceStep.ESCUCHA_LIBRE) {
       // Comando directo para emitir rápido
       if ((transcript.includes('emite') || transcript.includes('factura ya')) && this.nuevaFactura.detalles.length > 0) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("Emitiendo factura.", () => this.guardarFactura());
          return;
       }
       this.analizarConGroq(transcript);
    } 
    else if (this.voiceState === VoiceStep.ELEGIR_OPCION) {
       this.manejarDesambiguacion(transcript);
    }
    else if (this.voiceState === VoiceStep.CONFIRMAR) {
       // Si Zoe preguntó si faltaba algo y respondes que no/emite/si
       if (esComandoPositivo || transcript.includes('no falta nada') || transcript.includes('nada más')) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("Emitiendo comprobante.", () => this.guardarFactura());
       } else if (transcript.includes('espera') || transcript.includes('pausa') || transcript.includes('cancela')) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("Factura pausada. Puedes continuar manualmente.");
       } else {
          // Si agrega más cosas
          this.voiceState = VoiceStep.ESCUCHA_LIBRE;
          this.analizarConGroq(transcript);
       }
    }
  }

  // =======================================================
  // 🔥 UTILS NLP: MATCH RESILIENTE
  // =======================================================
  private limpiarTexto(texto: any): string {
    if (texto == null) return '';
    return String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  private encontrarMejorCoincidencia(textoBuscado: string, lista: any[], campoBusqueda: string): any {
    if (!textoBuscado) return null;
    const textoLimpio = this.limpiarTexto(textoBuscado);
    
    let match = lista.find(item => this.limpiarTexto(item[campoBusqueda]) === textoLimpio);
    if (match) return match;
    
    match = lista.find(item => {
        const nombreBD = this.limpiarTexto(item[campoBusqueda]);
        return nombreBD.includes(textoLimpio) || textoLimpio.includes(nombreBD);
    });
    
    return match || null;
  }

  // =======================================================
  // 🔥 CONEXIÓN A GROQ: ACTUALIZADO PARA METODO DE PAGO Y CUOTAS
  // =======================================================
  private analizarConGroq(fraseUsuario: string) {
    this.isThinking = true;
    this.cdr.detectChanges();

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    const listaNombresProd = this.productosList.map(p => p.nombre).join(', ');
    const listaNombresCli = this.clientesList.map(c => c.nombreCompleto || c.primerNombre).join(', ');
    const listaNombresBod = this.bodegasList.map(b => b.nombre).join(', ');

    // 🔥 PROMPT MEJORADO PARA CUOTAS Y PAGOS
    const promptSystem = `
      Eres el asistente de un punto de venta. Analiza la frase del usuario y extrae los datos.
      Debes responder ÚNICAMENTE con un JSON válido usando esta estructura exacta (omite texto adicional):
      {
         "cliente": "Nombre exacto o null",
         "bodega": "Nombre o null",
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | null,
         "cuotas": numero_entero_o_0,
         "items": [
            { "producto": "Nombre exacto", "cantidad": numero_entero }
         ]
      }
      Reglas Estrictas:
      - metodoPago: Si menciona "efectivo", devuelve "EFECTIVO". Si dice "transferencia" o "depósito", devuelve "TRANSFERENCIA". Si dice "tarjeta", "crédito" o "diferido", devuelve "TARJETA_CREDITO".
      - cuotas: Si dice "a 3 meses", "diferido a 6", "6 cuotas", extrae solo el número (ej: 3). Si no menciona meses/cuotas, pon 0.
      Bases de datos disponibles:
      - Productos: [${listaNombresProd}]
      - Clientes: [${listaNombresCli}]
      - Bodegas: [${listaNombresBod}]
    `;

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: fraseUsuario }
      ],
      temperature: 0.1, 
      max_tokens: 350
    };

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          this.isThinking = false;
          try {
            const respuestaStr = res.choices[0].message.content;
            const jsonStr = respuestaStr.substring(respuestaStr.indexOf('{'), respuestaStr.lastIndexOf('}') + 1);
            const datosExtraidos = JSON.parse(jsonStr);
            this.aplicarDatosExtraidos(datosExtraidos);
          } catch (e) {
            this.hablar("No procesé bien la petición. ¿Repetimos?", () => this.escuchar());
          }
        },
        error: () => {
          this.isThinking = false;
          this.hablar("Fallo de red. Repite, por favor.", () => this.escuchar());
        }
      });
  }

  // =======================================================
  // 🔥 RELLENADO MASIVO EN VIVO
  // =======================================================
  private aplicarDatosExtraidos(datos: any) {
    let algoAgregado = false;
    let nombresAgregados: string[] = [];

    // 1. Asignar Cliente
    if (datos.cliente && !this.nuevaFactura.clienteId) {
        const matchCli = this.encontrarMejorCoincidencia(datos.cliente, this.clientesList, 'nombreCompleto') 
                         || this.encontrarMejorCoincidencia(datos.cliente, this.clientesList, 'primerNombre');
        if (matchCli) this.seleccionarCliente(matchCli);
    }

    // 2. Asignar Bodega
    let bodegaDefaultId = this.itemTemp.bodegaId;
    if (!bodegaDefaultId && this.bodegasList.length === 1) {
        bodegaDefaultId = this.bodegasList[0].id;
    } else if (datos.bodega) {
        const matchBod = this.encontrarMejorCoincidencia(datos.bodega, this.bodegasList, 'nombre');
        if (matchBod) bodegaDefaultId = matchBod.id;
    }
    if (bodegaDefaultId) this.itemTemp.bodegaId = bodegaDefaultId;

    // 3. Asignar Método de pago y Cuotas
    if (datos.metodoPago) {
        this.nuevaFactura.metodoPago = datos.metodoPago;
    }
    if (datos.cuotas > 0) {
        this.nuevaFactura.numeroCuotas = datos.cuotas;
        // Si menciona cuotas pero no dijo "tarjeta", asumimos que es Tarjeta de Crédito inteligentemente
        if (!datos.metodoPago || datos.metodoPago === 'EFECTIVO') {
            this.nuevaFactura.metodoPago = 'TARJETA_CREDITO';
        }
    }

    // 4. Agregar Productos en bloque
    const items = datos.items || [];
    if (datos.producto && items.length === 0) items.push({ producto: datos.producto, cantidad: datos.cantidad || 1 });

    items.forEach((item: any) => {
        const dProducto = item.producto;
        if (!dProducto) return;

        const matchProd = this.encontrarMejorCoincidencia(dProducto, this.productosList, 'nombre');
        
        if (matchProd) {
            let cant = item.cantidad || 1;
            const stock = this.obtenerStock(matchProd.id, bodegaDefaultId);
            
            if (stock !== null && cant > stock) cant = stock; 

            if (cant > 0) {
                this.itemTemp.productoId = matchProd.id;
                this.itemTemp.cantidad = cant;
                this.agregarAlCarritoSilencioso();
                algoAgregado = true;
                nombresAgregados.push(`${cant} ${matchProd.nombre}`);
            }
        }
    });

    this.cdr.detectChanges();
    this.evaluarEstadoFactura(algoAgregado, nombresAgregados);
  }

  // =======================================================
  // 🔥 EVALUADOR INTELIGENTE AL FINALIZAR
  // =======================================================
  private evaluarEstadoFactura(algoAgregado: boolean, nombresAgregados: string[]) {
    const faltaCliente = !this.nuevaFactura.clienteId;
    const faltaItems = this.nuevaFactura.detalles.length === 0;

    if (faltaCliente && faltaItems) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar("Intenta mencionar el cliente o los productos nuevamente.", () => this.escuchar());
    } 
    else if (faltaCliente) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        const msg = algoAgregado 
          ? `Agregado. Pero me falta el cliente. ¿A quién le facturamos?` 
          : "Me falta el cliente. ¿A quién le facturamos?";
        this.hablar(msg, () => this.escuchar());
    } 
    else if (faltaItems) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`Listo con el cliente. ¿Qué productos agregamos a la factura?`, () => this.escuchar());
    } 
    else {
        this.voiceState = VoiceStep.CONFIRMAR;
        let msjAdicional = "";
        
        // Si extrajo un método de pago por voz, se lo decimos para que esté seguro
        if (this.nuevaFactura.metodoPago === 'TRANSFERENCIA') {
            msjAdicional = " por transferencia";
        } else if (this.nuevaFactura.metodoPago === 'TARJETA_CREDITO') {
            msjAdicional = this.nuevaFactura.numeroCuotas > 0 ? ` con tarjeta a ${this.nuevaFactura.numeroCuotas} meses` : " con tarjeta";
        }

        let msj = algoAgregado
            ? `Listo. El total es $${this.totalCarrito.toFixed(2)}${msjAdicional}. ¿Falta algo más o emito la factura?`
            : `Llevas $${this.totalCarrito.toFixed(2)}${msjAdicional}. ¿Deseas agregar otro producto o emitimos?`;
        
        this.hablar(msj, () => this.escuchar());
    }
  }

  private intentarAgregarItem() {
    if (this.nuevaFactura.clienteId && this.itemTemp.bodegaId && this.itemTemp.productoId && this.itemTemp.cantidad > 0) {
        const stockActual = this.stockDisponible;
        if (stockActual !== null && this.itemTemp.cantidad > stockActual) {
            this.itemTemp.cantidad = stockActual; 
        }
        if (this.itemTemp.cantidad > 0) {
            const prodSelect = this.productosList.find(p => p.id === this.itemTemp.productoId);
            const nombreProd = prodSelect ? prodSelect.nombre : 'Producto';
            this.agregarAlCarritoSilencioso();
            this.evaluarEstadoFactura(true, [`${this.itemTemp.cantidad} ${nombreProd}`]);
        } else {
            this.evaluarEstadoFactura(false, []);
        }
    } else {
        this.evaluarEstadoFactura(false, []);
    }
  }

  private iniciarDesambiguacion(tipo: 'CLIENTE' | 'BODEGA' | 'PRODUCTO', opciones: any[], mensaje: string) {
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
      
      if (this.tipoOpciones === 'CLIENTE') this.seleccionarCliente(seleccionado);
      else if (this.tipoOpciones === 'BODEGA') this.itemTemp.bodegaId = seleccionado.id;
      else if (this.tipoOpciones === 'PRODUCTO') this.itemTemp.productoId = seleccionado.id;
      
      this.opcionesVoz = [];
      this.tipoOpciones = null;
      this.intentarAgregarItem();
    } else {
      this.hablar("No capté el número. Dilo de nuevo.", () => this.escuchar());
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
  // 🔥 MÉTODOS DEL COMPONENTE (FACTURA NORMAL Y SILENCIOSO)
  // =======================================================

  filtrarClientes() {
    if (!this.terminoBusquedaCliente.trim()) {
      this.clientesFiltrados = [...this.clientesList];
    } else {
      const termino = this.limpiarTexto(this.terminoBusquedaCliente);
      this.clientesFiltrados = this.clientesList.filter(cli => 
        this.limpiarTexto(cli.nombreCompleto).includes(termino) ||
        this.limpiarTexto(cli.identificacion).includes(termino)
      );
    }
  }

  seleccionarCliente(cliente: any) {
    this.nuevaFactura.clienteId = cliente.id;
    this.clienteSeleccionadoInfo = cliente;
    this.terminoBusquedaCliente = cliente.nombreCompleto || cliente.razonSocial || cliente.primerNombre;
    this.mostrarDropdownClientes = false;
    this.cdr.detectChanges();
  }

  limpiarClienteSeleccionado() {
    this.nuevaFactura.clienteId = null;
    this.clienteSeleccionadoInfo = null;
    this.terminoBusquedaCliente = '';
    this.clientesFiltrados = [...this.clientesList];
  }

  agregarAlCarrito() {
    this.agregarAlCarritoSilencioso();
  }

  private agregarAlCarritoSilencioso() {
    if (!this.itemTemp.productoId || !this.itemTemp.bodegaId || this.itemTemp.cantidad <= 0) return;

    const prodSelect = this.productosList.find(p => p.id === this.itemTemp.productoId);
    let precio = Number(prodSelect?.costoPromedioActual || 0);
    if (precio <= 0) precio = Number(prodSelect?.precioUnitario || 0);
    
    this.nuevaFactura.detalles.push({
      productoId: this.itemTemp.productoId,
      bodegaId: this.itemTemp.bodegaId,
      cantidad: this.itemTemp.cantidad,
      productoNombre: prodSelect ? prodSelect.nombre : 'Producto',
      precioUnitario: precio,
      subtotal: precio * this.itemTemp.cantidad
    });

    this.itemTemp = { productoId: null, bodegaId: this.itemTemp.bodegaId, cantidad: 1, productoNombre: '' }; 
    this.cdr.detectChanges();
  }

  eliminarDelCarrito(index: number) {
    this.nuevaFactura.detalles.splice(index, 1);
  }

  guardarFactura() {
    if (!this.nuevaFactura.clienteId || this.nuevaFactura.detalles.length === 0) return;

    this.isSaving = true;
    Swal.fire({ title: 'Emitiendo Factura...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const payload = {
      clienteId: this.nuevaFactura.clienteId,
      metodoPago: this.nuevaFactura.metodoPago,
      numeroCuotas: this.nuevaFactura.numeroCuotas,
      detalles: this.nuevaFactura.detalles.map(d => ({
        productoId: d.productoId,
        bodegaId: d.bodegaId,
        cantidad: d.cantidad
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
            cliente: res.clienteNombre || 'Consumidor Final',
            fecha: res.fechaEmision ? new Date(res.fechaEmision).toLocaleDateString() : new Date().toLocaleDateString(),
            monto: Number(res.totalFactura || res.total || 0),
            tipo: res.formaPago || 'Manual',
            detalles: res.detallesFactura || res.detalles || [] 
          };

          Swal.fire({ icon: 'success', title: '¡Factura Emitida!', timer: 1500, showConfirmButton: false })
            .then(() => this.imprimirFacturaPDF(facturaParaPDF));
        },
        error: (err) => {
          this.isSaving = false;
          Swal.fire('Error', err.error?.message || 'Error al emitir.', 'error');
        }
      });
  }

  descargarPDF(fac: any) {
    this.imprimirFacturaPDF(fac);
  }

  imprimirFacturaPDF(fac: any) {
    const total = fac.monto;
    const subtotal = total / 1.15;
    const iva = total - subtotal;
    let filasProductos = '';
    
    if (fac.detalles && fac.detalles.length > 0) {
      fac.detalles.forEach((item: any) => {
        const cantidad = item.cantidad || 1;
        const descripcion = item.producto?.nombre || item.productoNombre || item.descripcion || 'Producto';
        const precioUnit = Number(item.precioUnitario || item.precio || 0);
        const subtotalItem = Number(item.subtotal || item.subtotalItem || (cantidad * precioUnit));
        
        filasProductos += `<tr><td class="center">${cantidad}</td><td>${descripcion}</td><td class="text-right">$${precioUnit.toFixed(2)}</td><td class="text-right font-bold">$${subtotalItem.toFixed(2)}</td></tr>`;
      });
    }
    
    const baseUrl = window.location.origin; 
    const ventana = window.open('', '', 'width=900,height=700');
    ventana?.document.write(`
      <!DOCTYPE html><html><head><title>Factura_${fac.numero}</title>
      <style>body{font-family:sans-serif;} table{width:100%;border-collapse:collapse;} th,td{border-bottom:1px solid #ddd;padding:8px;}</style>
      </head><body><h2>Factura Nº ${fac.numero}</h2><p>Cliente: ${fac.cliente}</p>
      <table><tr><th>Cant</th><th>Descripción</th><th>P.Unit</th><th>Total</th></tr>${filasProductos}</table>
      <h3>Total: $${total.toFixed(2)}</h3></body></html>
    `);
    ventana?.document.close();
    ventana?.focus();
    setTimeout(() => { ventana?.print(); ventana?.close(); }, 800);
  }

  ocultarDropdown() {
    setTimeout(() => this.mostrarDropdownClientes = false, 200);
  }
}