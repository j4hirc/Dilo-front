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

  private vozFemenina: SpeechSynthesisVoice | null = null;
  private peticionActivaId = 0;

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
    // 1. Voces en español
    const vocesEspañol = voices.filter(v =>
      v.lang && v.lang.toLowerCase().startsWith('es') &&
      !/pablo|jorge|diego|carlos|juan|pedro|antonio|male|hombre|david|boy|hombre/i.test(v.name)
    );

    if (!vocesEspañol.length) {
      return voices.find(v => /female|mujer|woman|femenina/i.test(v.name)) || voices[0] || null;
    }

    // 2. Prioridad máxima: voces neurales / naturales con nombres femeninos
    const prioridadAlta = [
      /m[oó]nica/i, /paulina/i, /luc[ií]a/i, /mar[ií]a/i, /isabel/i,
      /sofia|sofía/i, /laura/i, /victoria/i, /elena/i, /camila/i,
      /paloma/i, /dalia/i, /salome|salomé/i, /ximena/i, /lucrecia/i,
      /mia|mía/i, /elvira/i, /carmen/i, /ana/i, /clara/i
    ];

    for (const regex of prioridadAlta) {
      const encontrada = vocesEspañol.find(v =>
        regex.test(v.name) &&
        (/natural|neural|online|premium|enhanced|wavenet|studio/i.test(v.name) || true)
      );
      if (encontrada) return encontrada;
    }

    // 3. Voces premium / enhanced / neural
    const vozPremium = vocesEspañol.find(v =>
      /premium|enhanced|natural|neural|online|wavenet|studio/i.test(v.name)
    );
    if (vozPremium) return vozPremium;

    // 4. Google español
    const vozGoogle = vocesEspañol.find(v => v.name.toLowerCase().includes('google'));
    if (vozGoogle) return vozGoogle;

    // 5. Cualquier voz que diga female/mujer
    const vozFemeninaGenerica = vocesEspañol.find(v => /female|mujer|femenina|woman/i.test(v.name));
    if (vozFemeninaGenerica) return vozFemeninaGenerica;

    // 6. Primera voz en español disponible
    return vocesEspañol[0];
  }

  inicializarChat(nombreUsuario: string, rol: string) {
    if (this.chatMensajesSubject.value.length === 0) {
      const textoBienvenida = `¡Hola! Soy **Zoe**. Cuéntame, ${nombreUsuario}, ¿qué revisamos hoy?`;
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

    this.promptSistemaBase = `Eres "Zoe", la asistente virtual EXCLUSIVA del software Dilo (Cuenca, Ecuador). Hablas con **${nombreUsuario}** (rol: **${rolUsuario}**) de **"${negocioNombre}"**.

CONTEXTO DEL NEGOCIO (Es tu ÚNICO universo de conocimiento. Úsalo textualmente):
${this.contextoGlobal}

Alertas caducidad: ${alertasTexto || 'Ninguna'}.
Módulos permitidos: ${modulosPermitidos}

REGLAS DE SEGURIDAD MÁXIMA (OBLIGATORIAS - NO NEGOCIABLES):

0. Cuando pregunten qué es Dilo → responde: "Es un sistema de facturación, inventario y gestión de negocios".

1. CERO INVENTOS / CERO ALUCINACIONES:
   - SOLO puedes responder con datos que aparezcan EXPLÍCITAMENTE en el CONTEXTO DEL NEGOCIO.
   - NUNCA inventes nombres, montos, fechas, stock o cualquier dato.
   - Si no está en el contexto responde exactamente:
     "No tengo ese dato en el sistema ahora mismo. ¿Quieres que revise otra cosa del negocio?"

2. CERO OFF-TOPIC:
   - Solo temas de facturación, inventario, clientes, proveedores, ventas, stock, equipo y módulos de Dilo.
   - Cualquier otra cosa → responde ÚNICA Y EXACTAMENTE:
     "Lo siento, soy Zoe. Solo puedo ayudarte con temas de facturación, inventario y la gestión de tu negocio. ¿En qué te asisto hoy con el sistema?"

3. RESPUESTAS EXTREMADAMENTE BREVES EN PANTALLA:
   - Máximo 2-3 oraciones cortas. El usuario odia los párrafos.
   - Sé directa, usa números exactos del contexto y ve al grano.

4. ETIQUETA <voz> OBLIGATORIA Y MUY IMPORTANTE:
   - Debes incluir SIEMPRE al final de tu respuesta el texto exacto que dirás en voz alta, entre <voz> y </voz>.
   - El contenido de <voz> debe ser:
     • Muy corto (máximo 1 o 2 oraciones naturales)
     • Como si estuvieras hablando con una amiga (tono conversacional, humano)
     • Sin markdown, sin listas, sin símbolos, sin asteriscos, sin números de factura largos
     • Interpreta la información, NO la leas literalmente
     • Habla rápido y directo
   - EJEMPLOS CORRECTOS:
     <voz>Tienes cinco productos bajos de stock. ¿Quieres que te diga cuáles?</voz>
     <voz>Este mes llevas mil doscientos dólares en ventas.</voz>
     <voz>No hay nada pendiente por cobrar ahora mismo.</voz>

5. NAVEGACIÓN:
   - Solo si el usuario pide ir a un módulo permitido: añade al final [[NAVEGAR:/ruta-exacta]]
   - Rutas válidas: ${listaRutasParaComando}
   - Nunca inventes rutas.`;
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

    const historial = this.chatMensajesSubject.value.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.text
    }));

    const rutaActual = this.router.url;
    const promptConUbicacion = `${this.promptSistemaBase}\n\nUBICACIÓN ACTUAL DEL USUARIO: ${rutaActual}`;

    const payload = {
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'system', content: promptConUbicacion }, ...historial],
      temperature: 0.1,
      max_tokens: 400
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
              // Fallback: limpiamos agresivamente si el modelo no puso la etiqueta
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
          this.zone.run(() => {
            if (this.peticionActivaId !== miPeticionId) return;

            let msjError = 'Lo siento, por favor revisa tu conexión a internet.';
            let detenerMicrofonoPorError = false;

            if (err.status === 429) {
              msjError = 'Dame un segundito. Tus consultas van muy rápido, háblame un poco más despacio por favor.';
              detenerMicrofonoPorError = false;
            }

            this.chatMensajesSubject.next([
              ...this.chatMensajesSubject.value,
              { role: 'assistant', text: msjError, safeHtml: this.formatearMensaje(msjError) }
            ]);

            this.isChatLoadingSubject.next(false);

            if (responderConVoz) {
              this.hablar(msjError, () => {
                if (this.keepListeningActive && !detenerMicrofonoPorError) this.iniciarEscucha();
              });
            } else {
              if (this.keepListeningActive && !detenerMicrofonoPorError) this.iniciarEscucha();
            }
          });
        }
      });
  }

  /** Limpia el texto para que suene natural y humano al hablar */
  private limpiarTextoParaVoz(texto: string): string {
    return (texto || '')
      .replace(/\*\*/g, '')
      .replace(/#+\s*/g, '')
      .replace(/\|/g, '')
      .replace(/id:\s*\d+/gi, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/⚠|✖|•|–|—/g, '')
      .replace(/\$/g, ' dólares ')
      .replace(/(\d+)\s*uds?/gi, '$1 unidades')
      .replace(/(\d+)\s*mín/gi, 'mínimo $1')
      .replace(/-/g, ' ')
      .replace(/\n+/g, '. ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\.\s*\./g, '.')
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
        if (this.keepListeningActive && !this.isChatLoadingSubject.value && !this.isSpeaking) {
          try {
            this.recognition.start();
            this.isListening = true;
          } catch (e) { }
        }
      });
    };

    this.recognition.onerror = () => this.zone.run(() => this.isListening = false);
  }

  detenerInteraccion() {
    window.speechSynthesis.pause();
    window.speechSynthesis.cancel();
    this.currentUtterance = null;
    this.keepListeningActive = false;
    this.peticionActivaId++;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
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

    // Limpieza final extra por si acaso
    const textoParaVoz = this.limpiarTextoParaVoz(texto);

    setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      if (!this.vozFemenina && voices.length) {
        this.vozFemenina = this.seleccionarVozFemenina(voices);
      }

      this.currentUtterance = new SpeechSynthesisUtterance(textoParaVoz);

      if (this.vozFemenina) {
        this.currentUtterance.voice = this.vozFemenina;
        this.currentUtterance.lang = this.vozFemenina.lang || 'es-EC';
      } else {
        this.currentUtterance.lang = 'es-EC';
      }

      // === AJUSTES DE VOZ MÁS MUJER Y RÁPIDA ===
      this.currentUtterance.rate = 1.22;   // Rápida pero natural
      this.currentUtterance.pitch = 1.15;  // Más agudo = más femenino
      this.currentUtterance.volume = 1;

      this.currentUtterance.onend = () => {
        this.zone.run(() => this.isSpeaking = false);
        this.currentUtterance = null;
        if (onFinish) onFinish();
      };

      this.currentUtterance.onerror = () => {
        this.zone.run(() => this.isSpeaking = false);
        this.currentUtterance = null;
        if (onFinish) onFinish();
      };

      window.speechSynthesis.speak(this.currentUtterance);
    }, 80);
  }

  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
  }

  private formatearMensaje(texto: string): SafeHtml {
    if (!texto) return '';
    let html = texto.trim();
    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 12px 0 6px; font-weight: bold; color: var(--primary-orange, #ea580c); font-size: 1.05em;">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 14px 0 8px; font-weight: bold; color: var(--primary-orange, #ea580c); font-size: 1.15em;">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 style="margin: 16px 0 10px; font-weight: bold; color: var(--primary-orange, #c2410c); font-size: 1.25em;">$1</h2>');
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\|/g, '');
    html = html.replace(/---/g, '');

    const lineas = html.split('\n');
    let dentroDeLista = false;
    let resultado = '';

    for (let linea of lineas) {
      linea = linea.trim();
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
          resultado += '<ul style="margin: 6px 0; padding-left: 20px; line-height: 1.4;">';
          dentroDeLista = true;
        }
        let itemLimpio = linea.replace(/^[-*]\s+/, '');
        resultado += `<li style="margin-bottom: 4px;">${itemLimpio}</li>`;
      } else {
        if (dentroDeLista) {
          resultado += '</ul>';
          dentroDeLista = false;
        }
        if (linea.startsWith('<h')) {
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