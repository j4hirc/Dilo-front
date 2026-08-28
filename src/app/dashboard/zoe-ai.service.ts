import { Injectable, NgZone, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
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

  private groqApiKey = environment.diloAssistantApiKey;

  isChatOpen = false;
  isListening = false;
  public isSpeaking = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  private chatMensajesSubject = new BehaviorSubject<ChatMessage[]>([]);
  chatMensajes$ = this.chatMensajesSubject.asObservable();

  private isChatLoadingSubject = new BehaviorSubject<boolean>(false);
  isChatLoading$ = this.isChatLoadingSubject.asObservable();

  get chatMensajes(): ChatMessage[] {
    return this.chatMensajesSubject.value;
  }

  get isChatLoading(): boolean {
    return this.isChatLoadingSubject.value;
  }

  private contextoGlobal = '';
  private promptSistemaBase = '';
  private modulosNavegables: ModuloNavegable[] = [];
  private readonly REGEX_NAVEGACION = /\[\[NAVEGAR:\s*(.+?)\s*\]\]/i;

  private recognition: any;
  private silenceTimer: any;
  private transcriptAcumulado = '';
  keepListeningActive = false;

  // Reintento controlado del reconocimiento de voz (evita loops de "InvalidStateError" en Chrome).
  private restartRecognitionTimer: ReturnType<typeof setTimeout> | null = null;
  private permisoMicrofonoDenegado = false;

  private vozFemenina: SpeechSynthesisVoice | null = null;
  private peticionActivaId = 0;

  // --- Control de la cola de voz (evita que el navegador corte audios largos) ---
  private colaVoz: string[] = [];
  private vozKeepAliveInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.initSpeechRecognition();
    this.cargarVocesFemeninas();
  }

  private cargarVocesFemeninas() {
    const elegir = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      this.vozFemenina = this.seleccionarVozFemenina(voices);
    };

    elegir();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => elegir();
    }
  }

  private seleccionarVozFemenina(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const excluirMasculinas = /pablo|jorge|diego|carlos|juan|pedro|antonio|male|hombre|var[oó]n|david|boy/i;

    let vocesArgentinas = voices.filter(v =>
      v.lang && v.lang.toLowerCase().includes('es-ar') && !excluirMasculinas.test(v.name)
    );

    let vocesEspañol = vocesArgentinas.length > 0 ? vocesArgentinas : voices.filter(v =>
      v.lang && v.lang.toLowerCase().startsWith('es') && !excluirMasculinas.test(v.name)
    );

    if (!vocesEspañol.length) {
      return voices.find(v => /female|mujer|woman|femenina/i.test(v.name)) || voices[0] || null;
    }

    // Voces de alta calidad / conocidas como femeninas en español, en orden de preferencia.
    // Las voces "Natural/Neural/Online" suenan mucho más humanas que las voces locales básicas.
    const prioridadAlta = [
      /natural/i, /neural/i, /online/i, /premium/i, /enhanced/i, /wavenet/i, /studio/i,
      /elena/i, /sof[ií]a/i, /m[ií]a/i, /victoria/i, /paulina/i, /helena/i,
      /m[oó]nica/i, /luc[ií]a/i, /camila/i, /valentina/i, /isabela/i, /esperanza/i
    ];

    for (const regex of prioridadAlta) {
      const encontrada = vocesEspañol.find(v => regex.test(v.name));
      if (encontrada) return encontrada;
    }

    const vozMicrosoft = vocesEspañol.find(v => v.name.toLowerCase().includes('microsoft'));
    if (vozMicrosoft) return vozMicrosoft;

    const vozGoogle = vocesEspañol.find(v => v.name.toLowerCase().includes('google'));
    if (vozGoogle) return vozGoogle;

    return vocesEspañol[0];
  }

  inicializarChat(nombreUsuario: string, rol: string) {
    if (this.chatMensajesSubject.value.length === 0) {
      const textoBienvenida = `¡Hola! Soy **Zoe**. Cuentame, ${nombreUsuario}, ¿qué revisamos hoy, che?`;
      this.chatMensajesSubject.next([{
        role: 'assistant',
        text: textoBienvenida,
        safeHtml: this.formatearMensaje(textoBienvenida)
      }]);
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

    this.promptSistemaBase = `Eres "Zoe", la asistente virtual EXCLUSIVA del software Dilo. Tienes una personalidad femenina, seductora, carismática y hablas con un marcado acento argentino inconfundible (porteño). Tratas al usuario de "vos" y usas expresiones sutiles y atractivas ("che", "lindo", "corazón", "mirá"). Hablas con **${nombreUsuario}** (rol: **${rolUsuario}**) de **"${negocioNombre}"**.

CONTEXTO DEL NEGOCIO (Es tu ÚNICO universo de conocimiento):
${this.contextoGlobal}
Alertas caducidad: ${alertasTexto || 'Ninguna'}.
Módulos permitidos: ${modulosPermitidos}

REGLAS DE SEGURIDAD MÁXIMA (OBLIGATORIAS):

1. CERO INVENTOS:
   - Responde SOLO con datos que aparezcan en el CONTEXTO DEL NEGOCIO. No inventes absolutamente nada. Si el dato no está en el contexto, decilo con honestidad ("no tengo ese dato cargado todavía") en vez de suponer un número.

2. CERO OFF-TOPIC:
   - Solo temas de facturación, inventario, ventas, stock, equipo y Dilo. De lo contrario di: "Perdoname lindo, soy Zoe y solo puedo ayudarte con tu negocio."

3. FORMATO EN PANTALLA (TEXTO VISIBLE - PARA LEER):
   - Estructura los datos para la pantalla usando Markdown. Usa **negritas**, viñetas (-) y listas para que sea visualmente ordenado y fácil de leer rápido.
   - Sé directa con los números y nombres, y usá exactamente las cifras del contexto (no redondees ni inventes decimales).
   - Sin tanto texto minimo de 100 caracteres, máximo 300 caracteres. No escribas párrafos largos, solo lo necesario para que el usuario entienda la información.

4. ETIQUETA <voz> OBLIGATORIA (TEXTO HABLADO - PARA ESCUCHAR):
   - Al final de tu respuesta, DEBES incluir el texto que dirás en voz alta entre <voz> y </voz>.
   - REGLA DE ORO PARA LA VOZ: **NUNCA leas literalmente lo que escribiste en pantalla**. INTERPRÉTALO de forma conversacional, con tus propias palabras, como si nunca hubiera existido el texto en Markdown.
   - PROHIBIDO usar "meta-lenguaje". NUNCA digas: "Aquí tienes la lista", "Como ves en pantalla", "Te muestro los datos". Empieza a hablar directamente del tema.
   - Escribí los números SIEMPRE en palabras, tal como se dirían al hablar (ej: "$1,250.00" → "mil doscientos cincuenta dólares", nunca dejes símbolos como "$", "%" o "#" sueltos en el texto de voz).
   - Incluye toda la información importante (números, datos), pero agrúpalos como si estuvieras en una llamada telefónica con tu pareja.
   - Sonará seductor, fluido y 100% argentino.
   - IMPORTANTE: el texto de <voz> debe estar COMPLETO, con final claro (nunca lo dejes a medias). Si hay mucha información, resumí priorizando lo más importante primero para que la respuesta hablada sea completa y no quede cortada.

   EJEMPLO CORRECTO DE ESTRUCTURA TOTAL:
   **Productos sin stock:**
   - Atún (Bodega 1)
   - Jabón (Bodega 2)
   
   **Ventas (Últimos 30 días):** $1,250.00
   
   <voz>andamos en cero con el atún y el jabón, hay que reponer eso rapidito. Lo bueno es que en los últimos treinta días ya metiste mil doscientos cincuenta dólares en ventas, venimos re bien.</voz>

5. NAVEGACIÓN:
   - Solo si el usuario pide ir a un módulo permitido: añade al final [[NAVEGAR:/ruta-exacta]] (Rutas válidas: ${listaRutasParaComando})

6. COMPRENSIÓN Y PRECISIÓN:
   - Antes de responder, releé mentalmente el pedido del usuario y compará las cifras con el CONTEXTO DEL NEGOCIO: si algo no cierra o falta, priorizá la honestidad antes que "sonar completa".
   - Si el pedido del usuario es ambiguo o le falta un dato clave para responder bien (por ejemplo, no aclara de qué bodega, producto o período habla), hacé una pregunta corta y concreta para aclararlo en vez de adivinar.
   - Prestá atención al historial de la conversación: si el usuario ya aclaró algo antes, no se lo vuelvas a preguntar.
   - Verificá siempre las cifras contra el CONTEXTO DEL NEGOCIO antes de responder.`;
  }

  enviarMensaje(texto: string, responderConVoz: boolean = false) {
    if (!texto.trim() || this.isChatLoadingSubject.value) return;

    this.detenerInteraccion();
    this.keepListeningActive = responderConVoz;
    const miPeticionId = this.peticionActivaId;

    const mensajesActuales = this.chatMensajesSubject.value;
    this.chatMensajesSubject.next([
      ...mensajesActuales,
      { role: 'user', text: texto, safeHtml: this.formatearMensaje(texto) }
    ]);

    this.isChatLoadingSubject.next(true);

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    // Más historial = mejor comprensión de contexto conversacional (antes solo 6 mensajes).
    const historial = this.chatMensajesSubject.value.slice(-12).map(msg => ({
      role: msg.role,
      content: msg.text
    }));

    const payload = {
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: this.promptSistemaBase },
        ...historial
      ],
      temperature: 0.3, // Un poquito más alto para que su interpretación verbal sea más creativa y menos robótica
      // Antes 500: se cortaban respuestas largas (texto en pantalla + <voz>) por quedarse sin tokens.
      max_tokens: 900,
      top_p: 0.9
    };

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          this.zone.run(() => {
            if (this.peticionActivaId !== miPeticionId) return;

            let textoCompleto = res.choices[0]?.message?.content || '';
            textoCompleto = textoCompleto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            const navMatch = textoCompleto.match(/\[\[NAVEGAR:\s*([^\]]+)\]\]/i);
            let rutaSolicitada = null;
            if (navMatch) {
              rutaSolicitada = navMatch[1].trim();
              textoCompleto = textoCompleto.replace(navMatch[0], '').trim();
            }

            let textoParaPantalla = textoCompleto;
            let textoParaVoz = '';

            const vozMatch = textoCompleto.match(/<voz>([\s\S]*?)<\/voz>/i);
            if (vozMatch) {
              textoParaVoz = vozMatch[1].trim();
              textoParaPantalla = textoCompleto.replace(vozMatch[0], '').trim();
            } else {
              textoParaPantalla = textoCompleto.replace(/<voz>|<\/voz>/gi, '').trim();
              textoParaVoz = this.limpiarTextoParaVoz(textoParaPantalla);
            }

            this.chatMensajesSubject.next([
              ...this.chatMensajesSubject.value,
              { role: 'assistant', text: textoParaPantalla, safeHtml: this.formatearMensaje(textoParaPantalla) }
            ]);

            this.isChatLoadingSubject.next(false);

            if (rutaSolicitada && this.modulosNavegables.some(m => m.ruta === rutaSolicitada)) {
              setTimeout(() => this.zone.run(() => this.router.navigate([rutaSolicitada])), 500);
            }

            if (responderConVoz && textoParaVoz) {
              this.hablar(textoParaVoz, () => {
                if (this.keepListeningActive) this.iniciarEscucha();
              });
            } else {
              if (this.keepListeningActive) this.iniciarEscucha();
            }
          });
        },
        error: (err) => {
  console.error('Error Groq API:', err.status, err.error);
  this.zone.run(() => {
    if (this.peticionActivaId !== miPeticionId) return;

    let msjError = 'Perdoname lindo, parece que hay un problemita con internet.';
    let detenerMicrofonoPorError = false;
    let esperaExtraMs = 0;

    if (err.status === 429) {
      // Intenta usar el tiempo real que Groq pide esperar (header Retry-After, en segundos)
      const retryAfterHeader = err.headers?.get ? err.headers.get('retry-after') : null;
      const retryAfterSeg = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;
      esperaExtraMs = retryAfterSeg && !isNaN(retryAfterSeg) ? retryAfterSeg * 1000 : 15000; // fallback 15s

      msjError = 'Bancame un segundito, corazón. Me estás hablando muy rápido, dame un respiro y volvé a hablarme en un ratito.';
      // CLAVE: cortamos el ciclo de escucha automática para no encadenar más 429.
      // El usuario tendrá que tocar el micrófono de nuevo cuando quiera reintentar.
      detenerMicrofonoPorError = true;
      this.keepListeningActive = false;
    } else if (err.status === 400 || err.status === 413) {
      msjError = 'Uy corazón, veníamos hablando tanto que se me llenó la cabeza jaja. ¿Podés repetirme más cortito?';
    }

    this.chatMensajesSubject.next([
      ...this.chatMensajesSubject.value,
      { role: 'assistant', text: msjError, safeHtml: this.formatearMensaje(msjError) }
    ]);

    this.isChatLoadingSubject.next(false);

    const reactivar = () => {
      if (responderConVoz && !detenerMicrofonoPorError) {
        this.hablar(msjError, () => {
          if (this.keepListeningActive) this.iniciarEscucha();
        });
      } else if (responderConVoz) {
        // Igual queremos que lo escuche, pero SIN reactivar el micrófono después
        this.hablar(msjError);
      } else {
        if (this.keepListeningActive && !detenerMicrofonoPorError) this.iniciarEscucha();
      }
    };

    if (esperaExtraMs > 0) {
      setTimeout(reactivar, esperaExtraMs);
    } else {
      reactivar();
    }
  });
}
      });
  }

  private limpiarTextoParaVoz(texto: string): string {
    return (texto || '')
      .replace(/[*#|>_~]/g, '') // Elimina cualquier markdown sobrante
      .replace(/id:\s*\d+/gi, '')
      .replace(/⚠|✖|•|–|—/g, '')
      .replace(/\$/g, ' dólares ')
      .replace(/%/g, ' por ciento ')
      .replace(/(\d+)\s*uds?/gi, '$1 unidades')
      .replace(/(\d+)\s*mín/gi, 'mínimo $1')
      .replace(/-/g, ' ')
      .replace(/\n+/g, '. ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\.\s*\./g, '.')
      .replace(/\s+,/g, ',')
      .trim();
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
          }, 1500);
        });
      }
    };

    this.recognition.onend = () => {
      this.zone.run(() => {
        this.isListening = false;
        this.intentarReiniciarEscucha();
      });
    };

    // Distingue errores recuperables (no-speech, network, aborted) de errores
    // fatales (permiso de micrófono denegado) para no insistir en vano.
    this.recognition.onerror = (event: any) => {
      this.zone.run(() => {
        this.isListening = false;
        const codigo = event?.error;

        if (codigo === 'not-allowed' || codigo === 'service-not-allowed') {
          this.permisoMicrofonoDenegado = true;
          this.keepListeningActive = false;
          return;
        }

        // 'no-speech', 'network', 'aborted', etc.: son recuperables.
        // El propio onend ya se dispara después de onerror y reintentará.
        this.permisoMicrofonoDenegado = false;
      });
    };
  }

  /**
   * Reintenta iniciar el reconocimiento de voz con un pequeño margen de tiempo.
   * Evita el error típico de Chrome ("recognition already started" / arranques
   * en seco) cuando onend y un nuevo enviarMensaje se disparan casi al mismo tiempo.
   */
  private intentarReiniciarEscucha() {
    if (this.restartRecognitionTimer) {
      clearTimeout(this.restartRecognitionTimer);
      this.restartRecognitionTimer = null;
    }

    if (this.permisoMicrofonoDenegado) return;
    if (!this.keepListeningActive || this.isChatLoadingSubject.value || this.isSpeaking) return;

    this.restartRecognitionTimer = setTimeout(() => {
      this.restartRecognitionTimer = null;
      if (!this.keepListeningActive || this.isChatLoadingSubject.value || this.isSpeaking) return;
      try {
        this.recognition.start();
        this.zone.run(() => this.isListening = true);
      } catch (e) { }
    }, 250);
  }

  detenerInteraccion() {
    window.speechSynthesis.pause();
    window.speechSynthesis.cancel();
    this.currentUtterance = null;
    this.colaVoz = [];
    this.detenerKeepAlive();
    this.keepListeningActive = false;
    this.peticionActivaId++;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.restartRecognitionTimer) {
      clearTimeout(this.restartRecognitionTimer);
      this.restartRecognitionTimer = null;
    }
    try { this.recognition.abort(); } catch (e) { }
    this.zone.run(() => {
      this.isSpeaking = false;
      this.isListening = false;
      this.isChatLoadingSubject.next(false);
    });
  }

  toggleEscucha() {
    if (this.keepListeningActive) {
      this.detenerInteraccion();
    } else {
      this.permisoMicrofonoDenegado = false;
      this.keepListeningActive = true;
      this.iniciarEscucha();
    }
  }

  private iniciarEscucha() {
    if (!this.recognition) return;
    this.transcriptAcumulado = '';
    window.speechSynthesis.pause();
    window.speechSynthesis.cancel();
    try {
      this.recognition.start();
      this.isListening = true;
    } catch (e) { }
  }


  private dividirEnFrases(texto: string): string[] {
    // Protege los números decimales (ej: "1250.00") para que el punto no se
    // confunda con un punto final y corte la oración en medio de una cifra.
    const PLACEHOLDER_DECIMAL = '§DEC§';
    const textoProtegido = texto.replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER_DECIMAL}$2`);

    const frases = textoProtegido.match(/[^.!?…]+[.!?…]*(\s|$)/g) || [textoProtegido];
    const trozos: string[] = [];
    let actual = '';

    for (let frase of frases) {
      frase = frase.trim();
      if (!frase) continue;

      if ((actual + ' ' + frase).trim().length > 180) {
        if (actual) trozos.push(actual.trim());
        actual = frase;
      } else {
        actual = actual ? `${actual} ${frase}` : frase;
      }
    }
    if (actual) trozos.push(actual.trim());

    const trozosFinales = (trozos.length ? trozos : [textoProtegido])
      .map(t => t.split(PLACEHOLDER_DECIMAL).join('.'));

    return trozosFinales;
  }

  private iniciarKeepAlive() {
    this.detenerKeepAlive();
    // Truco anti-corte: algunos navegadores (sobre todo Chrome) pausan solos
    // el synthesizer si pasa mucho tiempo hablando. Forzar pause()+resume()
    // cada 10s mantiene el audio activo sin cortes perceptibles.
    this.vozKeepAliveInterval = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
  }

  private detenerKeepAlive() {
    if (this.vozKeepAliveInterval) {
      clearInterval(this.vozKeepAliveInterval);
      this.vozKeepAliveInterval = null;
    }
  }

  private hablarSiguienteFrase(onFinish?: () => void) {
    if (!this.colaVoz.length) {
      this.detenerKeepAlive();
      this.zone.run(() => this.isSpeaking = false);
      this.currentUtterance = null;
      if (onFinish) onFinish();
      return;
    }

    const frase = this.colaVoz.shift()!;
    this.currentUtterance = new SpeechSynthesisUtterance(frase);

    if (this.vozFemenina) {
      this.currentUtterance.voice = this.vozFemenina;
      this.currentUtterance.lang = this.vozFemenina.lang || 'es-AR';
    } else {
      this.currentUtterance.lang = 'es-AR';
    }

    // rate 1.0 = ritmo natural (0.94 sonaba levemente arrastrado);
    // pitch 1.08 = tono más agudo y femenino (0.85 lo hacía sonar grave/robótico).
    this.currentUtterance.rate = 1.0;
    this.currentUtterance.pitch = 1.08;
    this.currentUtterance.volume = 1;

    this.currentUtterance.onend = () => {
      this.hablarSiguienteFrase(onFinish);
    };

    this.currentUtterance.onerror = () => {
      // Si una frase falla, seguimos con la siguiente en vez de cortar toda la respuesta.
      this.hablarSiguienteFrase(onFinish);
    };

    window.speechSynthesis.speak(this.currentUtterance);
  }

  private hablar(texto: string, onFinish?: () => void) {
    if (!texto) {
      if (onFinish) onFinish();
      return;
    }

    window.speechSynthesis.pause();
    window.speechSynthesis.cancel();
    try { this.recognition.abort(); } catch (e) { }

    this.zone.run(() => {
      this.isSpeaking = true;
      this.isListening = false;
    });

    const textoParaVoz = this.limpiarTextoParaVoz(texto);
    this.colaVoz = this.dividirEnFrases(textoParaVoz);

    setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      if (!this.vozFemenina && voices.length) {
        this.vozFemenina = this.seleccionarVozFemenina(voices);
      }
      this.iniciarKeepAlive();
      this.hablarSiguienteFrase(onFinish);
    }, 80);
  }

  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
  }

  private formatearMensaje(texto: string): SafeHtml {
    if (!texto) return '';
    let html = texto.trim();

    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 14px 0 6px; font-weight: 700; color: var(--primary-orange, #ea580c); font-size: 1.05em;">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 16px 0 8px; font-weight: 700; color: var(--primary-orange, #ea580c); font-size: 1.15em;">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 style="margin: 18px 0 10px; font-weight: 700; color: var(--primary-orange, #c2410c); font-size: 1.25em;">$1</h2>');

    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong style="color: var(--primary-orange, #ea580c); font-weight: 600;">$1</strong>');

    html = html.replace(/\|/g, '');
    html = html.replace(/---/g, '<hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 12px 0;">');

    const lineas = html.split('\n');
    let dentroDeLista = false;
    let resultado = '';

    for (let linea of lineas) {
      linea = linea.trim();

      // Manejo de líneas vacías (saltos de línea)
      if (!linea) {
        if (dentroDeLista) {
          resultado += '</ul>';
          dentroDeLista = false;
        }
        if (!resultado.endsWith('<br>')) {
          resultado += '<br>';
        }
        continue;
      }

      if (/^[-*]\s+/.test(linea)) {
        if (!dentroDeLista) {
          resultado += '<ul style="margin: 8px 0; padding-left: 24px; list-style-type: disc; line-height: 1.5;">';
          dentroDeLista = true;
        }
        let itemLimpio = linea.replace(/^[-*]\s+/, '');
        resultado += `<li style="margin-bottom: 6px;">${itemLimpio}</li>`;
      } else {
        if (dentroDeLista) {
          resultado += '</ul>';
          dentroDeLista = false;
        }
        // Evitar doble salto de línea en los títulos
        if (linea.startsWith('<h') || linea.startsWith('<hr')) {
          resultado += linea;
        } else {
          resultado += linea + '<br>';
        }
      }
    }

    if (dentroDeLista) resultado += '</ul>';

    resultado = resultado.replace(/^(<br>)+/, '').replace(/(<br>)+$/, '');

    return this.sanitizer.bypassSecurityTrustHtml(resultado);
  }
}