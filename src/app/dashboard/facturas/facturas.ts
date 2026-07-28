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
    this.voiceMessage = "Te escucho. Dicta el cliente y los productos...";
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
    const comandosAceptacion = ['si', 'sí', 'emite', 'dale', 'confirmo', 'listo', 'ok', 'todo bien', 'factura'];
    const esComandoPositivo = comandosAceptacion.some(cmd => transcript.includes(cmd));

    if (this.voiceState === VoiceStep.ESCUCHA_LIBRE) {
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
       if (esComandoPositivo || transcript.includes('no falta nada') || transcript.includes('nada más')) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("Emitiendo comprobante.", () => this.guardarFactura());
       } else if (transcript.includes('espera') || transcript.includes('pausa') || transcript.includes('cancela')) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("Factura pausada. Puedes continuar manualmente.");
       } else {
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
  // 🔥 CONEXIÓN A GROQ MULTIPRODUCTO
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

    const promptSystem = `
      Eres el asistente de un punto de venta. Analiza la frase del usuario y extrae los datos requeridos.
      Debes responder ÚNICAMENTE con un JSON válido usando la siguiente estructura (omite texto adicional):
      {
         "cliente": "Nombre exacto o null",
         "bodega": "Nombre o null",
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | null,
         "cuotas": numero_entero_o_null,
         "items": [
            { "producto": "Nombre exacto", "cantidad": numero_entero }
         ]
      }
      Bases de datos:
      - Productos: [${listaNombresProd}]
      - Clientes: [${listaNombresCli}]
      - Bodegas: [${listaNombresBod}]
      Si el usuario dicta varios productos, agrega todos al arreglo 'items'. Si no menciona cantidad, asume 1.
      IMPORTANTE: Si el usuario menciona "tarjeta de crédito" y un número de cuotas/meses, asegúrate de llenar el campo "metodoPago" con "TARJETA_CREDITO" y "cuotas" con el número.
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

    // 🔥 CORRECCIÓN AQUÍ: URL limpia sin sintaxis markdown 
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

    // 3. Asignar Método de pago y cuotas
    if (datos.metodoPago) {
        this.nuevaFactura.metodoPago = datos.metodoPago;
        if (datos.metodoPago === 'TARJETA_CREDITO' && datos.cuotas) {
            this.nuevaFactura.numeroCuotas = datos.cuotas;
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
        this.hablar("No logré identificar clientes ni productos. Intenta mencionarlos nuevamente.", () => this.escuchar());
    } 
    else if (faltaCliente) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        const msg = algoAgregado 
          ? `Agregué ${nombresAgregados.join(', ')}. Pero me falta el cliente. ¿A quién le facturamos?` 
          : "Me falta el cliente. ¿A quién le facturamos?";
        this.hablar(msg, () => this.escuchar());
    } 
    else if (faltaItems) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`Listo con el cliente. ¿Qué productos agregamos a la factura?`, () => this.escuchar());
    } 
    else {
        this.voiceState = VoiceStep.CONFIRMAR;
        let msj = algoAgregado
            ? `Listo. El total a pagar es $${this.totalCarrito.toFixed(2)}. ¿Falta algo más o emito la factura?`
            : `Llevas $${this.totalCarrito.toFixed(2)}. ¿Deseas agregar otro producto o emitimos?`;
        
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
        this.limpiarTexto(cli.razonSocial).includes(termino) ||
        this.limpiarTexto(cli.primerNombre).includes(termino) ||
        this.limpiarTexto(cli.identificacion).includes(termino) ||
        this.limpiarTexto(cli.dni).includes(termino) ||
        this.limpiarTexto(cli.ruc).includes(termino) ||
        this.limpiarTexto(cli.correo).includes(termino) ||
        this.limpiarTexto(cli.email).includes(termino)
      );
    }
  }

  seleccionarCliente(cliente: any) {
    if (!cliente) return;
    this.nuevaFactura.clienteId = cliente.id;
    this.clienteSeleccionadoInfo = cliente;
    this.terminoBusquedaCliente = cliente.nombreCompleto || cliente.razonSocial || cliente.primerNombre || '';
    
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
    if (!this.nuevaFactura.clienteId || this.nuevaFactura.detalles.length === 0) {
      Swal.fire('Error', 'Faltan datos para emitir la factura.', 'error');
      return;
    }

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
            detalles: res.detallesFactura || res.detalles || this.nuevaFactura.detalles 
          };
          
          this.imprimirFacturaPDF(facturaParaPDF);

          Swal.fire({ icon: 'success', title: '¡Factura Emitida!', timer: 1500, showConfirmButton: false });
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
    
    const baseUrl = window.location.origin; 
    
    if (fac.detalles && fac.detalles.length > 0) {
      fac.detalles.forEach((item: any) => {
        const cantidad = item.cantidad || 1;
        const descripcion = item.producto?.nombre || item.productoNombre || item.descripcion || 'Producto / Servicio';
        const precioUnit = Number(item.precioUnitario || item.precio || 0);
        const subtotalItem = Number(item.subtotal || item.subtotalItem || (cantidad * precioUnit));
        
        filasProductos += `
          <tr>
            <td class="center">${cantidad}</td>
            <td>${descripcion}</td>
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
              @media print { 
                  body { background-color: white; }
                  .invoice-container { padding: 0; max-width: 100%; }
                  .top-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                  th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                  .total-row.grand-total { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                  .info-grid { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
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
                      <div class="total-row">
                          <span>IVA (15%)</span>
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