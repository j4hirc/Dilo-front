import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-dashboard-default',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './dashboard-default.html',
  styleUrls: ['./dashboard-default.css']
})
export class DashboardDefault implements OnInit {
  private router = inject(Router);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private sanitizer = inject(DomSanitizer);
  
  negocioId: number | null = null;
  negocioNombre: string = 'Cargando...';
  usuarioLogueado: any = null;
  isSidebarOpen = false;

  alertasCaducidad: any[] = [];
  showNotificaciones = false;
  showUserMenu = false;

  // 1. Usamos la URL del backend desde el archivo dinámico
  private apiUrl = environment.apiUrl;

  // =========================================
  // 🔥 CONTEXTO REAL DEL NEGOCIO (para la IA)
  // =========================================
  private contextoNegocioTexto: string = 'Aún no se ha cargado la información del negocio.';
  private contextoNegocioListo = false;

  // =========================================
  // 🔥 VARIABLES DEL ASISTENTE VIRTUAL
  // =========================================
  isChatOpen = false;
  isChatLoading = false;
  nuevoMensaje = '';
  chatMensajes: { role: string, text: string, safeHtml?: SafeHtml }[] = [];
 
  // 2. Usamos la API Key de Groq desde el archivo dinámico
  private groqApiKey = environment.groqApiKey;

  ngOnInit() {
    // Inicializamos el primer mensaje aquí para poder usar el 'sanitizer'
    const textoBienvenida = '¡Hola! 👋 Soy **Zoe**, tu asistente virtual. ¿En qué módulo del sistema te puedo ayudar hoy?';
    this.chatMensajes = [
      { 
        role: 'assistant', 
        text: textoBienvenida,
        safeHtml: this.formatearMensaje(textoBienvenida)
      }
    ];

    const userStr = localStorage.getItem('usuario');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = this.usuarioLogueado?.negocioId;

    if (this.negocioId) {
       this.cargarDatosNegocio();
       this.cargarAlertasCaducidad();
       this.cargarContextoNegocioParaIA();
    }
  }

  cargarDatosNegocio() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any>(`${this.apiUrl}/negocios/${this.negocioId}`, { headers })
      .subscribe({
        next: (data) => this.negocioNombre = data.nombreComercial || data.razonSocial || 'Mi Empresa',
        error: (err) => console.error(err)
      });
  }

  cargarAlertasCaducidad() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/dashboard/alertas-caducidad?dias=30`, { headers })
      .subscribe({
        next: (data) => this.alertasCaducidad = data || [],
        error: (err) => console.error(err)
      });
  }

  toggleNotificaciones() {
    this.showNotificaciones = !this.showNotificaciones;
    if (this.showNotificaciones) this.showUserMenu = false;
  }

  toggleUserMenu() {
    this.showUserMenu = !this.showUserMenu;
    if (this.showUserMenu) this.showNotificaciones = false;
  }

  toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  cerrarSesion() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }

  cargarContextoNegocioParaIA() {
    if (!this.negocioId) return;

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
    const id = this.negocioId;

    const reqProductos   = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, { headers }).pipe(catchError(() => of([])));
    const reqCategorias  = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/categorias`, { headers }).pipe(catchError(() => of([])));
    const reqClientes    = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).pipe(catchError(() => of([])));
    const reqProveedores = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, { headers }).pipe(catchError(() => of([])));
    const reqInventario  = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).pipe(catchError(() => of([])));
    const reqFacturas    = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([])));

    forkJoin([reqProductos, reqCategorias, reqClientes, reqProveedores, reqInventario, reqFacturas])
      .subscribe(([productos, categorias, clientes, proveedores, inventario, facturas]) => {
        this.contextoNegocioTexto = this.construirResumenDelNegocio(
          Array.isArray(productos) ? productos : [],
          Array.isArray(categorias) ? categorias : [],
          Array.isArray(clientes) ? clientes : [],
          Array.isArray(proveedores) ? proveedores : [],
          Array.isArray(inventario) ? inventario : [],
          Array.isArray(facturas) ? facturas : []
        );
        this.contextoNegocioListo = true;
      });
  }

  construirResumenDelNegocio(
    productos: any[], categorias: any[], clientes: any[],
    proveedores: any[], inventario: any[], facturas: any[]
  ): string {
    const nombresCategorias = categorias.map(c => c.nombre).filter(Boolean);

    const listaProductos = productos.slice(0, 20).map(p =>
      `${p.nombre || 'S/N'} (cod: ${p.codigoPrincipal || 'S/C'}, marca: ${p.marca || '-'}, PVP: $${Number(p.precioUnitario || 0).toFixed(2)})`
    ).join('; ') || 'Aún no hay productos registrados.';

    const stockBajo = inventario
      .filter(i => Number(i.cantidadActual || 0) <= Number(i.stockMinimo || 0))
      .slice(0, 15)
      .map(i => `${i.productoNombre || 'Producto'} en ${i.bodegaNombre || 'bodega'} (quedan ${i.cantidadActual ?? 0})`)
      .join('; ') || 'Ningún producto en stock bajo por el momento.';

    const valorTotalInventario = inventario.reduce((acc, i) => acc + Number(i.valorInventario || 0), 0);

    const nombresClientes = clientes.slice(0, 10).map(c => c.nombreCompleto || `${c.primerNombre || ''} ${c.apellidoPaterno || ''}`.trim()).filter(Boolean);
    const nombresProveedores = proveedores.slice(0, 10).map(p => p.nombreComercial || p.razonSocial || p.nombre).filter(Boolean);

    const totalVentas = facturas.reduce((acc, f) => acc + Number(f.totalFactura || f.total || 0), 0);
    const ultimasFacturas = facturas.slice(-5).map(f =>
      `#${f.numeroFactura || 'S/N'} - ${f.clienteNombre || f.cliente?.nombre || 'Consumidor Final'} - $${Number(f.totalFactura || f.total || 0).toFixed(2)}`
    ).join('; ') || 'Aún no hay facturas emitidas.';

    return `
      DATOS REALES Y ACTUALES DEL NEGOCIO "${this.negocioNombre}":
      - Categorías de productos registradas (${categorias.length}): ${nombresCategorias.join(', ') || 'ninguna aún'}.
      - Total de productos en catálogo: ${productos.length}. Ejemplos: ${listaProductos}.
      - Valor total actual del inventario: $${valorTotalInventario.toFixed(2)}.
      - Productos con stock bajo o crítico: ${stockBajo}.
      - Total de clientes registrados: ${clientes.length}. Algunos: ${nombresClientes.join(', ') || 'ninguno aún'}.
      - Total de proveedores registrados: ${proveedores.length}. Algunos: ${nombresProveedores.join(', ') || 'ninguno aún'}.
      - Total de facturas emitidas: ${facturas.length}, con ventas acumuladas por $${totalVentas.toFixed(2)}.
      - Últimas facturas emitidas: ${ultimasFacturas}.
    `;
  }

  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
  }

  formatearMensaje(texto: string): SafeHtml {
    if (!texto) return '';

    let html = texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

    const lineas = html.split('\n');
    let dentroDeLista = false;
    let resultado = '';

    for (const linea of lineas) {
      const esItem = /^\s*[-*]\s+/.test(linea);
      if (esItem) {
        if (!dentroDeLista) {
          resultado += '<ul>';
          dentroDeLista = true;
        }
        resultado += `<li>${linea.replace(/^\s*[-*]\s+/, '')}</li>`;
      } else {
        if (dentroDeLista) {
          resultado += '</ul>';
          dentroDeLista = false;
        }
        resultado += linea + '<br>';
      }
    }
    if (dentroDeLista) resultado += '</ul>';
    resultado = resultado.replace(/<br>\s*$/, '');

    return this.sanitizer.bypassSecurityTrustHtml(resultado);
  }

  enviarMensajeChat() {
    if (!this.nuevoMensaje.trim() || this.isChatLoading) return;

    const textoUsuario = this.nuevoMensaje;
    // Guardamos el mensaje de texto Y el HTML ya procesado
    this.chatMensajes.push({ 
      role: 'user', 
      text: textoUsuario, 
      safeHtml: this.formatearMensaje(textoUsuario) 
    });
    
    this.nuevoMensaje = '';
    this.isChatLoading = true;
    this.cdr.detectChanges(); 

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.groqApiKey}`,
      'Content-Type': 'application/json'
    });

    const historialMensajes = this.chatMensajes.map(msg => ({
      role: msg.role,
      content: msg.text 
    }));

    const alertasTexto = (this.alertasCaducidad && this.alertasCaducidad.length)
      ? this.alertasCaducidad.slice(0, 15).map((a: any) =>
          `${a.productoNombre || a.nombre || 'Producto'} caduca el ${a.fechaCaducidad || a.fecha || 'fecha no disponible'}`
        ).join('; ')
      : 'No hay productos próximos a caducar en los siguientes 30 días.';

    const manualDelSistema = `
      Eres "Zoe", la asistente virtual del sistema de Facturacion e Inventario "Dilo".
      Dilo es un sistema de facturación mediante voz. 
      Tu personalidad es simpática, cercana y  positiva, pero siempre profesional y precisa con los datos.
      Hablas con ${this.usuarioLogueado?.primerNombre || 'el administrador'}, quien administra el negocio "${this.negocioNombre}".

      TUS CONOCIMIENTOS DEL MENÚ LATERAL DEL SISTEMA (Úsalos para guiar al usuario):
      - Dashboard: Gráficas y resumen general del negocio.
      - Facturas: Módulo para registrar nuevas ventas, cobrar a clientes y emitir comprobantes (facturación tradicional y mediante voz).
      - Abastecimiento: Módulo para registrar compras de mercadería a proveedores.
      - Clientes / Proveedores: Directorio para registrar la información de contactos y empresas.
      - Productos: Catálogo de mercadería. Aquí se configuran precios (PVP), códigos, si graban IVA (15%) y si tienen control de Caducidad.
      - Categorías: Para organizar los productos (ej. Lácteos, Ferretería).
      - Bodegas: Creación de sucursales o cuartos de almacenamiento.
      - Inventario: Para ver el stock actual y las alertas de productos a punto de caducar.
      - Kardex: El historial contable detallado de todas las entradas y salidas de un producto.
      - Mi Equipo: Módulo para agregar empleados o cajeros y gestionar sus accesos.
      - Configuración: Módulo para cambiar el Logo, el RUC, activar Contabilidad y definir el método de costeo (Promedio, FIFO o LIFO).

      ${this.contextoNegocioTexto}

      ALERTAS DE CADUCIDAD (próximos 30 días): ${alertasTexto}

      FORMATO DE RESPUESTA (IMPORTANTE):
      - Usa **negrita** (con doble asterisco) solo para resaltar cifras, nombres de módulos o datos clave.
      - Si vas a dar varias opciones o pasos, usa una lista con líneas que empiecen en "- ".
      - Usa saltos de línea entre ideas para que no sea un bloque de texto plano.
      - Nunca muestres IDs internos, códigos de base de datos ni datos técnicos como negocioId, userId, etc. Refiérete siempre por nombre.

      REGLAS ESTRICTAS DE RESPUESTA:
      1. Sé MUY BREVE, directo y usa un tono amigable y simpático (puedes usar 1 emoji ocasional, sin abusar). Máximo 2 o 3 párrafos súper cortos.
      2. Si el usuario te pregunta cómo hacer algo, dile a qué opción del menú lateral (de la lista de arriba) debe ir.
      3. Usa los DATOS REALES del negocio de arriba (productos, stock, clientes, proveedores, ventas) para responder con cifras exactas cuando te pregunten por su negocio. No inventes cifras que no estén ahí.
      4. Nunca inventes funciones que no estén en la lista de conocimientos.
      5. Preséntate como "Zoe" si te preguntan tu nombre, nunca como una IA genérica.
      6. Si pregunta quien eres dile que eres una Asistente Llamada "Zoe" del sistema Dilo que es un sistema de facturacion por voz
    `;

    const mensajeSistema = {
      role: 'system',
      content: manualDelSistema
    };

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [mensajeSistema, ...historialMensajes], 
      temperature: 0.5, 
      max_tokens: 500
    };

    this.http.post<any>('https://api.groq.com/openai/v1/chat/completions', payload, { headers })
      .subscribe({
        next: (res) => {
          const respuestaBot = res.choices[0].message.content;
          // Guardamos texto puro y HTML seguro
          this.chatMensajes.push({ 
            role: 'assistant', 
            text: respuestaBot,
            safeHtml: this.formatearMensaje(respuestaBot) 
          });
          
          this.isChatLoading = false;
          this.cdr.detectChanges(); 
        },
        error: (err) => {
          console.error('Error detallado de Groq:', err.error || err); 
          const msjError = 'Lo siento, hubo un fallo en mi conexión. Revisa la consola para más detalles.';
          this.chatMensajes.push({ 
            role: 'assistant', 
            text: msjError,
            safeHtml: this.formatearMensaje(msjError)
          });
          
          this.isChatLoading = false;
          this.cdr.detectChanges();
        }
      });
  }
}