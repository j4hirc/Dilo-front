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
    const es = voices.filter(v => 
      v.lang && v.lang.toLowerCase().startsWith('es') && 
      !/pablo|jorge|diego|carlos|juan|pedro|antonio|male|hombre|david|boy/i.test(v.name)
    );

    if (!es.length) {
      return voices.find(v => /female|mujer|woman/i.test(v.name) || !/male|hombre|boy/i.test(v.name)) || voices[0];
    }

    let vozPremium = es.find(v => /natural|neural/i.test(v.name) && /mia|elena|paloma|camila|lucrecia|salome/i.test(v.name));
    if (!vozPremium) vozPremium = es.find(v => /female|mujer/i.test(v.name));

    const preferidas = /sabina|paulina|m[oó]nica|luc[ií]a|mar[ií]a|isabel|sofia|laura/i;
    if (!vozPremium) {
      vozPremium = es.find(v => preferidas.test(v.name));
    }

    if (!vozPremium) {
      vozPremium = es.find(v => v.name.toLowerCase().includes('google') && !/masculino|male/i.test(v.name));
    }

    return vozPremium || es[0]; 
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

    // --- MEJORA: BALANCE PERFECTO ENTRE HUMANA SIMPÁTICA Y DAR DATOS CLAROS ---
    this.promptSistemaBase = `Eres "Zoe", la asistente virtual simpática, amable y experta de **Dilo** (software en Cuenca, Ecuador). Hablas con **${nombreUsuario}** (rol: **${rolUsuario}**) de **"${negocioNombre}"**.

CONTEXTO DEL NEGOCIO (Tus conocimientos actuales):
${this.contextoGlobal}
Alertas caducidad: ${alertasTexto || 'Ninguna'}.
Módulos: ${modulosPermitidos}

REGLAS DE ORO - ACTÚA COMO HUMANA SIMPÁTICA Y EFICIENTE:
1. TONO CÁLIDO Y CONVERSACIONAL: Eres una persona amable y experta. Trata al usuario con cordialidad. No seas un robot frío, pero tampoco hables demasiado.
2. INTERPRETA Y EXPLICA LOS DATOS: Cuando te pidan datos, SÍ DEBES DARLOS, pero no leas listas crudas. Teje la información en oraciones naturales como lo haría un humano. 
   - Ejemplo de cómo hablar: "Te cuento que estuve revisando la bodega norte y tenemos 5 teclados mecánicos y 10 mouses disponibles."
   - Ejemplo de lo que NO debes hacer: "- Teclados: 5. - Mouses: 10."
3. EQUILIBRIO PERFECTO: No des respuestas de una sola línea cortante, pero tampoco des discursos. Explica bien el dato que te piden de forma resumida y agradable.
4. ESTRUCTURA OBLIGATORIA (TEXTO Y VOZ):
   - Texto principal: Para la pantalla, usa Markdown bonito, limpio y bien estructurado.
   - Tag <voz>: OBLIGATORIO al final de tu respuesta. <voz>Tu explicación hablada aquí</voz>.
     REGLA PARA LA VOZ: Lo que pongas en <voz> será lo único que se escuche. Escribe ahí de 1 a 3 oraciones naturales, interpretando la información solicitada de forma amigable y útil. 
5. NAVEGACIÓN: Si piden ir a un módulo, añade al final: [[NAVEGAR:/ruta/exacta]]. Rutas: ${listaRutasParaComando}.`;
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
      temperature: 0.6, // MEJORA: Un poco más alto para que sea más natural, cálida y menos robótica.
      max_tokens: 400 // MEJORA: Más espacio para que pueda desarrollar bien la respuesta conversacional.
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
              // MEJORA EN EL FALLBACK: Si olvida <voz>, leemos un resumen limpio del texto para que no se quede muda ni lea cosas raras.
              textoParaPantalla = textoCompleto.replace(/<voz>|<\/voz>/gi, '').trim();
              
              // Limpiamos markdown para que la lectura de respaldo sea natural
              let textoLimpio = textoParaPantalla
                .replace(/\*\*/g, '')
                .replace(/#/g, '')
                .replace(/-/g, '')
                .replace(/\|/g, '')
                .trim();
                
              // Si el texto es largo, agarramos las primeras 2 oraciones para que no lea biblias.
              const oraciones = textoLimpio.split(/(?<=[.!?])\s+/);
              textoParaVoz = oraciones.slice(0, 2).join(' ');
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
          } catch (e) {}
        }
      });
    };

    this.recognition.onerror = () => this.zone.run(() => this.isListening = false);
  }

  detenerInteraccion() {
    window.speechSynthesis.pause(); 
    window.speechSynthesis.cancel();
    
    this.keepListeningActive = false;
    this.peticionActivaId++; 

    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    try { this.recognition.abort(); } catch (e) {}
    
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
    } catch (e) {}
  }

  private hablar(texto: string, onFinish?: () => void) {
    if (!texto) {
      if (onFinish) onFinish();
      return;
    }

    window.speechSynthesis.pause();
    window.speechSynthesis.cancel();
    
    try { this.recognition.abort(); } catch(e) {}

    this.zone.run(() => {
      this.isSpeaking = true;
      this.isListening = false;
    });

    const textoParaVoz = (texto || '')
      .replace(/\*/g, '')
      .replace(/#/g, '')
      .replace(/\|/g, '') 
      .replace(/id:\d+/gi, '') 
      .replace(/\(.*?\)/g, '') 
      .replace(/\[.*?\]/g, '') 
      .replace(/⚠|✖/g, '')
      .replace(/\$/g, ' dólares ')
      .replace(/-/g, '') 
      .trim();

    setTimeout(() => {
      const voices = window.speechSynthesis.getVoices();
      if (!this.vozFemenina && voices.length) {
        this.vozFemenina = this.seleccionarVozFemenina(voices);
      }

      const utterance = new SpeechSynthesisUtterance(textoParaVoz);
      
      if (this.vozFemenina) {
        utterance.voice = this.vozFemenina;
        utterance.lang = this.vozFemenina.lang;
      } else {
        utterance.lang = 'es-EC';
      }
      
      utterance.rate = 1.05; 
      utterance.pitch = 1.25; 
      utterance.volume = 1;

      utterance.onend = () => { 
        this.zone.run(() => this.isSpeaking = false);
        if (onFinish) onFinish(); 
      };
      
      utterance.onerror = () => { 
        this.zone.run(() => this.isSpeaking = false);
        if (onFinish) onFinish(); 
      };

      window.speechSynthesis.speak(utterance);
    }, 100);
  }

  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
  }

  private formatearMensaje(texto: string): SafeHtml {
    if (!texto) return '';
    
    let html = texto.trim();
    
    // Proteger etiquetas html inyectadas vs símbolos propios
    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Renderizado de Títulos (H1, H2, H3)
    html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 12px 0 6px; font-weight: bold; color: var(--primary-orange, #ea580c); font-size: 1.05em;">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 14px 0 8px; font-weight: bold; color: var(--primary-orange, #ea580c); font-size: 1.15em;">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 style="margin: 16px 0 10px; font-weight: bold; color: var(--primary-orange, #c2410c); font-size: 1.25em;">$1</h2>');

    // Negritas
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');
    
    // Tablas Markdown muy simples
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

      // Renderizado de listas
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