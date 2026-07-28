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

  // 🔥 VARIABLES DE ZOE (VOZ)
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
  // 🔥 LÓGICA DE BÚSQUEDA INTELIGENTE UNIVERSAL (NUEVOS DTOS)
  // =======================================================
  private limpiarTexto(texto: any): string {
    if (texto == null) return '';
    return String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  private buscarClientesUniversales(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    if (!txt) return [...this.clientesList];
    
    // 1. Coincidencia Exacta (DNI, Email, Nombres)
    let exact = this.clientesList.filter(cli => 
        this.limpiarTexto(cli.nombreCompleto) === txt ||
        this.limpiarTexto(cli.primerNombre) === txt ||
        this.limpiarTexto(cli.apellidoPaterno) === txt ||
        this.limpiarTexto(cli.dni) === txt ||
        this.limpiarTexto(cli.email) === txt
    );
    if (exact.length > 0) return exact;

    // 2. Coincidencia Parcial
    let partial = this.clientesList.filter(cli => {
        const nom = this.limpiarTexto(cli.nombreCompleto || `${cli.primerNombre || ''} ${cli.apellidoPaterno || ''}`);
        const doc = this.limpiarTexto(cli.dni || '');
        const corr = this.limpiarTexto(cli.email || '');
        return nom.includes(txt) || txt.includes(nom) ||
               (doc && doc.includes(txt)) ||
               (corr && corr.includes(txt));
    });
    if (partial.length > 0) return partial;

    // 3. Fragmentos
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
    this.nuevaFactura.clienteId = cliente.id;
    this.clienteSeleccionadoInfo = cliente;
    this.terminoBusquedaCliente = cliente.nombreCompleto || `${cliente.primerNombre || ''} ${cliente.apellidoPaterno || ''}`.trim();
    
    this.mostrarDropdownClientes = false; 
    this.cdr.detectChanges(); 
  }

  limpiarClienteSeleccionado() {
    this.nuevaFactura.clienteId = null;
    this.clienteSeleccionadoInfo = null;
    this.terminoBusquedaCliente = '';
    this.clientesFiltrados = [...this.clientesList];
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
    if (!this.recognition) return;
    this.voiceState = VoiceStep.ESCUCHA_LIBRE;
    this.voiceMessage = "Te escucho. Dicta el nombre del cliente y los productos que deseas facturar.";
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
        let femaleVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google español') || v.name.includes('Sabina'))) || voices.find(v => v.lang.startsWith('es'));
        if (femaleVoice) utterance.voice = femaleVoice;

        utterance.onend = () => { setTimeout(() => { if (callback && this.voiceState !== VoiceStep.OFF) callback(); }, 200); };
        utterance.onerror = () => { if (callback && this.voiceState !== VoiceStep.OFF) setTimeout(() => callback(), 400); };

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

  private analizarConGroq(fraseUsuario: string) {
    this.isThinking = true;
    this.cdr.detectChanges();

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    const promptSystem = `
      Eres el asistente de un punto de venta.
      
      ESTADO ACTUAL:
      - Cliente ya seleccionado en el sistema: ${this.nuevaFactura.clienteId ? 'SÍ (Devuelve null en "cliente")' : 'NO'}

      Debes responder ÚNICAMENTE con un JSON:
      {
         "cliente": "Nombre exacto, DNI o email" (O null si ya está seleccionado),
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | null,
         "cuotas": numero_entero_o_null,
         "items": [
            { "producto": "Nombre exacto del producto", "cantidad": numero_entero }
         ]
      }
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
          this.hablar("Fallo de red al conectar con IA.", () => this.escuchar());
        }
      });
  }

  private aplicarDatosExtraidos(datos: any) {
    let algoAgregado = false;
    let nombresAgregados: string[] = [];
    
    let falloCliente = false;
    let nombreCliBuscado = "";
    let requiereDesambiguacionCli: any[] | null = null;
    let requiereDesambiguacionProd: any[] | null = null;
    let cantTemp = 1;

    // 1. Procesar Método de pago
    if (datos.metodoPago) {
        this.nuevaFactura.metodoPago = datos.metodoPago;
        if (datos.metodoPago === 'TARJETA_CREDITO' && datos.cuotas) this.nuevaFactura.numeroCuotas = datos.cuotas;
    }

    // 2. Procesar Productos
    let bodegaDefaultId = this.bodegasList.length > 0 ? this.bodegasList[0].id : null;
    const items = datos.items || [];
    if (datos.producto && items.length === 0) items.push({ producto: datos.producto, cantidad: datos.cantidad || 1 });

    for (let item of items) {
        if (!item.producto) continue;
        const matchesProd = this.buscarProductos(item.producto);
        
        if (matchesProd.length === 1) {
            this.agregarProductoDirecto(matchesProd[0], item.cantidad || 1, bodegaDefaultId);
            algoAgregado = true;
            nombresAgregados.push(`${item.cantidad || 1} ${matchesProd[0].nombre}`);
        } else if (matchesProd.length > 1) {
            requiereDesambiguacionProd = matchesProd;
            cantTemp = item.cantidad || 1;
            break; 
        }
    }

    // 3. Procesar Cliente (Solo si hace falta)
    if (datos.cliente && !this.nuevaFactura.clienteId) {
        nombreCliBuscado = datos.cliente;
        const matchesCli = this.buscarClientesUniversales(datos.cliente);
        
        if (matchesCli.length === 1) {
            this.seleccionarCliente(matchesCli[0]);
        } else if (matchesCli.length > 1) {
            requiereDesambiguacionCli = matchesCli;
        } else {
            falloCliente = true; 
        }
    }

    this.cdr.detectChanges();

    // 4. Pausas Inteligentes por falta de datos
    if (requiereDesambiguacionCli) {
        this.iniciarDesambiguacion('CLIENTE', requiereDesambiguacionCli, `Encontré varios clientes. Di el número: ${requiereDesambiguacionCli.slice(0,4).map((m, i) => (i+1) + '. ' + (m.nombreCompleto || m.primerNombre)).join(', ')}.`);
        return;
    }

    if (requiereDesambiguacionProd) {
        this.itemTemp.cantidad = cantTemp;
        this.iniciarDesambiguacion('PRODUCTO', requiereDesambiguacionProd, `Encontré varios productos. Di el número: ${requiereDesambiguacionProd.slice(0,4).map((m, i) => (i+1) + '. ' + m.nombre).join(', ')}.`);
        return;
    }

    const faltaCliente = !this.nuevaFactura.clienteId;
    const faltaItems = this.nuevaFactura.detalles.length === 0;

    this.voiceState = VoiceStep.ESCUCHA_LIBRE;

    // 🔥 Nuevo Seguro Anti-Bucle
    if (falloCliente) {
        this.hablar(`No encontré a ${nombreCliBuscado} en la base de datos. Por favor, dímelo otra vez por su nombre o cédula.`, () => this.escuchar());
    }
    else if (faltaCliente && faltaItems) {
        this.hablar("No logré identificar los datos. Intenta nuevamente.", () => this.escuchar());
    } 
    else if (faltaCliente) {
        const msg = algoAgregado 
          ? `Agregué los productos. Pero me falta el cliente. ¿A quién le facturamos?` 
          : "Me falta el cliente. ¿A quién le facturamos?";
        this.hablar(msg, () => this.escuchar());
    } 
    else if (faltaItems) {
        this.hablar(`¿Qué productos agregamos a la factura?`, () => this.escuchar());
    } 
    else {
        this.voiceState = VoiceStep.CONFIRMAR;
        let msj = algoAgregado
            ? `Listo. El total es $${this.totalCarrito.toFixed(2)}. ¿Emito la factura o agregas algo más?`
            : `Llevas $${this.totalCarrito.toFixed(2)}. ¿Deseas agregar algo más o emitimos?`;
        this.hablar(msj, () => this.escuchar());
    }
  }

  private buscarProductos(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    let exact = this.productosList.filter(p => this.limpiarTexto(p.nombre) === txt);
    if (exact.length > 0) return exact;

    let partial = this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(txt));
    if (partial.length > 0) return partial;

    const palabras = txt.split(' ');
    return this.productosList.filter(p => {
        const nom = this.limpiarTexto(p.nombre);
        return palabras.every(pal => nom.includes(pal));
    });
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
      
      if (this.tipoOpciones === 'CLIENTE') {
          this.seleccionarCliente(seleccionado);
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          this.aplicarDatosExtraidos({}); 
      } 
      else if (this.tipoOpciones === 'PRODUCTO') {
          let bodegaDefaultId = this.bodegasList.length > 0 ? this.bodegasList[0].id : null;
          this.agregarProductoDirecto(seleccionado, this.itemTemp.cantidad || 1, bodegaDefaultId);
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          this.aplicarDatosExtraidos({}); 
      }
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
  // 🔥 CARRITO Y PDF
  // =======================================================
  agregarAlCarrito() {
    if (!this.itemTemp.productoId || !this.itemTemp.bodegaId || this.itemTemp.cantidad <= 0) return;
    const prodSelect = this.productosList.find(p => p.id === this.itemTemp.productoId);
    this.agregarProductoDirecto(prodSelect, this.itemTemp.cantidad, this.itemTemp.bodegaId);
    this.itemTemp = { productoId: null, bodegaId: this.itemTemp.bodegaId, cantidad: 1, productoNombre: '' }; 
  }

  private agregarProductoDirecto(producto: any, cantidad: number, bodegaId: any) {
    if (!producto || !bodegaId) return;

    let cant = cantidad;
    const stock = this.obtenerStock(producto.id, bodegaId);
    if (stock !== null && cant > stock) cant = stock; 
    if (cant <= 0) return;

    let precio = Number(producto.costoPromedioActual || 0);
    if (precio <= 0) precio = Number(producto.precioUnitario || 0);
    
    this.nuevaFactura.detalles.push({
      productoId: producto.id,
      bodegaId: bodegaId,
      cantidad: cant,
      productoNombre: producto.nombre,
      precioUnitario: precio,
      subtotal: precio * cant
    });
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