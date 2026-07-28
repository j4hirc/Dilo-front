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
    if (!this.itemTemp.productoId || !this.itemTemp.bodegaId) return null;
    const inv = this.inventarioList.find(i => 
      (i.productoId === this.itemTemp.productoId || i.producto?.id === this.itemTemp.productoId) && 
      (i.bodegaId === this.itemTemp.bodegaId || i.bodega?.id === this.itemTemp.bodegaId)
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
    this.hablar("Dime los datos de tu venta.", () => this.escuchar());
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
        
        // 🔥 FORZAMOS LA MEJOR VOZ FEMENINA
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
    if (this.voiceState === VoiceStep.ESCUCHA_LIBRE) {
       // Comando directo para emitir
       if ((transcript.includes('confirma') || transcript.includes('emite') || transcript.includes('factura')) && this.nuevaFactura.detalles.length > 0) {
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
       if (transcript.includes('si') || transcript.includes('sí') || transcript.includes('emite') || transcript.includes('dale')) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("Emitiendo factura.");
          this.guardarFactura();
       } else if (transcript.includes('no') || transcript.includes('espera') || transcript.includes('pausa')) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("Factura pausada.");
       } else {
          this.voiceState = VoiceStep.ESCUCHA_LIBRE;
          this.analizarConGroq(transcript);
       }
    }
  }

  // =======================================================
  // 🔥 UTILS NLP: QUITAR TILDES (PARA BÚSQUEDAS EXACTAS)
  // =======================================================
  private limpiarTexto(texto: any): string {
    if (!texto) return '';
    return String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  // =======================================================
  // 🔥 CONEXIÓN A GROQ
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
      Eres el motor NLP de un punto de venta.
      Productos: [${listaNombresProd}]
      Clientes: [${listaNombresCli}]
      Bodegas: [${listaNombresBod}]

      Extrae en JSON:
      {
         "producto": "nombre exacto o null",
         "cantidad": numero_entero o null,
         "cliente": "nombre exacto o null",
         "bodega": "nombre exacto o null",
         "metodoPago": "EFECTIVO", "TRANSFERENCIA", "TARJETA_CREDITO" o null
      }
    `;

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: fraseUsuario }
      ],
      temperature: 0.1, 
      max_tokens: 200
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
            this.hablar("No entendí bien. ¿Repetimos?", () => this.escuchar());
          }
        },
        error: () => {
          this.isThinking = false;
          this.hablar("Fallo de red. Repite, por favor.", () => this.escuchar());
        }
      });
  }

  // =======================================================
  // 🔥 RELLENADO DE FORMULARIO EN VIVO
  // =======================================================
  private aplicarDatosExtraidos(datos: any) {
    if (datos.metodoPago) this.nuevaFactura.metodoPago = datos.metodoPago;
    if (datos.cantidad) this.itemTemp.cantidad = datos.cantidad;

    if (!this.itemTemp.bodegaId) {
      if (this.bodegasList.length === 1) {
        this.itemTemp.bodegaId = this.bodegasList[0].id;
      } else if (datos.bodega) {
        const dBodega = this.limpiarTexto(datos.bodega);
        const bodMatch = this.bodegasList.find(b => this.limpiarTexto(b.nombre).includes(dBodega));
        if (bodMatch) this.itemTemp.bodegaId = bodMatch.id;
      }
    }

    if (datos.cliente && !this.nuevaFactura.clienteId) {
      const dCliente = this.limpiarTexto(datos.cliente);
      const cliMatches = this.clientesList.filter(c => 
          this.limpiarTexto(c.nombreCompleto).includes(dCliente) || 
          this.limpiarTexto(c.primerNombre).includes(dCliente)
      );
      if (cliMatches.length === 1) {
        this.seleccionarCliente(cliMatches[0]);
      } else if (cliMatches.length > 1) {
        this.iniciarDesambiguacion('CLIENTE', cliMatches, `Encontré varios. Di el número del cliente correcto.`);
        return;
      }
    }

    if (datos.producto) {
      const dProducto = this.limpiarTexto(datos.producto);
      const prodMatches = this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(dProducto));
      
      if (prodMatches.length === 1) {
        this.itemTemp.productoId = prodMatches[0].id;
      } else if (prodMatches.length > 1) {
        this.iniciarDesambiguacion('PRODUCTO', prodMatches, `Hay varios productos parecidos. Di el número.`);
        return;
      }
    }

    this.cdr.detectChanges();
    this.intentarAgregarItem();
  }

  private intentarAgregarItem() {
    if (this.nuevaFactura.clienteId && this.itemTemp.bodegaId && this.itemTemp.productoId && this.itemTemp.cantidad > 0) {
        const stockActual = this.stockDisponible;
        if (stockActual !== null && this.itemTemp.cantidad > stockActual) {
            this.itemTemp.cantidad = 0; 
            this.voiceState = VoiceStep.ESCUCHA_LIBRE;
            this.hablar(`Solo quedan ${stockActual} unidades. ¿Cuántas agregamos?`, () => this.escuchar());
            return;
        }

        this.agregarAlCarritoSilencioso();
        this.voiceState = VoiceStep.CONFIRMAR;
        this.hablar(`Agregado. Llevas ${this.totalCarrito.toFixed(2)}. ¿Deseas añadir otro producto o confirmo la factura?`, () => this.escuchar());
    } else {
        this.evaluarQueFalta();
    }
  }

  private evaluarQueFalta() {
    this.voiceState = VoiceStep.ESCUCHA_LIBRE; // Siempre libre para Groq
    if (!this.nuevaFactura.clienteId) {
      this.hablar("Falta el cliente. ¿A quién facturamos?", () => this.escuchar());
    } else if (!this.itemTemp.bodegaId && this.bodegasList.length > 1) {
      this.hablar("¿De qué bodega salen los productos?", () => this.escuchar());
    } else if (!this.itemTemp.productoId) {
      this.hablar("¿Qué producto agregamos?", () => this.escuchar());
    } else if (!this.itemTemp.cantidad || this.itemTemp.cantidad <= 0) {
      this.hablar("¿Qué cantidad?", () => this.escuchar());
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

    // Mantiene la bodega elegida para el siguiente producto por rapidez
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