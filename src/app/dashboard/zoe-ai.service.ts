import { Injectable, NgZone, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

export interface ModuloNavegable {
  nombre: string;
  ruta: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  safeHtml?: SafeHtml;
}

@Injectable({
  providedIn: 'root'
})
export class ZoeAiService {
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private zone = inject(NgZone); 
  private router = inject(Router);

  private groqApiKey = environment.groqApiKey;

  isChatOpen = false;
  isChatLoading = false;
  isListening = false;
  
  chatMensajes: ChatMessage[] = [];
  
  private contextoGlobal = '';
  private promptSistemaBase = '';

  private modulosNavegables: ModuloNavegable[] = [];
  private readonly REGEX_NAVEGACION = /\[\[NAVEGAR:\s*(\/[a-zA-Z0-9\-\/]*)\s*\]\]/;

  // Control de Voz
  private recognition: any;
  private silenceTimer: any;
  private transcriptAcumulado = '';
  keepListeningActive = false; 

  /** Voz femenina en español cacheada (se carga de forma asíncrona en Chrome) */
  private vozFemenina: SpeechSynthesisVoice | null = null;

  constructor() {
    this.initSpeechRecognition();
    this.cargarVocesFemeninas();
  }

  /** Precarga y elige la mejor voz femenina en español disponible en el navegador */
  private cargarVocesFemeninas() {
    const elegir = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      this.vozFemenina = this.seleccionarVozFemenina(voices);
    };
    elegir();
    // Chrome carga las voces de forma asíncrona
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => elegir();
    }
  }

  /**
   * Ranking de voces femeninas en español (nombres comunes por SO/navegador).
   * Prioriza: Google español (US/ES), Sabina, Paulina, Mónica, Lucía, María, etc.
   */
  private seleccionarVozFemenina(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const es = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('es'));
    if (!es.length) return null;

    const preferidas = [
      /google español.*estados unidos/i,
      /google us spanish/i,
      /google español/i,
      /microsoft sabina/i,
      /sabina/i,
      /microsoft paulina/i,
      /paulina/i,
      /microsoft monica/i,
      /m[oó]nica/i,
      /luc[ií]a/i,
      /mar[ií]a/i,
      /elena/i,
      /conchita/i,
      /dalia/i,
      /soledad/i,
      /paloma/i,
      /female/i,
      /mujer/i,
    ];

    const masculinas = /pablo|jorge|diego|carlos|juan|pedro|antonio|male|hombre|david|jorge/i;

    for (const re of preferidas) {
      const found = es.find(v => re.test(v.name) && !masculinas.test(v.name));
      if (found) return found;
    }

    // Cualquier voz es-* que no suene masculina
    const noMale = es.find(v => !masculinas.test(v.name));
    if (noMale) return noMale;

    // Preferir es-ES o es-MX / es-US si hay varias
    const porLang = es.find(v => /es-(ES|MX|US|AR|CO|CL|PE)/i.test(v.lang)) || es[0];
    return porLang;
  }

  inicializarChat(nombreUsuario: string, rol: string) {
    if (this.chatMensajes.length === 0) {
      const textoBienvenida = `¡Hola! Soy **Zoe**, tu asistente en **Dilo**.\n\nPuedo ayudarte con:\n- Stock y bodegas (qué hay, qué falta, stock mínimo)\n- Productos, clientes, proveedores, facturas\n- Cómo usar cada módulo\n- Llevarte directo a cualquier pantalla\n\nDime por texto o por voz. Ejemplos: *"¿Qué productos faltan en bodega?"*, *"Llévame a Inventario"*, *"¿Por dónde empiezo?"*.\n\n¿En qué te ayudo, ${nombreUsuario}?`;
      this.chatMensajes.push({
        role: 'assistant',
        text: textoBienvenida,
        safeHtml: this.formatearMensaje(textoBienvenida)
      });
    }
  }

  actualizarContexto(
    contextoTexto: string,
    modulosPermitidos: string,
    modulosRestringidos: string,
    roles: string,
    nombreUsuario: string,
    rolUsuario: string,
    negocioNombre: string,
    alertasTexto: string,
    modulosNavegables: ModuloNavegable[] = [],
    modulosEnConstruccion: string = 'Ninguno por el momento'
  ) {
    this.contextoGlobal = contextoTexto;
    this.modulosNavegables = modulosNavegables;

    const listaRutasParaComando = modulosNavegables.map(m => m.ruta).join(', ');
    const listaNombresModulos = modulosNavegables.map(m => m.nombre).join(', ');

    this.promptSistemaBase = `Eres "Zoe", asistente virtual oficial del sistema **Dilo** (software de gestión para negocios en Ecuador).
Hablas con **${nombreUsuario}** (rol: **${rolUsuario}**) del negocio **"${negocioNombre}"**.

══════════════════════════════════════
CONOCIMIENTO DEL SISTEMA DILO (OBLIGATORIO)
══════════════════════════════════════
Dilo gestiona inventario multi-bodega, ventas, compras, clientes, proveedores y equipo.

ROLES:
- PROPIETARIO: acceso total.
- VENDEDOR: facturas, clientes, cuentas por cobrar, reportes. NO inventario/bodegas/compras.
- BODEGUERO: productos, categorías, bodegas, inventario, kardex, compras/abastecimiento. NO facturación.

MÓDULOS Y PARA QUÉ SIRVEN:
- Dashboard / Propietario: resumen del negocio.
- Facturas: registrar ventas, cobrar, emitir comprobantes. IVA 15% fijo.
- Cuentas por Cobrar: saldos pendientes de clientes a crédito.
- Abastecimiento (Compras): registrar compras a proveedores (entra stock a bodegas).
- Clientes / Proveedores: directorios.
- Productos: catálogo (nombre, código, costo promedio, categoría).
- Categorías: organizar productos.
- Bodegas: sucursales o espacios de almacenamiento. Un producto puede tener stock distinto en cada bodega.
- Inventario: stock actual por producto y bodega. Muestra cantidadActual y stockMinimo. Si cantidadActual <= stockMinimo → está BAJO o FALTA.
- Kardex (Movimientos): historial de entradas/salidas de inventario.
- Mi Equipo: invitar empleados con código.
- Configuración: datos del negocio.
- Mi Perfil: datos del usuario.
- Rendimiento (Reportes): métricas de ventas.

REGLAS DE NEGOCIO CLAVE:
- El stock es por BODEGA. Nunca digas "hay X unidades" sin indicar en qué bodega, salvo que el usuario pregunte el total global.
- "Falta" o "stock bajo" = cantidadActual <= stockMinimo (o cantidadActual = 0).
- El costo promedio se actualiza con las compras.
- IVA de ventas = 15% (fijo en Ecuador para este sistema).
- No inventes productos, cantidades, precios, clientes ni bodegas que no aparezcan en los DATOS REALES abajo.
- Si no tienes el dato exacto en el contexto, dilo claramente: "No tengo ese dato cargado ahora" o sugiere ir al módulo correspondiente.

MÓDULOS QUE PUEDE USAR ESTE USUARIO:
${modulosPermitidos}

Módulos restringidos para su rol: ${modulosRestringidos || 'Ninguno'}.
Módulos en construcción: ${modulosEnConstruccion}.

══════════════════════════════════════
DATOS REALES DEL NEGOCIO (ÚNICA FUENTE DE VERDAD)
══════════════════════════════════════
${this.contextoGlobal}

Alertas de caducidad (próximos 30 días): ${alertasTexto || 'Ninguna'}.

══════════════════════════════════════
NAVEGACIÓN
══════════════════════════════════════
Si el usuario pide ir a un módulo permitido, responde breve y AL FINAL (nueva línea) pon exactamente:
[[NAVEGAR:/ruta/exacta]]
Rutas válidas: ${listaRutasParaComando || 'ninguna'}.
Nombres de módulos: ${listaNombresModulos || 'ninguno'}.
No inventes rutas.

══════════════════════════════════════
ESTILO Y REGLAS DE RESPUESTA
══════════════════════════════════════
1. Responde en español claro, natural y profesional. Tutea de forma cercana.
2. Sé útil y concreta. Prefiere listas cortas con **negrita** en datos clave (cantidades, nombres, bodegas).
3. Máximo 2-3 párrafos o una lista clara. Si es por voz, sé aún más breve y natural (sin markdown exagerado).
4. NUNCA inventes datos de stock, productos, precios o bodegas. Solo usa lo que está en DATOS REALES.
5. Cuando pregunten por stock / faltantes / "qué hay" / "qué falta":
   - Usa la sección STOCK POR BODEGA y PRODUCTOS CON STOCK BAJO O CERO.
   - Indica siempre la bodega y la cantidad.
   - Si hay muchos, resume los más importantes y menciona el total.
6. Si preguntan "¿por dónde empiezo?" o "cómo funciona", explica según su rol los 2-3 módulos más útiles primero.
7. Si piden algo de un módulo restringido, explica amablemente que su rol no tiene acceso.
8. El IVA es 15%. No cambies ese valor.
9. Si el contexto dice "Vacío" o no hay datos, dilo sin inventar.`;
  }

  enviarMensaje(texto: string, responderConVoz: boolean = false) {
    if (!texto.trim() || this.isChatLoading) return;

    this.chatMensajes.push({
      role: 'user',
      text: texto,
      safeHtml: this.formatearMensaje(texto)
    });

    this.isChatLoading = true;
    
    if (this.recognition) {
        try { this.recognition.stop(); } catch(e){}
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    const historial = this.chatMensajes.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.text
    }));

    const rutaActual = this.router.url;
    const promptConUbicacion = `${this.promptSistemaBase}\n\nUBICACIÓN ACTUAL DEL USUARIO: ${rutaActual}\n(Usa esta info solo como contexto; no inventes pantallas).`;

    const payload = {
      model: 'gpt-oss-20b', 
      messages: [{ role: 'system', content: promptConUbicacion }, ...historial],
      temperature: 0.25,
      max_tokens: 450
    };

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          const respuestaCruda = res.choices[0].message.content;
          const { textoLimpio: respuestaBot, ruta: rutaSolicitada } = this.extraerComandoNavegacion(respuestaCruda);

          this.chatMensajes.push({
            role: 'assistant',
            text: respuestaBot,
            safeHtml: this.formatearMensaje(respuestaBot)
          });
          this.isChatLoading = false;

          if (rutaSolicitada && this.modulosNavegables.some(m => m.ruta === rutaSolicitada)) {
            setTimeout(() => this.zone.run(() => this.router.navigate([rutaSolicitada])), 600);
          }

          if (responderConVoz) {
            this.hablar(respuestaBot.replace(/\*\*/g, ''), () => {
                if (this.keepListeningActive) {
                    this.iniciarEscucha();
                }
            }); 
          } else {
             if (this.keepListeningActive) {
                 this.iniciarEscucha();
             }
          }
        },
        error: (err) => {
          // 2. CAMBIO: Imprimir el error EXACTO para saber qué pasa
          console.error("❌ Error de comunicación con Groq:");
          console.error("Status:", err.status);
          console.error("Detalle del error:", err.error);

          let msjError = 'Lo siento, hubo un fallo en mi conexión. Revisa tu internet.';
          let detenerMicrofonoPorError = false;

          // Groq devuelve 404 si el modelo no existe o si hay error de CORS
          if (err.status === 404) {
             msjError = 'Error 404: Groq rechazó la conexión o el modelo no existe. (Ver consola)';
          } else if (err.status === 429) {
              msjError = 'Uy, me hiciste pensar demasiado rápido y me quedé sin aire. Espera unos segundos, por favor.';
              detenerMicrofonoPorError = true; 
              this.keepListeningActive = false; 
          }

          this.chatMensajes.push({ role: 'assistant', text: msjError, safeHtml: this.formatearMensaje(msjError) });
          this.isChatLoading = false;

          if (responderConVoz) {
              this.hablar(msjError, () => {
                  if (this.keepListeningActive && !detenerMicrofonoPorError) {
                      this.iniciarEscucha();
                  }
              });
          } else {
              if (this.keepListeningActive && !detenerMicrofonoPorError) {
                  this.iniciarEscucha();
              }
          }
        }
      });
  }

  private initSpeechRecognition() {
    const { webkitSpeechRecognition } = window as any;
    if (!webkitSpeechRecognition) return;

    this.recognition = new webkitSpeechRecognition();
    this.recognition.lang = 'es-EC';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event: any) => {
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript + ' ';
      }

      if (final) {
        this.transcriptAcumulado += final;
        this.zone.run(() => {
          clearTimeout(this.silenceTimer);
          
          this.silenceTimer = setTimeout(() => {
            if (this.transcriptAcumulado.trim()) {
              this.enviarMensaje(this.transcriptAcumulado.trim(), true);
              this.transcriptAcumulado = '';
            }
          }, 2200); 
        });
      }
    };

    this.recognition.onend = () => {
        this.zone.run(() => {
            this.isListening = false;
            if (this.keepListeningActive && !this.isChatLoading) {
                try { this.recognition.start(); this.isListening = true; } catch (e) {}
            }
        });
    };
    
    this.recognition.onerror = () => this.zone.run(() => this.isListening = false);
  }

  toggleEscucha() {
    if (this.keepListeningActive) {
      this.detenerEscuchaManejoUsuario();
    } else {
      this.keepListeningActive = true;
      this.iniciarEscucha();
    }
  }

  private iniciarEscucha() {
    if (!this.recognition) return;
    this.transcriptAcumulado = '';
    window.speechSynthesis.cancel(); 
    try {
      this.recognition.start();
      this.isListening = true;
    } catch (e) {}
  }

  private detenerEscuchaManejoUsuario() {
    this.keepListeningActive = false; 
    if (this.recognition) {
        try { this.recognition.stop(); } catch(e) {}
    }
    this.isListening = false;
  }

  private hablar(texto: string, onFinish?: () => void) {
    window.speechSynthesis.cancel();
    // Limpiar markdown y comandos para que suene natural al hablar
    const limpio = (texto || '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/#{1,6}\s*/g, '')
      .replace(/\[\[NAVEGAR:[^\]]*\]\]/g, '')
      .replace(/•/g, ',')
      .replace(/⚠/g, 'Atención:')
      .replace(/✖/g, 'Sin stock:')
      .replace(/\s+/g, ' ')
      .trim();

    setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      if (!this.vozFemenina && voices.length) {
        this.vozFemenina = this.seleccionarVozFemenina(voices);
      }

      const utterance = new SpeechSynthesisUtterance(limpio);
      if (this.vozFemenina) {
        utterance.voice = this.vozFemenina;
        utterance.lang = this.vozFemenina.lang || 'es-ES';
      } else {
        utterance.lang = 'es-ES';
      }
      utterance.rate = 1.05;
      utterance.pitch = 1.1;
      utterance.volume = 1;

      utterance.onend = () => {
          if (onFinish) onFinish();
      };
      utterance.onerror = () => {
          if (onFinish) onFinish();
      };

      window.speechSynthesis.speak(utterance);
    }, 80);
  }

  private extraerComandoNavegacion(texto: string): { textoLimpio: string; ruta: string | null } {
    if (!texto) return { textoLimpio: texto, ruta: null };
    const match = texto.match(this.REGEX_NAVEGACION);
    if (!match) return { textoLimpio: texto, ruta: null };
    const textoLimpio = texto.replace(this.REGEX_NAVEGACION, '').trim();
    return { textoLimpio, ruta: match[1].trim() };
  }

  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
  }

  private formatearMensaje(texto: string): SafeHtml {
    if (!texto) return '';
    let html = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

    const lineas = html.split('\n');
    let dentroDeLista = false;
    let resultado = '';

    for (const linea of lineas) {
      if (/^\s*[-*]\s+/.test(linea)) {
        if (!dentroDeLista) { resultado += '<ul>'; dentroDeLista = true; }
        resultado += `<li>${linea.replace(/^\s*[-*]\s+/, '')}</li>`;
      } else {
        if (dentroDeLista) { resultado += '</ul>'; dentroDeLista = false; }
        resultado += linea + '<br>';
      }
    }
    if (dentroDeLista) resultado += '</ul>';
    return this.sanitizer.bypassSecurityTrustHtml(resultado.replace(/<br>\s*$/, ''));
  }
}