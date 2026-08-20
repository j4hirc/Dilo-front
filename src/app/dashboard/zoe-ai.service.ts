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
  
  // NUEVO: Identificador para cancelar respuestas pendientes de la IA
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
    const es = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('es'));
    if (!es.length) return null;

    let vozPremium = es.find(v => v.name.toLowerCase().includes('natural') && v.name.toLowerCase().includes('mia')); 
    if (!vozPremium) vozPremium = es.find(v => v.name.toLowerCase().includes('natural') && v.name.toLowerCase().includes('elena'));
    if (!vozPremium) vozPremium = es.find(v => v.name.toLowerCase().includes('natural')); 

    if (!vozPremium) vozPremium = es.find(v => v.name.toLowerCase().includes('google') && !v.name.toLowerCase().includes('masculino') && !v.name.toLowerCase().includes('male'));

    const preferidas = [/microsoft sabina/i, /microsoft paulina/i, /m[oó]nica/i, /luc[ií]a/i, /mar[ií]a/i];
    if (!vozPremium) {
      for (const re of preferidas) {
        vozPremium = es.find(v => re.test(v.name));
        if (vozPremium) break;
      }
    }

    const masculinas = /pablo|jorge|diego|carlos|juan|pedro|antonio|male|hombre|david/i;
    const noMale = es.find(v => !masculinas.test(v.name));

    return vozPremium || noMale || es[0];
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

    this.promptSistemaBase = `Eres "Zoe", la asistente virtual inteligente de **Dilo** (software de gestión en Ecuador, Cuenca). Hablas con **${nombreUsuario}** (rol: **${rolUsuario}**) del negocio **"${negocioNombre}"**.

DATOS ACTUALES DEL NEGOCIO:
${this.contextoGlobal}
Alertas de caducidad: ${alertasTexto || 'Ninguna'}.

MÓDULOS DE DILO (TUS ÚNICAS FUNCIONALIDADES):
${modulosPermitidos}

REGLAS ABSOLUTAS:
1. SOLO ERES UNA ASISTENTE DE CONSULTA: ESTRICTAMENTE PROHIBIDO decir que puedes "crear", "registrar", "editar" o "hacer facturas". Tú SOLO lees información y llevas al usuario a las pantallas.
2. CERO ALUCINACIONES: Usa SOLO la información que te proveo aquí. Si te piden algo que no tienes, di: "No tengo esa información" o "Ese módulo no existe en Dilo todavía".
3. CEREBRO DIVIDIDO Y VOZ AMABLE: Tu respuesta DEBE estar en dos partes SIEMPRE:
   - Texto principal: Para leer en pantalla (sin tablas markdown).
   - Tag <voz>: Al final de todo, añade <voz>Tu frase hablada aquí</voz>. Esto será lo ÚNICO que se lea en voz alta. 
     IMPORTANTE PARA LA VOZ: DEBES DECIR LA INFORMACIÓN EN VOZ ALTA de forma fluida, amable y profesional. Evita jerga informal (NO uses "che", "mi rey", ni "amigo"), pero mantén un tono cálido y dispuesto ("claro que sí", "con gusto"). Si el usuario te pregunta qué productos hay, MENCIONA LOS NOMBRES DE LOS PRODUCTOS Y SUS CANTIDADES en la voz. 
     NUNCA digas "Aquí tienes la información en la pantalla" o "Míralo en la pantalla". Dilo TODO en voz alta, aunque te demores. Excepción: si son más de 10 productos, di los 4 o 5 más importantes y menciona el total. Prohibido leer códigos de ID.
     Ejemplo excelente: <voz>Claro que sí. Revisando la bodega norte, tenemos 10 mouse Logitech, 5 teclados mecánicos y 3 monitores. Todo está en orden.</voz>
4. NAVEGACIÓN: Si piden ir a un módulo, al final escribe: [[NAVEGAR:/ruta/exacta]]. Rutas válidas: ${listaRutasParaComando}.`;
  }

  enviarMensaje(texto: string, responderConVoz: boolean = false) {
    if (!texto.trim() || this.isChatLoadingSubject.value) return;

    this.detenerInteraccion(); 
    this.keepListeningActive = responderConVoz; 
    
    // Capturamos el ID de esta petición específica
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
      temperature: 0.2, 
      max_tokens: 500
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
            let textoParaVoz = textoCompleto; 

            const vozMatch = textoCompleto.match(/<voz>([\s\S]*?)<\/voz>/i);
            if (vozMatch) {
              textoParaVoz = vozMatch[1].trim();
              textoParaPantalla = textoCompleto.replace(vozMatch[0], '').trim();
            } else {
              textoParaPantalla = textoCompleto.replace(/<voz>|<\/voz>/gi, '').trim();
            }

            this.chatMensajesSubject.next([
              ...this.chatMensajesSubject.value,
              { role: 'assistant', text: textoParaPantalla, safeHtml: this.formatearMensaje(textoParaPantalla) }
            ]);
            this.isChatLoadingSubject.next(false);

            if (rutaSolicitada && this.modulosNavegables.some(m => m.ruta === rutaSolicitada)) {
              setTimeout(() => this.zone.run(() => this.router.navigate([rutaSolicitada])), 500);
            }

            if (responderConVoz) {
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
            if (this.peticionActivaId !== miPeticionId) return; // Descartar si el usuario detuvo

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

  // APAGADO MAESTRO TOTAL
  detenerInteraccion() {
    window.speechSynthesis.pause(); 
    window.speechSynthesis.cancel();
    
    this.keepListeningActive = false;
    this.peticionActivaId++; // Mata cualquier respuesta pendiente en el aire

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
      
      utterance.rate = 1.06; 
      utterance.pitch = 1.1; 
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
    
    let html = texto.replace(/\|/g, '').replace(/---/g, ''); 
    html = html.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

    const lineas = html.split('\n');
    let dentroDeLista = false;
    let resultado = '';

    for (let linea of lineas) {
      linea = linea.trim();
      if (!linea) continue; 

      if (/^[-*]\s+/.test(linea)) {
        if (!dentroDeLista) { 
          resultado += '<ul style="margin: 8px 0; padding-left: 20px;">'; 
          dentroDeLista = true; 
        }
        resultado += `<li>${linea.replace(/^[-*]\s+/, '')}</li>`;
      } else {
        if (dentroDeLista) { 
          resultado += '</ul>'; 
          dentroDeLista = false; 
        }
        resultado += linea + '<br><br>'; 
      }
    }
    
    if (dentroDeLista) resultado += '</ul>';
    resultado = resultado.replace(/(<br>)+$/, '');
    
    return this.sanitizer.bypassSecurityTrustHtml(resultado);
  }
}