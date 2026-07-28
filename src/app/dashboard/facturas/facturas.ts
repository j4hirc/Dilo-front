import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import Swal from 'sweetalert2';

// 🔥 ESTADOS AMPLIADOS DEL ASISTENTE DE VOZ
enum VoiceStep {
  OFF = 'OFF',
  INICIANDO = 'INICIANDO', 
  CLIENTE = 'CLIENTE',
  ELEGIR_CLIENTE = 'ELEGIR_CLIENTE',
  BODEGA = 'BODEGA',
  ELEGIR_BODEGA = 'ELEGIR_BODEGA',
  PRODUCTO = 'PRODUCTO',
  ELEGIR_PRODUCTO = 'ELEGIR_PRODUCTO',
  CANTIDAD = 'CANTIDAD',
  OTRO_PRODUCTO = 'OTRO_PRODUCTO',
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
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

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
  // 🔥 VARIABLES DEL ASISTENTE DE VOZ (ZOE)
  // =========================================
  voiceState: VoiceStep = VoiceStep.OFF;
  voiceMessage: string = ''; 
  userTranscript: string = ''; 
  isListening: boolean = false;
  private recognition: any;
  
  // Opciones temporales para que el usuario elija
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
    window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
    };
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
      error: (err) => {
        this.isLoading = false;
        if (err.status === 401) {
            Swal.fire({ icon: 'warning', title: 'Sesión expirada', text: 'Tu token caducó. Cierra sesión y vuelve a entrar.' });
        }
      }
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
      this.voiceState = VoiceStep.INICIANDO;
      this.voiceMessage = 'Conectando con Zoe...';
      
      window.speechSynthesis.resume();
      window.speechSynthesis.cancel();
      this.cdr.detectChanges();
      
      setTimeout(() => this.iniciarFacturaPorVoz(), 600);
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
    
    const reqClientes = this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/clientes`, { headers }).pipe(catchError(() => of([])));
    const reqProductos = this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/productos`, { headers }).pipe(catchError(() => of([])));
    const reqBodegas = this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, { headers }).pipe(catchError(() => of([])));
    const reqInventario = this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/inventario`, { headers }).pipe(catchError(() => of([])));

    forkJoin([reqClientes, reqProductos, reqBodegas, reqInventario]).subscribe(([clientes, productos, bodegas, inventario]) => {
      this.clientesList = Array.isArray(clientes) ? clientes : [];
      this.clientesFiltrados = [...this.clientesList];
      this.productosList = Array.isArray(productos) ? productos : [];
      this.bodegasList = Array.isArray(bodegas) ? bodegas : [];
      this.inventarioList = Array.isArray(inventario) ? inventario : [];
      this.cdr.detectChanges();
    });
  }

  // =======================================================
  // 🔥 LÓGICA DE ZOE (ASISTENTE DE VOZ BLINDADO)
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

      if (event.error === 'no-speech') {
        this.hablar("Mmm... sigo aquí. ¿Me decías algo?", () => this.escuchar());
      } else if (event.error === 'not-allowed') {
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
      Swal.fire('Navegador no soportado', 'Por favor usa Google Chrome.', 'info');
      this.cancelarAsistenteVoz();
      return;
    }
    
    this.voiceState = VoiceStep.CLIENTE;
    this.hablar("¡Hola! Soy Zoe. ¿A qué cliente le vamos a facturar?", () => this.escuchar());
  }

  cancelarAsistenteVoz() {
    this.voiceState = VoiceStep.OFF;
    this.opcionesVoz = [];
    this.tipoOpciones = null;
    this.isListening = false;
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
        utterance.rate = 1.0; 
        utterance.pitch = 1.3; 

        let voices = window.speechSynthesis.getVoices();
        let spanishVoices = voices.filter(v => v.lang.startsWith('es'));
        
        let femaleVoice = spanishVoices.find(v => 
            /sabina|helena|laura|monica|paulina|mia|lucia|victoria/i.test(v.name)
        ) || spanishVoices.find(v => v.name.includes('Google') && v.name.includes('español')) || spanishVoices[0];

        if (femaleVoice) {
            utterance.voice = femaleVoice;
        }

        utterance.onend = () => {
          setTimeout(() => {
              if (callback && this.voiceState !== VoiceStep.OFF && this.voiceState !== VoiceStep.INICIANDO) {
                callback();
              }
          }, 350); 
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
    try {
      this.recognition.start();
    } catch (e) {
      // Ignorar
    }
  }

  // 🔥 UTILIDAD PARA EXTRAER LA OPCIÓN (ej: "uno", "el primero")
  private extraerIndice(texto: string, maxOpciones: number): number {
    const num = this.textoANumero(texto);
    if (num > 0 && num <= maxOpciones) {
      return num - 1; // Índices empiezan en 0
    }
    if (texto.includes('primer') || texto.includes('1')) return 0;
    if (texto.includes('segund') || texto.includes('2')) return 1;
    if (texto.includes('tercer') || texto.includes('3')) return 2;
    if (texto.includes('cuart') || texto.includes('4')) return 3;
    if (texto.includes('quint') || texto.includes('5')) return 4;
    return -1;
  }

  private procesarComandoVoz(transcript: string) {
    const headers = this.getAuthHeaders();

    switch (this.voiceState) {
      
      // ===========================
      // CLIENTE
      // ===========================
      case VoiceStep.CLIENTE:
        this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/clientes/buscar-voz?q=${transcript}`, { headers })
          .subscribe({
            next: (res) => {
              if (res.length === 1) {
                this.seleccionarCliente(res[0]);
                this.pasoABodega();
              } else if (res.length > 1) {
                // 🔥 SI HAY VARIOS: Mostramos lista
                this.opcionesVoz = res.slice(0, 5); // Máximo 5 para no saturar
                this.tipoOpciones = 'CLIENTE';
                this.voiceState = VoiceStep.ELEGIR_CLIENTE;
                this.hablar(`Encontré a estas personas. ¿Cuál número eliges?`, () => this.escuchar());
              } else {
                this.hablar("¡Ay, lo siento! No logré encontrar a ese cliente. ¿Podrías repetirme su nombre?", () => this.escuchar());
              }
            },
            error: () => this.hablar("Tuve un problema de red al buscar el cliente. ¿Me lo repites?", () => this.escuchar())
          });
        break;

      case VoiceStep.ELEGIR_CLIENTE:
        const indexCli = this.extraerIndice(transcript, this.opcionesVoz.length);
        if (indexCli !== -1) {
          const cliSelec = this.opcionesVoz[indexCli];
          this.seleccionarCliente(cliSelec);
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          this.pasoABodega();
        } else {
          this.hablar("Perdona, no entendí cuál opción. Dime el número, por ejemplo, uno o dos.", () => this.escuchar());
        }
        break;

      // ===========================
      // BODEGA
      // ===========================
      case VoiceStep.BODEGA:
        const bodegasEncontradas = this.bodegasList.filter(b => 
          b.nombre.toLowerCase().includes(transcript) || transcript.includes(b.nombre.toLowerCase())
        );

        if (bodegasEncontradas.length === 1) {
          this.itemTemp.bodegaId = bodegasEncontradas[0].id;
          this.voiceState = VoiceStep.PRODUCTO;
          this.hablar(`¡Excelente! Bodega ${bodegasEncontradas[0].nombre} lista. ¿Qué producto te gustaría agregar?`, () => this.escuchar());
        } else if (bodegasEncontradas.length > 1) {
          this.opcionesVoz = bodegasEncontradas.slice(0, 5);
          this.tipoOpciones = 'BODEGA';
          this.voiceState = VoiceStep.ELEGIR_BODEGA;
          this.hablar("Encontré varias bodegas parecidas. ¿Me dices el número de la correcta?", () => this.escuchar());
        } else {
          if (this.bodegasList.length === 1) {
             this.itemTemp.bodegaId = this.bodegasList[0].id;
             this.voiceState = VoiceStep.PRODUCTO;
             this.hablar(`Usaremos tu bodega principal. Dime, ¿qué producto buscamos?`, () => this.escuchar());
          } else {
             this.hablar("¡Ups! No encontré esa bodega. ¿Me repites el nombre, porfa?", () => this.escuchar());
          }
        }
        break;

      case VoiceStep.ELEGIR_BODEGA:
        const indexBod = this.extraerIndice(transcript, this.opcionesVoz.length);
        if (indexBod !== -1) {
          const bodSelec = this.opcionesVoz[indexBod];
          this.itemTemp.bodegaId = bodSelec.id;
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          this.voiceState = VoiceStep.PRODUCTO;
          this.hablar(`Lista la bodega ${bodSelec.nombre}. ¿Qué producto buscamos?`, () => this.escuchar());
        } else {
          this.hablar("No capté la opción. Dime el número exacto, por favor.", () => this.escuchar());
        }
        break;

      // ===========================
      // PRODUCTO
      // ===========================
      case VoiceStep.PRODUCTO:
        this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/productos/buscar-voz?q=${transcript}`, { headers })
          .subscribe({
            next: (res) => {
              if (res.length === 1) {
                this.itemTemp.productoId = res[0].id;
                this.voiceState = VoiceStep.CANTIDAD;
                this.hablar(`¡Lo tengo! Es ${res[0].nombre}. ¿Cuántas unidades vas a facturar?`, () => this.escuchar());
              } else if (res.length > 1) {
                this.opcionesVoz = res.slice(0, 5);
                this.tipoOpciones = 'PRODUCTO';
                this.voiceState = VoiceStep.ELEGIR_PRODUCTO;
                this.hablar(`Tengo estas opciones en pantalla. ¿Cuál número deseas?`, () => this.escuchar());
              } else {
                this.hablar("No logré encontrar ese producto en tu catálogo. ¿Buscamos otro?", () => this.escuchar());
              }
            },
            error: () => this.hablar("Tuve un fallo de conexión. ¿Me repites el producto?", () => this.escuchar())
          });
        break;

      case VoiceStep.ELEGIR_PRODUCTO:
        const indexProd = this.extraerIndice(transcript, this.opcionesVoz.length);
        if (indexProd !== -1) {
          const prodSelec = this.opcionesVoz[indexProd];
          this.itemTemp.productoId = prodSelec.id;
          this.opcionesVoz = [];
          this.tipoOpciones = null;
          this.voiceState = VoiceStep.CANTIDAD;
          this.hablar(`Elegiste ${prodSelec.nombre}. ¿Cuántas unidades quieres?`, () => this.escuchar());
        } else {
          this.hablar("Mmm... no te entendí. ¿Qué número de la lista quieres?", () => this.escuchar());
        }
        break;

      // ===========================
      // CANTIDAD Y CONFIRMAR
      // ===========================
      case VoiceStep.CANTIDAD:
        const cantidadNumerica = this.textoANumero(transcript);
        if (cantidadNumerica > 0) {
          this.itemTemp.cantidad = cantidadNumerica;
          this.agregarAlCarrito(); 
          
          this.voiceState = VoiceStep.OTRO_PRODUCTO;
          this.hablar(`¡Anotado! Llevamos ${cantidadNumerica}. ¿Te gustaría añadir algo más a la factura? Dime sí o no.`, () => this.escuchar());
        } else {
          this.hablar("Perdona, no capté la cantidad. ¿Me podrías decir un número exacto, como uno o cinco?", () => this.escuchar());
        }
        break;

      case VoiceStep.OTRO_PRODUCTO:
        if (transcript.includes('si') || transcript.includes('sí') || transcript.includes('claro') || transcript.includes('mas')) {
          this.voiceState = VoiceStep.PRODUCTO;
          this.hablar("¡Con gusto! Dime, ¿qué otro producto buscamos?", () => this.escuchar());
        } else {
          this.voiceState = VoiceStep.CONFIRMAR;
          this.hablar(`¡Perfecto! El total de esta venta es de ${this.totalCarrito.toFixed(2)} dólares. ¿Deseas que emita la factura en este momento?`, () => this.escuchar());
        }
        break;

      case VoiceStep.CONFIRMAR:
        if (transcript.includes('si') || transcript.includes('sí') || transcript.includes('emite') || transcript.includes('dale')) {
          this.voiceState = VoiceStep.OFF;
          this.hablar("¡Manos a la obra! Generando tu factura. ¡Mucho éxito en tus ventas!");
          this.guardarFactura();
        } else {
          this.voiceState = VoiceStep.OFF;
          this.hablar("¡No hay problema! Te dejo la factura en pantalla para que la revises con calma.");
        }
        break;
    }
  }

  // Utilidad centralizada para pasar de Cliente -> Bodega
  private pasoABodega() {
    this.voiceState = VoiceStep.BODEGA;
    
    // Si solo hay una bodega en el negocio, evitamos preguntarle al usuario (Optimización UX)
    if (this.bodegasList.length === 1) {
        this.itemTemp.bodegaId = this.bodegasList[0].id;
        this.voiceState = VoiceStep.PRODUCTO;
        this.hablar(`¡Súper! Seleccioné al cliente. Usaremos tu bodega principal. Dime, ¿qué producto buscamos?`, () => this.escuchar());
    } else {
        this.hablar(`¡Súper! Seleccioné al cliente. Ahora dime, ¿De qué bodega sacamos los productos?`, () => this.escuchar());
    }
  }

  private textoANumero(texto: string): number {
    const diccionario: { [key: string]: number } = {
      'un': 1, 'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 
      'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
      'once': 11, 'doce': 12, 'docena': 12, 'quince': 15, 'veinte': 20, 'cincuenta': 50, 'cien': 100
    };
    const matchDigito = texto.match(/\d+/);
    if (matchDigito) return parseInt(matchDigito[0], 10);

    for (const palabra of texto.split(' ')) {
      if (diccionario[palabra]) return diccionario[palabra];
    }
    return 0;
  }

  // =======================================================
  // 🔥 MÉTODOS DEL COMPONENTE (FACTURA NORMAL)
  // =======================================================

  filtrarClientes() {
    if (!this.terminoBusquedaCliente.trim()) {
      this.clientesFiltrados = [...this.clientesList];
    } else {
      const termino = this.terminoBusquedaCliente.toLowerCase();
      this.clientesFiltrados = this.clientesList.filter(cli => 
        (cli.nombreCompleto?.toLowerCase().includes(termino)) ||
        (cli.razonSocial?.toLowerCase().includes(termino)) ||
        (cli.primerNombre?.toLowerCase().includes(termino)) ||
        (cli.identificacion?.toLowerCase().includes(termino)) ||
        (cli.ruc?.toLowerCase().includes(termino))
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
    setTimeout(() => {
        const input = document.getElementById('buscadorCliente');
        if (input) input.focus();
    }, 50);
  }

  agregarAlCarrito() {
    if (!this.itemTemp.productoId || !this.itemTemp.bodegaId || this.itemTemp.cantidad <= 0) {
      if(this.voiceState !== VoiceStep.OFF) this.hablar("¡Ojo! Faltan datos para agregar este producto.");
      else Swal.fire('Campos incompletos', 'Selecciona producto, bodega y cantidad válida.', 'warning');
      return;
    }

    const stockActual = this.stockDisponible;
    if (stockActual !== null && this.itemTemp.cantidad > stockActual) {
      if(this.voiceState !== VoiceStep.OFF) this.hablar(`Solo nos quedan ${stockActual} unidades en stock.`);
      else Swal.fire({ icon: 'error', title: 'Stock Insuficiente', text: `Solo tienes ${stockActual} unidades.` });
      return;
    }

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

    this.itemTemp = { productoId: null, bodegaId: null, cantidad: 1, productoNombre: '' };
    this.cdr.detectChanges();
  }

  eliminarDelCarrito(index: number) {
    this.nuevaFactura.detalles.splice(index, 1);
  }

  guardarFactura() {
    if (!this.nuevaFactura.clienteId) {
      if(this.voiceState !== VoiceStep.OFF) this.hablar("Olvidaste seleccionar a tu cliente primero.");
      else Swal.fire('Error', 'Debes seleccionar un cliente.', 'error');
      return;
    }
    if (this.nuevaFactura.detalles.length === 0) {
      if(this.voiceState !== VoiceStep.OFF) this.hablar("Aún no has agregado ningún producto.");
      else Swal.fire('Error', 'Agrega al menos un producto a la factura.', 'error');
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
            cliente: res.clienteNombre || res.cliente?.nombre || res.cliente?.razonSocial || 'Consumidor Final',
            fecha: res.fechaEmision ? new Date(res.fechaEmision).toLocaleDateString() : new Date().toLocaleDateString(),
            monto: Number(res.totalFactura || res.total || 0),
            tipo: res.formaPago || 'Manual',
            detalles: res.detallesFactura || res.detalles || res.items || [] 
          };

          Swal.fire({
            icon: 'success',
            title: '¡Factura Emitida!',
            text: 'Registrada en sistema. Abriendo comprobante...',
            timer: 1500,
            showConfirmButton: false
          }).then(() => this.imprimirFacturaPDF(facturaParaPDF));
        },
        error: (err) => {
          this.isSaving = false;
          Swal.fire('Error', err.error?.message || 'Hubo un problema al emitir la factura.', 'error');
        }
      });
  }

  descargarPDF(fac: any) {
    Swal.fire({ title: 'Generando Factura...', text: 'Preparando el diseño.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    setTimeout(() => { Swal.close(); this.imprimirFacturaPDF(fac); }, 800);
  }

  imprimirFacturaPDF(fac: any) {
    const total = fac.monto;
    const subtotal = total / 1.15;
    const iva = total - subtotal;
    let filasProductos = '';
    
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
    
    const baseUrl = window.location.origin; 
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
                  <tbody>${filasProductos}</tbody>
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
    setTimeout(() => { ventana?.print(); ventana?.close(); }, 800);
  }

  ocultarDropdown() {
    setTimeout(() => this.mostrarDropdownClientes = false, 200);
  }
}