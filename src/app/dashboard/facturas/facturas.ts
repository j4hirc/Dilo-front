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

  nuevaFactura = {
    clienteId: null,
    metodoPago: 'EFECTIVO',
    numeroCuotas: 0,
    detalles: [] as any[]
  };

  itemTemp: any = {
    productoId: null,
    bodegaId: null,
    cantidad: null,
    productoNombre: '' 
  };

  // 🔥 VARIABLES DE ZOE (VOZ)
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

  get totalCarrito(): number {
    return this.nuevaFactura.detalles.reduce((sum: number, item: any) => sum + (item.subtotal || 0), 0);
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
    this.itemTemp = { productoId: null, bodegaId: null, cantidad: null, productoNombre: '' };
    this.terminoBusquedaCliente = '';
    this.clienteSeleccionadoInfo = null;
    this.mostrarDropdownClientes = false;
    this.esConsumidorFinal = false;
    
    this.opcionesVoz = [];
    this.tipoOpciones = null;
    this.metodoPagoConfirmado = false;
    this.quiereEmitirPendiente = false;

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

  // =======================================================
  // 🔥 LÓGICA DE ZOE Y NLP CON ESCUCHA CONTINUA
  // =======================================================

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
    this.transcriptAcumulado = '';
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
        
        // 🔥 VOZ MUY RÁPIDA, DINÁMICA Y HUMANA
        utterance.rate = 1.35; 
        utterance.pitch = 1.2; 
        
        let voices = window.speechSynthesis.getVoices();
        let femaleVoice = voices.find(v => v.lang.startsWith('es') && /(sabina|paulina|helena|monica|victoria|lucia|sofia|laura|isabel|carmen|female|mujer|google español)/i.test(v.name));
        
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

    // 🔥 COMANDOS DIRECTOS DE LIMPIEZA MASIVA
    const comandosLimpiar = ['borra todo', 'borrar todo', 'limpiar carrito', 'reiniciar', 'vaciar ticket', 'cancela todo'];
    if (comandosLimpiar.some(cmd => transcriptLimpio.includes(cmd))) {
        this.nuevaFactura.detalles = [];
        this.limpiarClienteSeleccionado();
        this.hablar("He vaciado el ticket por completo. Empecemos de cero.", () => this.escuchar());
        return;
    }

    const comandosEmitir = ['emite', 'emitir', 'factura ya', 'cobrar ya', 'guarda la factura', 'guardar factura', 'todo bien', 'listo', 'cobra', 'cobrar'];
    const quiereEmitir = comandosEmitir.some(cmd => transcriptLimpio.includes(cmd));

    // Confirmación ultrarrápida si ya está en el último paso
    if (this.voiceState === VoiceStep.CONFIRMAR && (quiereEmitir || transcriptLimpio.includes('si') || transcriptLimpio.includes('sí') || transcriptLimpio.includes('ok') || transcriptLimpio.includes('dale'))) {
        this.voiceState = VoiceStep.OFF;
        this.hablar("¡Listo! Emitiendo comprobante de inmediato.");
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
      : `"cliente": "Extrae el nombre, cédula, o pon 'CONSUMIDOR_FINAL' si pide consumidor final o sin datos",`;

    const listaNombresCli = this.clientesList.map(c => c.nombreCompleto || c.primerNombre).join(', ').substring(0, 600);
    const listaNombresProd = this.productosList.map(p => p.nombre).join(', ').substring(0, 600);

    // 🔥 PROMPT CON SOPORTE PARA BORRAR ITEMS ESPECÍFICOS Y ENTENDER CÉDULAS
    const promptSystem = `
      Eres la IA veloz de un sistema POS. El usuario habla de forma natural.
      Extrae los datos en un JSON puro.
      
      Listas de BD:
      Clientes: [${listaNombresCli}]
      Productos: [${listaNombresProd}]

      Formato EXACTO:
      {
         ${instruccionCliente}
         "metodoPago": "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_CREDITO" | null,
         "cuotas": numero_entero_o_null,
         "items": [ { "producto": "Nombre extraido", "cantidad": numero_entero_o_null } ],
         "eliminarProducto": "Nombre del producto a quitar del carrito (o null)",
         "emitirFactura": true o false
      }
      
      REGLAS:
      1. Si dice "Consumidor final" o "sin datos", cliente es "CONSUMIDOR_FINAL".
      2. Si te dictan números para buscar cliente, ponlo en 'cliente' porque es su cédula.
      3. "emitirFactura": true SIEMPRE que insinúe terminar (emite, cobra, guarda, listo, ya está, ok).
      4. Si el usuario dice "borra", "quita" o "elimina" un producto, pon el nombre en "eliminarProducto".
      5. CUOTAS: Si menciona "tarjeta" o "crédito" es TARJETA_CREDITO. Si dice "meses" o "cuotas" extrae el número a "cuotas".
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

  // 🔥 APLICACIÓN DE DATOS (NO MÁS OPCIONES CON NÚMEROS)
  private aplicarDatosExtraidos(datos: any, quiereEmitir: boolean = false) {
    let algoAgregado = false;
    let mensajesAlerta: string[] = []; 

    // 🔥 0. Eliminar un producto específico si el usuario lo pidió
    if (datos.eliminarProducto && datos.eliminarProducto !== 'null') {
        const index = this.nuevaFactura.detalles.findIndex(d => 
            d.productoNombre.toLowerCase().includes(datos.eliminarProducto.toLowerCase())
        );
        if (index !== -1) {
            const nombreQuitado = this.nuevaFactura.detalles[index].productoNombre;
            this.eliminarDelCarrito(index);
            this.hablar(`Listo, acabo de quitar ${nombreQuitado} del ticket. ¿Qué más hacemos?`, () => this.escuchar());
            return; // Cortamos el flujo aquí para no saturar
        }
    }

    // 1. Pagos y Cuotas
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

    // 2. Cliente (Búsqueda inteligente con advertencia humana si hay clones)
    let pedirCedula = false;
    if (datos.cliente && datos.cliente !== 'null' && !this.nuevaFactura.clienteId && !this.esConsumidorFinal) {
        if (datos.cliente === 'CONSUMIDOR_FINAL' || String(datos.cliente).toLowerCase().includes('consumidor')) {
            this.setConsumidorFinal();
        } else {
            const matchesCli = this.buscarClientesUniversales(datos.cliente);
            if (matchesCli.length === 1) {
                this.seleccionarCliente(matchesCli[0]); 
            } else if (matchesCli.length > 1) {
                pedirCedula = true; // 🔥 Si hay 50 Juan Pérez, mejor pide la cédula y no jode con opciones
            } else {
                mensajesAlerta.push(`no encontré a ${datos.cliente}`);
            }
        }
    }

    // Si detectamos clones de clientes, le pedimos la cédula directamente.
    if (pedirCedula) {
        this.quiereEmitirPendiente = quiereEmitir;
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar("Hay varios clientes con ese nombre. Por favor, díctame su número de cédula para estar seguros.", () => this.escuchar());
        return;
    }

    // 3. Productos y Stock 
    const items = datos.items || [];
    let bodegaDefaultId = this.bodegasList.length > 0 ? this.bodegasList[0].id : null;
    let pedirAclaracionProd = null;

    for (let item of items) {
        if (!item.producto || item.producto === 'null') continue;
        
        const matchesProd = this.buscarProductos(item.producto);
        if (matchesProd.length === 1) {
            let prod = matchesProd[0]; 
            let cant = Number(item.cantidad);
            if (isNaN(cant) || cant <= 0) cant = 1;

            if (bodegaDefaultId) {
                const stockActual = this.obtenerStock(prod.id, bodegaDefaultId);
                
                if (stockActual === null || stockActual <= 0) {
                    mensajesAlerta.push(`no hay stock de ${prod.nombre}`);
                } else {
                    if (cant > stockActual) {
                        cant = stockActual;
                        mensajesAlerta.push(`solo metí ${cant} de ${prod.nombre} porque no hay más`);
                    }
                    this.agregarProductoDirecto(prod, cant, bodegaDefaultId);
                    algoAgregado = true;
                }
            }
        } else if (matchesProd.length > 1) {
            pedirAclaracionProd = item.producto; // 🔥 Si hay "Coca 1L" y "Coca 2L", le pedirá que sea específico
        } else if (matchesProd.length === 0) {
            mensajesAlerta.push(`no tengo ${item.producto} en el catálogo`);
        }
    }

    this.cdr.detectChanges();

    if (pedirAclaracionProd) {
        this.quiereEmitirPendiente = quiereEmitir;
        this.voiceState = VoiceStep.ESCUCHA_LIBRE;
        this.hablar(`Tengo varios productos que coinciden con ${pedirAclaracionProd}. ¿Puedes ser un poco más específico?`, () => this.escuchar());
        return;
    }

    const faltaCliente = !this.nuevaFactura.clienteId && !this.esConsumidorFinal;
    const faltaItems = this.nuevaFactura.detalles.length === 0;

    let prefijoAviso = mensajesAlerta.length > 0 ? `A ver, ${mensajesAlerta.join(', y ')}. ` : '';

    // 🔥 FAST-FORWARD SUPREMO
    if ((quiereEmitir || this.quiereEmitirPendiente) && !faltaCliente && !faltaItems) {
        this.quiereEmitirPendiente = false;
        this.voiceState = VoiceStep.OFF;
        this.hablar(`${prefijoAviso}¡Todo listo! Emitiendo factura.`);
        setTimeout(() => { this.guardarFactura(); }, 1200);
        return;
    }

    this.quiereEmitirPendiente = false;
    this.voiceState = VoiceStep.ESCUCHA_LIBRE;

    // 4. DIÁLOGOS DE FLUJO NATURALES
    if (faltaCliente) {
        this.hablar(`${prefijoAviso}Para cobrar necesito el cliente. ¿A quién le facturamos?`, () => this.escuchar());
    } 
    else if (faltaItems) {
        this.hablar(`${prefijoAviso}El ticket está vacío. ¿Qué le agregamos?`, () => this.escuchar());
    } 
    else {
        this.voiceState = VoiceStep.CONFIRMAR;
        let msj = algoAgregado
            ? `${prefijoAviso}Total a pagar $${this.totalCarrito.toFixed(2)}. ¿Emitimos?`
            : `${prefijoAviso}Todo listo. Son $${this.totalCarrito.toFixed(2)}. ¿Deseas emitir ya?`;
        this.hablar(msj, () => this.escuchar());
    }
  }

  // Búsqueda ultra agresiva para que no falle jamás
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

  private iniciarDesambiguacion(tipo: 'CLIENTE' | 'PRODUCTO', opciones: any[], mensaje: string) {
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
    } else {
      this.hablar("Oye, no capté la opción. ¿Qué número es?", () => this.escuchar());
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
    
    let cant = Math.abs(this.itemTemp.cantidad);
    const stockActual = this.obtenerStock(prodSelect.id, this.itemTemp.bodegaId);
    if (stockActual !== null && cant > stockActual) {
        cant = stockActual;
        Swal.fire('Stock Limitado', `Solo quedan ${stockActual} unidades disponibles.`, 'info');
    }
    
    if (cant > 0) {
        this.agregarProductoDirecto(prodSelect, cant, this.itemTemp.bodegaId);
    }
    this.itemTemp = { productoId: null, bodegaId: this.itemTemp.bodegaId, cantidad: null, productoNombre: '' }; 
  }

  private agregarProductoDirecto(producto: any, cantidad: number, bodegaId: any) {
    if (!producto || !bodegaId || cantidad <= 0) return;

    let precio = Number(producto.costoPromedioActual || 0);
    if (precio <= 0) precio = Number(producto.precioUnitario || 0);

    const bodSelect = this.bodegasList.find(b => b.id === bodegaId);
    const bodegaNombre = bodSelect ? bodSelect.nombre : 'Principal';
    
    this.nuevaFactura.detalles.push({
      productoId: producto.id,
      bodegaId: bodegaId,
      bodegaNombre: bodegaNombre,
      cantidad: cantidad,
      productoNombre: producto.nombre,
      precioUnitario: precio,
      subtotal: precio * cantidad
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
            cliente: res.clienteNombre || (this.esConsumidorFinal ? 'Consumidor Final' : 'Cliente'),
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
    
    const porcentajeIvaMostrar = (this.ivaActual * 100).toFixed(0);

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