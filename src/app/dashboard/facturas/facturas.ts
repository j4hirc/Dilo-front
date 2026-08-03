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
  negocioInfo: any = null; 
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

  nuevaFactura: any = {
    clienteId: null,
    metodoPago: null, 
    numeroCuotas: 0,
    detallesTarjeta: '', 
    tarjetaNumero: '', 
    tarjetaVence: '',  
    tarjetaCvc: '',    
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

  productoPendientePorBodega: any = null;
  cantidadPendientePorBodega: number = 1;
  descuentoPendientePorBodega: number = 0;
  
  hoverIndex: number = -1; // 🔥 Para el hover de los botones de opciones

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
      this.cargarDatosNegocio(); 
      this.cargarTodasLasFacturas(this.negocioId);
    } else {
      this.isLoading = false;
    }

    this.initSpeechRecognition();
    if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }

  ngOnDestroy(): void {
    this.cancelarAsistenteVoz();
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cargarDatosNegocio() {
    if (!this.negocioId) return;
    this.http.get<any>(`${this.apiUrl}/negocios/${this.negocioId}`, { headers: this.getAuthHeaders() }).subscribe({
      next: (data) => {
        this.negocioInfo = data;
      },
      error: (err) => console.warn('No se pudo cargar la info del negocio', err)
    });
  }

  cargarIvaDelSistema() {
      this.http.get<any>(`${this.apiUrl}/parametros/iva`, { headers: this.getAuthHeaders() }).subscribe({
          next: (res) => {
              if (res && res.ivaActual) {
                  this.ivaActual = parseFloat(res.ivaActual);
              }
          },
          error: (err) => console.warn("No se pudo cargar el IVA, usando 15%", err)
      });
  }

  cargarTodasLasFacturas(id: number) {
    this.isLoading = true;
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers: this.getAuthHeaders() }).subscribe({
      next: (data) => {
        setTimeout(() => {
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
        }, 0);
      },
      error: () => {
          setTimeout(() => { this.isLoading = false; this.cdr.detectChanges(); }, 0);
      }
    });
  }

  buscarFacturas() {
    if (!this.terminoBusqueda.trim()) {
      this.facturas = [...this.facturasBase];
      return;
    }
    const term = this.terminoBusqueda.toLowerCase().trim();
    this.facturas = this.facturasBase.filter(f => 
      f.numero.toLowerCase().includes(term) || f.cliente.toLowerCase().includes(term)
    );
  }

  abrirModalNuevo(porVoz = false) {
    this.showModal = true;
    this.cdr.detectChanges(); 

    this.cargarCatalogos();
    this.nuevaFactura = { 
        clienteId: null, 
        metodoPago: null,
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
    this.clienteSeleccionadoInfo = { nombreCompleto: 'Consumidor Final', dni: '9999999999999', email: 'N/A' };
    this.terminoBusquedaCliente = 'Consumidor Final';
    this.mostrarDropdownClientes = false;
    this.cdr.detectChanges();
  }

  private limpiarTexto(texto: any): string {
    if (!texto) return '';
    return String(texto)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^a-zA-Z0-9 ]/g, "") 
        .toLowerCase()
        .replace(/\b(de|la|el|los|las|un|una|unos|unas|para|con|y|o)\b/g, '') 
        .replace(/\s+/g, ' ') 
        .trim();
  }

  private buscarClientesUniversales(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    if (!txt) return [...this.clientesList];
    
    let exact = this.clientesList.filter(cli => {
        const nomCompleto = this.limpiarTexto(cli.nombreCompleto || `${cli.primerNombre || ''} ${cli.apellidoPaterno || ''}`);
        return nomCompleto === txt || this.limpiarTexto(cli.dni) === txt || this.limpiarTexto(cli.identificacion) === txt;
    });
    if (exact.length > 0) return exact;

    let partial = this.clientesList.filter(cli => {
        const nom = this.limpiarTexto(cli.nombreCompleto || `${cli.primerNombre || ''} ${cli.apellidoPaterno || ''}`);
        const doc = this.limpiarTexto(cli.dni || cli.identificacion || '');
        return nom.includes(txt) || txt.includes(nom) || (doc && doc.includes(txt));
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
          if (event.results[i].isFinal) final += event.results[i][0].transcript + ' ';
          else interim += event.results[i][0].transcript;
      }

      if (final) this.transcriptAcumulado += final;

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
      }, 3500); 
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
        this.voiceMessage = "Hola, soy Zoe. ¿A quién le facturamos y qué agregamos?";
    } else if (!this.metodoPagoConfirmado) {
        this.voiceMessage = "Cliente listo. ¿Cuál será el método de pago?";
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
        let voices = window.speechSynthesis.getVoices();
        
        let femaleVoice = voices.find(v => 
            v.lang.startsWith('es') && 
            /(sabina|paulina|monica|laura|helena|elena|victoria|mujer|female|Google español)/i.test(v.name)
        );
        
        if (!femaleVoice) {
            femaleVoice = voices.find(v => 
                v.lang.startsWith('es') && 
                !/(pablo|jorge|diego|carlos|david|male|hombre)/i.test(v.name)
            );
        }

        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }

        utterance.lang = 'es-ES'; 
        utterance.rate = 1.03;    
        utterance.pitch = 1.15;   

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
        this.nuevaFactura.metodoPago = null;
        this.metodoPagoConfirmado = false;
        this.hablar("De acuerdo, he vaciado todo el ticket. Empecemos de cero.", () => this.escuchar());
        return;
    }

    if (this.voiceState === VoiceStep.ELEGIR_OPCION && this.opcionesVoz.length > 0) {
        this.manejarDesambiguacion(transcriptLimpio);
        return;
    }

    if (this.voiceState === VoiceStep.CONFIRMAR) {
        const afirmativo = ['si', 'sí', 'dale', 'ok', 'claro', 'confirmo', 'emite', 'emitir', 'ya', 'por supuesto', 'correcto', 'procede'].some(cmd => transcriptLimpio.includes(cmd) || transcriptLimpio === cmd);
        const negativo = ['no', 'espera', 'cancela', 'todavia no', 'aguanta', 'detente', 'pausa', 'todavía no'].some(cmd => transcriptLimpio.includes(cmd));

        if (negativo) {
            this.voiceState = VoiceStep.ESCUCHA_LIBRE;
            this.hablar("Entendido, esperaré. Dime qué modificamos.", () => this.escuchar());
            return;
        } else if (afirmativo) {
            this.voiceState = VoiceStep.OFF;
            this.hablar("¡Perfecto! Emitiendo la factura ahora mismo.", () => {
                 setTimeout(() => { this.guardarFactura(); }, 500);
            });
            return;
        } else {
            this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        }
    }

    this.analizarConGroq(transcriptLimpio);
  }

  private analizarConGroq(fraseUsuario: string) {
    this.isThinking = true;
    this.cdr.detectChanges();

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    const instruccionCliente = (this.nuevaFactura.clienteId || this.esConsumidorFinal)
      ? `"cliente": null,` 
      : `"cliente": "Extrae el nombre del cliente. Si no menciona ningún cliente o persona, devuelve 'NO_MENCIONADO'. Si dice Consumidor Final, devuelve 'CONSUMIDOR_FINAL'",`;

    const listaNombresCli = this.clientesList.map(c => c.nombreCompleto || `${c.primerNombre} ${c.apellidoPaterno}`).join(', ').substring(0, 1000);
    const listaNombresProd = this.productosList.map(p => p.nombre).join(', ').substring(0, 1000);
    const listaBodegas = this.bodegasList.map(b => b.nombre).join(', ');

    const promptSystem = `
      Eres Zoe, la asistente virtual de un sistema de punto de venta. 
      Extrae los datos solicitados en formato JSON estricto basándote en la petición del usuario.
      
      🔥 REGLA VITAL DE PRODUCTOS:
      - TIENES que intentar emparejar lo que el usuario dice con un producto EXACTO de la Lista Referencial de Productos proporcionada abajo.
      - Si el usuario menciona un nombre incompleto, pluralizado o mal escrito, usa el nombre EXACTO de la lista. (Ejemplo: Si dice "zapatos", y en la lista hay "Zapatos Nike", devuelve "Zapatos Nike").
      - NO inventes productos que no estén en la lista. Si definitivamente no se parece a nada de la lista, devuelve el nombre que escuchaste tal cual.
      
      Listas referenciales de tu BD:
      Clientes: [${listaNombresCli}]
      Productos: [${listaNombresProd}]
      Bodegas: [${listaBodegas}]

      Formato EXACTO QUE DEBES RESPONDER:
      {
         ${instruccionCliente}
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | "NO_MENCIONADO",
         "detallesTarjeta": "Ej: Visa terminada en 1234 (o null)",
         "cuotas": numero_entero_o_null,
         "descuentoGlobalPorcentaje": numero_o_null,
         "items": [ { "producto": "Nombre extraído o corregido según la lista", "cantidad": numero_entero_o_null, "descuentoPorcentaje": numero_o_0, "bodega": "Nombre exacto de la bodega o null" } ],
         "eliminarProducto": "Nombre del producto a quitar del carrito (o null)"
      }
      
      REGLAS SECUNDARIAS:
      1. CLIENTE: Si no menciona a nadie, DEBE SER "NO_MENCIONADO". 
      2. PAGO: Si no menciona tarjeta, efectivo o transferencia, DEBE SER "NO_MENCIONADO".
      3. NO devuelvas NADA MÁS que el JSON puro.
    `;

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: promptSystem },
        { role: 'user', content: fraseUsuario }
      ],
      temperature: 0.1, 
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
            this.aplicarDatosExtraidos(datosExtraidos, fraseUsuario);
          } catch (e) {
            console.error("Error parseando JSON:", e);
            this.hablar("Perdón, me enredé un poco. ¿Podrías decirlo de nuevo?", () => this.escuchar());
          }
        },
        error: () => {
          this.isThinking = false;
          this.hablar("Tuve un problema con el internet. ¿Me lo repites?", () => this.escuchar());
        }
      });
  }

  private aplicarDatosExtraidos(datos: any, fraseUsuarioReal: string) {
    let algoAgregado = false;
    let mensajesAlerta: string[] = []; 

    if (datos.eliminarProducto && datos.eliminarProducto !== 'null') {
        const index = this.nuevaFactura.detalles.findIndex((d: any) => 
            this.limpiarTexto(d.productoNombre).includes(this.limpiarTexto(datos.eliminarProducto))
        );
        if (index !== -1) {
            const nombreQuitado = this.nuevaFactura.detalles[index].productoNombre;
            this.eliminarDelCarrito(index);
            this.hablar(`Listo, ya saqué ${nombreQuitado}. ¿Qué más hacemos?`, () => this.escuchar());
            return; 
        }
    }

    if (datos.metodoPago && datos.metodoPago !== 'null' && datos.metodoPago !== 'NULL' && datos.metodoPago !== 'NO_MENCIONADO') {
        this.nuevaFactura.metodoPago = datos.metodoPago;
        this.metodoPagoConfirmado = true;
    }

    if (datos.detallesTarjeta && datos.detallesTarjeta !== 'null') {
        this.nuevaFactura.detallesTarjeta = datos.detallesTarjeta;
        if (this.nuevaFactura.metodoPago !== 'TARJETA_CREDITO') {
            this.nuevaFactura.metodoPago = 'TARJETA_CREDITO';
            this.metodoPagoConfirmado = true;
        }
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
    }

    if (datos.descuentoGlobalPorcentaje !== undefined && datos.descuentoGlobalPorcentaje !== null) {
        const descGlobal = parseFloat(datos.descuentoGlobalPorcentaje);
        if (!isNaN(descGlobal) && descGlobal > 0) {
            this.nuevaFactura.descuentoGlobalPorcentaje = descGlobal;
            algoAgregado = true;
        }
    }

    let pedirCedula = false;
    
    if (datos.cliente && datos.cliente !== 'null' && datos.cliente !== 'NO_MENCIONADO' && !this.nuevaFactura.clienteId && !this.esConsumidorFinal) {
        if (datos.cliente === 'CONSUMIDOR_FINAL' || String(datos.cliente).toLowerCase().includes('consumidor')) {
            this.setConsumidorFinal();
        } else {
            const matchesCli = this.buscarClientesUniversales(datos.cliente);
            if (matchesCli.length === 1) {
                this.seleccionarCliente(matchesCli[0]); 
            } else if (matchesCli.length > 1) {
                pedirCedula = true; 
                const nombresStr = matchesCli.slice(0,3).map(c => c.nombreCompleto || c.primerNombre).join(' y ');
                this.iniciarDesambiguacion('CLIENTE', matchesCli, `Tengo varios clientes similares, como ${nombresStr}. Dime su apellido completo o la cédula.`);
                return;
            } else {
                mensajesAlerta.push(`no encontré a ${datos.cliente} en la base de clientes`);
            }
        }
    }

    if (pedirCedula) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar("Por favor, díctame la cédula de ese cliente para estar segura.", () => this.escuchar());
        return;
    }

    const items = datos.items || [];

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
                    const bodegasStr = bodegasConStock.map(b => b.nombre).join(' y en ');
                    this.iniciarDesambiguacion('BODEGA', bodegasConStock, `Tengo ese producto en ${bodegasStr}. ¿De cuál bodega te gustaría sacarlo? Puedes decirlo o hacer click en la opción.`);
                    return; 
                } else {
                    mensajesAlerta.push(`ya no nos queda stock de ${prod.nombre}`);
                    continue;
                }
            }

            if (bodegaElegidaId) {
                const stockActual = this.obtenerStock(prod.id, bodegaElegidaId);
                
                if (stockActual === null || stockActual <= 0) {
                    mensajesAlerta.push(`ya no nos queda stock de ${prod.nombre}`);
                } else {
                    if (cant > stockActual) {
                        cant = stockActual;
                        mensajesAlerta.push(`solo agregué ${cant} de ${prod.nombre} porque es todo lo que queda en la bodega`);
                    }
                    this.agregarProductoDirecto(prod, cant, bodegaElegidaId, descPct);
                    algoAgregado = true;
                }
            }
        } else if (matchesProd.length > 1) {
            // 🔥 GUARDAMOS ESTADO POR SI EL USUARIO DA CLIC MANUAL
            this.itemTemp.cantidad = Number(item.cantidad) > 0 ? Number(item.cantidad) : 1;
            this.itemTemp.descuentoPorcentaje = Number(item.descuentoPorcentaje) > 0 ? Number(item.descuentoPorcentaje) : 0;

            const prodsStr = matchesProd.slice(0,3).map((p, index) => `Opción ${index + 1}: ${p.nombre}`).join('. ');
            this.iniciarDesambiguacion('PRODUCTO', matchesProd, `Encontré varios similares. Dime el número de la opción o haz clic en pantalla: ${prodsStr}.`);
            return; 
        } else if (matchesProd.length === 0) {
            mensajesAlerta.push(`no encontré ${item.producto} en el inventario`);
        }
    }

    this.cdr.detectChanges();

    const faltaCliente = !this.nuevaFactura.clienteId && !this.esConsumidorFinal;
    const faltaPago = !this.metodoPagoConfirmado;
    const faltaItems = this.nuevaFactura.detalles.length === 0;

    let prefijoAviso = mensajesAlerta.length > 0 ? `Atención, ${mensajesAlerta.join(' y ')}. ` : '';

    const intencionEmitir = ['emite', 'emitir', 'factura ya', 'cobrar ya', 'guarda la factura', 'todo bien', 'listo', 'cobra', 'cobrar', 'termina'].some(cmd => fraseUsuarioReal.includes(cmd));

    if (faltaCliente) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`${prefijoAviso}Aún no tengo al cliente. ¿A quién le facturamos o lo registro como consumidor final?`, () => this.escuchar());
    } 
    else if (faltaItems) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`${prefijoAviso}El carrito está vacío. ¿Qué producto vamos a buscar?`, () => this.escuchar());
    } 
    else if (faltaPago && intencionEmitir) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`${prefijoAviso}Ya tengo todo, pero me falta saber si pagarán en efectivo, transferencia o tarjeta.`, () => this.escuchar());
    }
    else if (intencionEmitir && !faltaCliente && !faltaPago && !faltaItems) {
        this.voiceState = VoiceStep.CONFIRMAR;
        this.hablar(`${prefijoAviso}Revisé todo y estamos listos. El total a cobrar es $${this.totalCarrito.toFixed(2)}. ¿Deseas que confirme la emisión de la factura?`, () => this.escuchar());
    }
    else {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        if (algoAgregado) {
            this.hablar(`${prefijoAviso}Añadido al carrito. ¿Qué más deseas agregar?`, () => this.escuchar());
        } else if (mensajesAlerta.length > 0) {
            this.hablar(`${prefijoAviso}¿Modificamos algo más?`, () => this.escuchar());
        } else {
            // 🔥 EVITA QUE ZOE SE QUEDE CALLADA Y TRABADA SI NO HAY ALERTAS NI PRODUCTOS AÑADIDOS
            this.hablar(`Listo. ¿Qué más hacemos?`, () => this.escuchar());
        }
    }
  }

  private buscarProductos(textoBuscado: string): any[] {
    const txt = this.limpiarTexto(textoBuscado);
    if (!txt) return [];
    
    let exact = this.productosList.filter(p => this.limpiarTexto(p.nombre) === txt);
    if (exact.length > 0) return exact;

    let partial = this.productosList.filter(p => this.limpiarTexto(p.nombre).includes(txt) || txt.includes(this.limpiarTexto(p.nombre)));
    if (partial.length > 0) return partial;

    const palabras = txt.split(' ').filter(p => p.length > 2); 
    if (palabras.length > 0) {
        let flexible = this.productosList.filter(p => {
            const nom = this.limpiarTexto(p.nombre);
            return palabras.every(pal => nom.includes(pal)); 
        });
        if (flexible.length > 0) return flexible;
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

  // 🔥 CLICK MANUAL REFORZADO CONTRA ERRORES
  seleccionarOpcionManual(opcion: any) {
    this.isThinking = true; // Previene que el evento onend del micrófono lo vuelva a activar
    if (this.recognition) {
        try { this.recognition.stop(); } catch(e){}
    }
    this.isListening = false;
    this.hoverIndex = -1; 

    // Damos un respiro mínimo para evitar la carrera del micrófono
    setTimeout(() => {
        this.isThinking = false;
        this.ejecutarSeleccion(opcion, '');
    }, 100);
  }

  private manejarDesambiguacion(transcript: string) {
    const transcriptLimpio = this.limpiarTexto(transcript);
    
    // 🔥 PERMITIR CANCELAR LA ELECCIÓN
    if (['cancelar', 'ninguno', 'ninguna', 'me equivoque', 'salir', 'atras'].some(cmd => transcriptLimpio.includes(cmd))) {
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.opcionesVoz = [];
        this.tipoOpciones = null;
        this.productoPendientePorBodega = null;
        this.hablar("Cancelado. ¿Qué deseas hacer ahora?", () => this.escuchar());
        return;
    }

    let seleccionado = null;

    const num = this.extraerIndice(transcriptLimpio, this.opcionesVoz.length);
    if (num >= 0 && num < this.opcionesVoz.length) {
      seleccionado = this.opcionesVoz[num];
    } else {
      const palabrasUsuario = transcriptLimpio.split(' ').filter(p => p.length > 2);
      let maxScore = 0;

      for (let opt of this.opcionesVoz) {
        let stringDeComparacion = "";
        
        if (this.tipoOpciones === 'CLIENTE') {
            stringDeComparacion = `${opt.nombreCompleto} ${opt.primerNombre} ${opt.razonSocial} ${opt.dni}`;
        } else if (this.tipoOpciones === 'PRODUCTO') {
            stringDeComparacion = `${opt.nombre} ${opt.descripcion || ''}`;
        } else if (this.tipoOpciones === 'BODEGA') {
            stringDeComparacion = `${opt.nombre} ${opt.ubicacion || ''} ${opt.direccion || ''}`;
        }

        const textoACompararLimpio = this.limpiarTexto(stringDeComparacion);
        
        if (textoACompararLimpio.includes(transcriptLimpio) || transcriptLimpio.includes(textoACompararLimpio)) {
          seleccionado = opt;
          break;
        }

        let score = 0;
        for (let pal of palabrasUsuario) {
          if (textoACompararLimpio.includes(pal)) score++;
        }

        if (score > maxScore) {
          maxScore = score;
          seleccionado = opt;
        }
      }
    }

    if (seleccionado) {
        this.ejecutarSeleccion(seleccionado, transcript);
    } else {
      this.hablar("Perdón, no escuché bien. Dime el número de la opción o haz clic en la pantalla.", () => this.escuchar());
    }
  }

  // 🔥 LÓGICA CENTRALIZADA PARA CLIC Y VOZ
  private ejecutarSeleccion(seleccionado: any, transcriptContext: string) {
      if (this.tipoOpciones === 'CLIENTE') {
          this.seleccionarCliente(seleccionado);
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          this.aplicarDatosExtraidos({}, transcriptContext); 
      } 
      else if (this.tipoOpciones === 'PRODUCTO') {
          let prod = seleccionado;
          let cant = this.itemTemp.cantidad || 1;
          let desc = this.itemTemp.descuentoPorcentaje || 0;
          
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          
          this.aplicarDatosExtraidos({
              items: [{ producto: prod.nombre, cantidad: cant, descuentoPorcentaje: desc }]
          }, transcriptContext);
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
              this.hablar(`Entendido, lo sacamos de ${bodega.nombre}. ¿Deseas agregar algo más?`, () => this.escuchar());
          } else {
              this.hablar(`Uy, acabo de revisar y no queda stock en ${bodega.nombre}. ¿Buscamos en otro lado?`, () => this.escuchar());
          }
      }
  }

  // 🔥 DETECCIÓN NÚMERICA MEJORADA IGNORANDO PALABRAS DE RELLENO
  private extraerIndice(texto: string, maxOpciones: number): number {
    const txtLimpio = texto.replace(/\b(la|el|las|los|opcion|opción|numero|número|quiero|dame|selecciona|escoge)\b/g, '').trim();

    const matchDigito = txtLimpio.match(/\d+/);
    if (matchDigito) {
        const idx = parseInt(matchDigito[0], 10) - 1;
        if (idx >= 0 && idx < maxOpciones) return idx;
    }
    
    if (/(primer|uno|1)/.test(txtLimpio)) return 0;
    if (/(segund|dos|2)/.test(txtLimpio)) return 1;
    if (/(tercer|tres|3)/.test(txtLimpio)) return 2;
    if (/(cuart|cuatro|4)/.test(txtLimpio)) return 3;
    if (/(quint|cinco|5)/.test(txtLimpio)) return 4;
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
    if (!this.nuevaFactura.metodoPago) {
        this.nuevaFactura.metodoPago = 'EFECTIVO';
    }

    if ((!this.nuevaFactura.clienteId && !this.esConsumidorFinal) || this.nuevaFactura.detalles.length === 0) {
      Swal.fire('Error', 'Faltan datos para emitir la factura.', 'error');
      return;
    }

    this.isSaving = true;
    Swal.fire({ title: 'Emitiendo Factura...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

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
    
    const nombreNegocio = this.negocioInfo?.nombreComercial || this.negocioInfo?.razonSocial || 'Mi Negocio S.A.';
    const rucNegocio = this.negocioInfo?.ruc || '0000000000000';
    const direccionNegocio = this.negocioInfo?.direccion || 'Dirección no registrada';
    const emailNegocio = this.negocioInfo?.email || this.negocioInfo?.correo || 'Sin correo registrado';
    const logoUrl = this.negocioInfo?.logo || `${baseUrl}/images/Dilo-Logo-2-.png`;

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
                          <img src="${logoUrl}" alt="Logo Negocio">
                      </div>
                      <div class="company-details">
                          <strong>${nombreNegocio}</strong><br>
                          RUC: ${rucNegocio}<br>
                          ${direccionNegocio}<br>
                          ${emailNegocio}
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