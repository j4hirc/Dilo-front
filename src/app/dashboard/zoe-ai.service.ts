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

  // Estado del Chat
  isChatOpen = false;
  isChatLoading = false;
  isListening = false;
  
  chatMensajes: ChatMessage[] = [];
  
  // Contexto del Negocio
  private contextoGlobal = '';
  private promptSistemaBase = '';

  private modulosNavegables: ModuloNavegable[] = [];
  private readonly REGEX_NAVEGACION = /\[\[NAVEGAR:\s*(\/[a-zA-Z0-9\-\/]*)\s*\]\]/;

  // Control de Voz
  private recognition: any;
  private silenceTimer: any;
  private transcriptAcumulado = '';
  keepListeningActive = false; 

  constructor() {
    this.initSpeechRecognition();
  }

  inicializarChat(nombreUsuario: string, rol: string) {
    if (this.chatMensajes.length === 0) {
      const textoBienvenida = `¡Hola! Soy **Zoe**, tu asistente virtual en Dilo.\n\nSi es tu primera vez aquí, solo pregúntame o dime por voz: *"¿Por dónde empiezo?"* y te guiaré paso a paso. También puedo **llevarte directo** a cualquier módulo si me lo pides, por ejemplo: *"llévame a Productos"*.\n\n¿En qué te puedo ayudar hoy, ${nombreUsuario}?`;
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

    this.promptSistemaBase = `Eres "Zoe", asistente virtual en "Dilo".
Hablas con ${nombreUsuario} (${rolUsuario}) del negocio "${negocioNombre}".

MÓDULOS DE SU ROL:
${modulosPermitidos}
(Ignora pedidos a módulos restringidos o en construcción).

NEGOCIO Y DATOS:
${this.contextoGlobal}
Alertas: ${alertasTexto}

NAVEGACIÓN:
Si te pide ir a un módulo permitido, responde brevemente y agrega AL FINAL este comando en una nueva línea: [[NAVEGAR:/ruta/exacta]]. Rutas válidas: ${listaRutasParaComando || 'ninguna'}.

REGLAS:
1. SÉ MUY BREVE Y DIRECTA. 1 a 2 párrafos máximo.
2. Usa **negrita** para resaltar info clave.
3. El IVA (15%) es fijo.`;
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

    const historial = this.chatMensajes.slice(-4).map(msg => ({
      role: msg.role,
      content: msg.text
    }));

    const rutaActual = this.router.url;
    const promptConUbicacion = `${this.promptSistemaBase}\n\nUBICACIÓN ACTUAL: ${rutaActual}`;

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'system', content: promptConUbicacion }, ...historial],
      temperature: 0.5,
      max_tokens: 250 
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
          console.error("Error de Groq:", err);
          let msjError = 'Lo siento, hubo un fallo en mi conexión. Revisa tu internet.';
          let detenerMicrofonoPorError = false;

          if (err.status === 429) {
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
          }, 3000); 
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
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(texto);
      const voices = window.speechSynthesis.getVoices();
      
      let femaleVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google español') || /(sabina|paulina|monica|mujer|female)/i.test(v.name)));
      if (!femaleVoice) femaleVoice = voices.find(v => v.lang.startsWith('es') && !/(pablo|jorge|diego|carlos|male|hombre)/i.test(v.name));

      if (femaleVoice) utterance.voice = femaleVoice;
      utterance.lang = 'es-ES';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      utterance.onend = () => {
          if (onFinish) onFinish();
      };
      utterance.onerror = () => {
          if (onFinish) onFinish();
      };

      window.speechSynthesis.speak(utterance);
    }, 50);
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