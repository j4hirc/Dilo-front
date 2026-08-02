import { Injectable, NgZone, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { environment } from '../../environments/environment';

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

  private groqApiKey = environment.groqApiKey;

  // Estado del Chat
  isChatOpen = false;
  isChatLoading = false;
  isListening = false;
  
  chatMensajes: ChatMessage[] = [];
  
  // Contexto del Negocio
  private contextoGlobal = '';
  private promptSistemaBase = '';

  // Control de Voz
  private recognition: any;
  private silenceTimer: any;
  private transcriptAcumulado = '';
  
  // Control para saber si Zoe debe seguir escuchando o si el usuario la apagó
  keepListeningActive = false; 

  constructor() {
    this.initSpeechRecognition();
  }

  // 1. INICIALIZAR EL CHAT Y EL CONTEXTO
  inicializarChat(nombreUsuario: string, rol: string, negocio: string) {
    if (this.chatMensajes.length === 0) {
      const textoBienvenida = `¡Hola! Soy **Zoe**, tu asistente virtual en Dilo.\n\nSi es tu primera vez aquí, solo pregúntame o dime por voz: *"¿Por dónde empiezo?"* y te guiaré paso a paso.\n\n¿En qué te puedo ayudar hoy, ${nombreUsuario}?`;
      this.chatMensajes.push({
        role: 'assistant',
        text: textoBienvenida,
        safeHtml: this.formatearMensaje(textoBienvenida)
      });
    }
  }

  actualizarContexto(contextoTexto: string, modulosPermitidos: string, modulosRestringidos: string, roles: string, nombreUsuario: string, rolUsuario: string, negocioNombre: string, alertasTexto: string) {
    this.contextoGlobal = contextoTexto;
    this.promptSistemaBase = `
      Eres "Zoe", la asistente virtual del sistema de Facturación e Inventario "Dilo".
      Tu personalidad es simpática, muy humana, cercana y positiva, pero siempre profesional.
      Hablas con ${nombreUsuario}, quien tiene el rol de **${rolUsuario}** en el negocio "${negocioNombre}".

      SISTEMA DE ROLES DE DILO:
      ${roles}

      MÓDULOS QUE ${nombreUsuario} PUEDE USAR:
      ${modulosPermitidos}

      MÓDULOS RESTRINGIDOS PARA SU ROL:
      ${modulosRestringidos}

      DATOS DEL NEGOCIO:
      ${this.contextoGlobal}

      ALERTAS DE CADUCIDAD: ${alertasTexto}

      🔥 GUÍA DE INICIO (ONBOARDING) 🔥
      Si te pregunta "¿Por dónde empiezo?", "Soy nuevo" o pide ayuda general, explícale de forma MUY AMIGABLE esta ruta:
      1. Bodegas.
      2. Categorías.
      3. Productos.
      4. Proveedores y Abastecimiento.
      5. Clientes.
      6. Facturación.

      🔥 REGLAS IMPORTANTES:
      1. Sé MUY BREVE, conversacional y directa. Máximo 2 o 3 párrafos cortos.
      2. Usa **negrita** para resaltar módulos.
      3. Si pregunta por un módulo restringido, dile amablemente que es exclusivo de otro rol.
      4. SOBRE EL IVA: El IVA actual del sistema es fijo (generalmente 15%). Desde "Configuración" NO se puede cambiar el porcentaje del IVA de forma manual, solo se puede activar o desactivar la contabilidad. Si un usuario te pide cambiar el IVA general, dile que esa configuración no está disponible.
    `;
  }

  // 2. ENVIAR MENSAJES (TEXTO O VOZ)
  enviarMensaje(texto: string, responderConVoz: boolean = false) {
    if (!texto.trim() || this.isChatLoading) return;

    this.chatMensajes.push({
      role: 'user',
      text: texto,
      safeHtml: this.formatearMensaje(texto)
    });

    this.isChatLoading = true;
    
    // Detenemos temporalmente el micro mientras Zoe "piensa" y responde para evitar bucles
    if (this.recognition) {
        try { this.recognition.stop(); } catch(e){}
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    const historial = this.chatMensajes.map(msg => ({
      role: msg.role,
      content: msg.text
    }));

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'system', content: this.promptSistemaBase }, ...historial],
      temperature: 0.5,
      max_tokens: 600
    };

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          const respuestaBot = res.choices[0].message.content;
          this.chatMensajes.push({
            role: 'assistant',
            text: respuestaBot,
            safeHtml: this.formatearMensaje(respuestaBot)
          });
          this.isChatLoading = false;

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

          // 🔥 EL FRENO DE EMERGENCIA PARA EL ERROR 429
          if (err.status === 429) {
              msjError = 'Uy, me hiciste pensar demasiado rápido y me quedé sin aire. Espera unos segundos, por favor.';
              detenerMicrofonoPorError = true; // Forzamos apagar el micro para detener el bucle
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

  // 3. CONTROL DE VOZ CONTINUO (BURBUJA)
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
          }, 2500); 
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
      let voices = window.speechSynthesis.getVoices();
      
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

  // 4. UTILIDADES
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