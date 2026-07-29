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

  rolUsuario: string = '';

  fotoPerfilUrl: string | null = null;
  inicialesUsuario: string = 'US';

  alertasCaducidad: any[] = [];
  showNotificaciones = false;
  showUserMenu = false;

  private apiUrl = environment.apiUrl;
  private contextoNegocioTexto: string = 'Aún no se ha cargado la información del negocio.';
  private contextoNegocioListo = false;

  isChatOpen = false;
  isChatLoading = false;
  nuevoMensaje = '';
  chatMensajes: { role: string, text: string, safeHtml?: SafeHtml }[] = [];
 
  private groqApiKey = environment.groqApiKey;

  // 🔥 FUENTE ÚNICA DE VERDAD del menú del sistema: mismos roles que se usan
  // en el *ngIf="tieneRol([...])" del sidebar (dashboard-default.html).
  // Así la IA "Zoe" siempre sabe exactamente qué módulos ve cada rol,
  // sin importar que el menú cambie en el futuro (solo se edita aquí).
  private readonly modulosSistema: { nombre: string; roles: string[]; descripcion: string }[] = [
    { nombre: 'Dashboard (Propietario)', roles: ['PROPIETARIO'], descripcion: 'Gráficas y resumen general del negocio (ventas, stock, ganancias).' },
    { nombre: 'Facturas', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Registrar nuevas ventas, cobrar a clientes y emitir comprobantes (facturación tradicional y por voz).' },
    { nombre: 'Cuentas por Cobrar', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Ver y gestionar los saldos pendientes de clientes (crédito).' },
    { nombre: 'Abastecimiento', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Registrar compras de mercadería a proveedores.' },
    { nombre: 'Clientes', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Directorio para registrar y consultar la información de los clientes.' },
    { nombre: 'Proveedores', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Directorio de empresas y contactos que abastecen al negocio.' },
    { nombre: 'Productos', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Catálogo de mercadería: precios (PVP), códigos, IVA (15%) y control de caducidad.' },
    { nombre: 'Categorías', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Organizar los productos por categoría (ej. Lácteos, Ferretería).' },
    { nombre: 'Bodegas', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Creación de sucursales o cuartos de almacenamiento.' },
    { nombre: 'Inventario', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Stock actual por bodega y alertas de productos próximos a caducar.' },
    { nombre: 'Kardex (Movimientos)', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Historial contable detallado de entradas y salidas de cada producto.' },
    { nombre: 'Mi Equipo', roles: ['PROPIETARIO'], descripcion: 'Agregar empleados/cajeros, aprobar solicitudes y cambiar roles de colaboradores.' },
    { nombre: 'Configuración', roles: ['PROPIETARIO'], descripcion: 'Cambiar Logo, RUC, activar Contabilidad y definir método de costeo (Promedio, FIFO o LIFO).' },
    { nombre: 'Mi Perfil', roles: ['PROPIETARIO', 'VENDEDOR', 'BODEGUERO'], descripcion: 'Datos personales, foto y contraseña del usuario.' },
  ];

  // Descripción de qué puede hacer cada rol en general (control de acceso del negocio).
  private readonly rolesSistema: { rol: string; descripcion: string }[] = [
    { rol: 'PROPIETARIO', descripcion: 'Control total del negocio. Acceso a todos los módulos, administración de equipo/roles y configuración del sistema.' },
    { rol: 'VENDEDOR', descripcion: 'Enfocado solo en ventas: Facturas, Cuentas por Cobrar y Clientes. No tiene acceso a inventario, compras ni administración.' },
    { rol: 'BODEGUERO', descripcion: 'Enfocado solo en mercadería: Abastecimiento, Productos, Categorías, Bodegas, Inventario, Proveedores y Kardex. No puede facturar ni ver clientes.' },
  ];

  ngOnInit() {
    const token = localStorage.getItem('dilo_token');
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');

    if (!token || !userStr) {
      this.cerrarSesionForzada(); 
      return; 
    }

    const textoBienvenida = '¡Hola! 👋 Soy **Zoe**, tu asistente virtual. ¿En qué módulo del sistema te puedo ayudar hoy?';
    this.chatMensajes = [
      { 
        role: 'assistant', 
        text: textoBienvenida,
        safeHtml: this.formatearMensaje(textoBienvenida)
      }
    ];

    this.usuarioLogueado = JSON.parse(userStr);
    
    this.rolUsuario = this.usuarioLogueado?.rol || 'PROPIETARIO';
    
    this.fotoPerfilUrl = this.usuarioLogueado?.fotoPerfil || null;
    const nombre = this.usuarioLogueado?.primerNombre || '';
    this.inicialesUsuario = nombre ? nombre.substring(0, 2).toUpperCase() : 'EC';
    
    this.negocioId = this.usuarioLogueado?.negocioId || this.usuarioLogueado?.idNegocio;

    if (this.negocioId) {
       this.cargarDatosNegocio();
       
       // Si es Bodeguero o Propietario, intentamos cargar alertas.
       if (this.rolUsuario === 'PROPIETARIO' || this.rolUsuario === 'BODEGUERO') {
           this.cargarAlertasCaducidad();
       }
       
       this.cargarContextoNegocioParaIA();
    }
  }

  tieneRol(rolesPermitidos: string[]): boolean {
    return rolesPermitidos.includes(this.rolUsuario);
  }

  /**
   * 🔥 Devuelve SOLO los módulos a los que el rol actual del usuario tiene
   * acceso (los mismos que se muestran en el sidebar vía tieneRol()).
   * Esto evita que la IA recomiende módulos que el usuario no puede ver.
   */
  private getModulosPermitidosTexto(): string {
    const accesibles = this.modulosSistema.filter(m => this.tieneRol(m.roles));
    return accesibles.map(m => `- ${m.nombre}: ${m.descripcion}`).join('\n      ');
  }

  private getModulosRestringidosTexto(): string {
    const restringidos = this.modulosSistema.filter(m => !this.tieneRol(m.roles));
    if (restringidos.length === 0) return 'Ninguno, este usuario tiene acceso a todo el sistema.';
    return restringidos.map(m => `${m.nombre} (solo ${m.roles.join(' / ')})`).join(', ');
  }

  private getResumenRolesTexto(): string {
    return this.rolesSistema.map(r => `- ${r.rol}: ${r.descripcion}`).join('\n      ');
  }

  cerrarSesionForzada() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('usuario');
    localStorage.removeItem('dilo_user');
    this.router.navigate(['/login']);
  }

  cargarDatosNegocio() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any>(`${this.apiUrl}/negocios/${this.negocioId}`, { headers })
      .subscribe({
        next: (data) => {
          setTimeout(() => {
            this.negocioNombre = data.nombreComercial || data.razonSocial || 'Mi Empresa';
          });
        },
        error: (err) => {
          console.error("Error cargando nombre del negocio:", err);
          // 🔥 AQUÍ ESTABA EL ERROR: Ya no cerramos sesión si es un 403 (falta de permisos).
          if (err.status === 401) {
            this.cerrarSesionForzada();
          } else if (err.status === 403) {
            this.negocioNombre = 'Mi Negocio'; // Valor por defecto si no tiene permisos para leerlo
          }
        }
      });
  }

  cargarAlertasCaducidad() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/dashboard/alertas-caducidad?dias=30`, { headers })
      .subscribe({
        next: (data) => {
          setTimeout(() => {
            this.alertasCaducidad = data || [];
          });
        },
        error: (err) => {
          console.error("Error cargando alertas:", err);
          // 🔥 AQUÍ TAMBIÉN ESTABA EL ERROR. 
          if (err.status === 401) {
            this.cerrarSesionForzada();
          }
          // Si es 403, simplemente ignora y no carga alertas, pero no bota al usuario.
        }
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
    this.cerrarSesionForzada();
  }

  cargarContextoNegocioParaIA() {
    if (!this.negocioId) return;

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
    const id = this.negocioId;

    // 🔥 catchError asegura que si un usuario no tiene permisos para alguna de estas tablas (403), devuelva un arreglo vacío y NO explote.
    const reqProductos   = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, { headers }).pipe(catchError(() => of([])));
    const reqCategorias  = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/categorias`, { headers }).pipe(catchError(() => of([])));
    const reqClientes    = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).pipe(catchError(() => of([])));
    const reqProveedores = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, { headers }).pipe(catchError(() => of([])));
    const reqInventario  = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).pipe(catchError(() => of([])));
    const reqFacturas    = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([])));

    forkJoin([reqProductos, reqCategorias, reqClientes, reqProveedores, reqInventario, reqFacturas])
      .subscribe(([productos, categorias, clientes, proveedores, inventario, facturas]) => {
        setTimeout(() => {
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

    const nombreUsuarioActual = this.usuarioLogueado?.primerNombre || 'el usuario';
    const modulosPermitidos = this.getModulosPermitidosTexto();
    const modulosRestringidos = this.getModulosRestringidosTexto();
    const resumenRoles = this.getResumenRolesTexto();

    const manualDelSistema = `
      Eres "Zoe", la asistente virtual del sistema de Facturación e Inventario "Dilo".
      Dilo es un sistema de facturación mediante voz.
      Tu personalidad es simpática, cercana y positiva, pero siempre profesional y precisa con los datos.
      Hablas con ${nombreUsuarioActual}, quien tiene el rol de **${this.rolUsuario}** en el negocio "${this.negocioNombre}".

      SISTEMA DE ROLES DE DILO (así funciona el control de acceso del negocio):
      ${resumenRoles}

      MÓDULOS DEL MENÚ QUE ${nombreUsuarioActual} PUEDE VER Y USAR AHORA (rol ${this.rolUsuario}):
      ${modulosPermitidos}

      MÓDULOS A LOS QUE ${nombreUsuarioActual} NO TIENE ACCESO CON SU ROL ACTUAL:
      ${modulosRestringidos}

      ${this.contextoNegocioTexto}

      ALERTAS DE CADUCIDAD (próximos 30 días): ${alertasTexto}

      FORMATO DE RESPUESTA (IMPORTANTE):
      - Usa **negrita** (con doble asterisco) solo para resaltar cifras, nombres de módulos o datos clave.
      - Si vas a dar varias opciones o pasos, usa una lista con líneas que empiecen en "- ".
      - Usa saltos de línea entre ideas para que no sea un bloque de texto plano.
      - Nunca muestres IDs internos, códigos de base de datos ni datos técnicos como negocioId, userId, etc. Refiérete siempre por nombre.

      REGLAS ESTRICTAS DE RESPUESTA:
      1. Sé MUY BREVE, directo y usa un tono amigable y simpático (puedes usar 1 emoji ocasional, sin abusar). Máximo 2 o 3 párrafos súper cortos.
      2. Si el usuario te pregunta cómo hacer algo, guíalo SOLO hacia módulos de la lista "MÓDULOS QUE PUEDE VER Y USAR AHORA". Nunca lo mandes a un módulo restringido para su rol.
      3. Si pregunta por algo de la lista de "MÓDULOS A LOS QUE NO TIENE ACCESO", explícale amablemente que esa función es exclusiva de otro rol (dile cuál: PROPIETARIO, VENDEDOR o BODEGUERO) y que debe pedírselo al Propietario del negocio si necesita ese permiso. No inventes que sí puede acceder.
      4. Si te pregunta "qué rol tengo", "qué puedo hacer" o similar, respóndele con base en el SISTEMA DE ROLES y sus módulos permitidos de arriba.
      5. Si un PROPIETARIO te pregunta sobre los roles de su equipo (qué puede hacer un Vendedor o un Bodeguero), sí puedes explicárselo usando el SISTEMA DE ROLES, ya que administra el negocio.
      6. Usa los DATOS REALES del negocio de arriba (productos, stock, clientes, proveedores, ventas) para responder con cifras exactas cuando te pregunten por su negocio. No inventes cifras que no estén ahí.
      7. Nunca inventes funciones que no estén en la lista de conocimientos.
      8. Preséntate como "Zoe" si te preguntan tu nombre, nunca como una IA genérica.
      9. Si pregunta quién eres, dile que eres la asistente "Zoe" del sistema Dilo, un sistema de facturación por voz.
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

  trackByMensaje(index: number, msg: any): number {
    return index;
  }
}