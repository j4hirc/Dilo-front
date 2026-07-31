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

    // 🔥 Mensaje de bienvenida adaptado para invitar a los nuevos
    const textoBienvenida = '¡Hola! 👋 Soy **Zoe**, tu asistente virtual en Dilo. Si es tu primera vez aquí, solo pregúntame: *"¿Por dónde empiezo?"* y te guiaré paso a paso.\n\n¿En qué módulo del sistema te puedo ayudar hoy?';
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
       
       if (this.rolUsuario === 'PROPIETARIO' || this.rolUsuario === 'BODEGUERO') {
           this.cargarAlertasCaducidad();
       }
       
       this.cargarContextoNegocioParaIA();
    }
  }

  tieneRol(rolesPermitidos: string[]): boolean {
    return rolesPermitidos.includes(this.rolUsuario);
  }

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
          if (err.status === 401) {
            this.cerrarSesionForzada();
          } else if (err.status === 403) {
            this.negocioNombre = 'Mi Negocio'; 
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
          if (err.status === 401) {
            this.cerrarSesionForzada();
          }
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
    const nombresCategorias = categorias.map(c => c.nombre).filter(Boolean).join(', ') || 'Ninguna registrada';
    const totalProductos = productos.length;
    const listaProductos = productos.slice(0, 30).map(p =>
      `${p.nombre} (Cod: ${p.codigoPrincipal || 'S/C'}, PVP: $${Number(p.precioUnitario || 0).toFixed(2)}, IVA: ${p.grabaIva ? 'Sí' : 'No'})`
    ).join('; ') + (totalProductos > 30 ? '... (entre otros)' : '');

    const bodegasMap = new Map<string, string[]>();
    let stockCritico: string[] = [];
    let valorTotalInventario = 0;

    inventario.forEach(i => {
      const bodega = i.bodegaNombre || 'Bodega Principal';
      const prod = i.productoNombre || 'Producto Desconocido';
      const cant = Number(i.cantidadActual || 0);
      const min = Number(i.stockMinimo || 0);
      
      valorTotalInventario += Number(i.valorInventario || 0);

      if (!bodegasMap.has(bodega)) bodegasMap.set(bodega, []);
      bodegasMap.get(bodega)!.push(`${prod}: ${cant} unids`);

      if (cant <= min || cant === 0) {
        stockCritico.push(`${prod} en ${bodega} (Stock actual: ${cant}, Mínimo: ${min})`);
      }
    });

    let inventarioPorBodegaTexto = '';
    bodegasMap.forEach((items, bodega) => {
      inventarioPorBodegaTexto += `\n       - ${bodega}: ${items.slice(0, 25).join(', ')}${items.length > 25 ? '...' : ''}`;
    });
    if (!inventarioPorBodegaTexto) inventarioPorBodegaTexto = ' Sin stock registrado.';

    const stockCriticoTexto = stockCritico.length > 0 
      ? stockCritico.slice(0, 20).join('; ') 
      : 'No hay productos en estado crítico ni con stock en 0.';

    const nombresClientes = clientes.slice(0, 15).map(c => c.nombreCompleto || `${c.primerNombre || ''} ${c.apellidoPaterno || ''}`.trim()).filter(Boolean).join(', ');
    const nombresProveedores = proveedores.slice(0, 15).map(p => p.nombreComercial || p.razonSocial || p.nombre).filter(Boolean).join(', ');

    const totalFacturas = facturas.length;
    const totalVentas = facturas.reduce((acc, f) => acc + Number(f.totalFactura || f.total || 0), 0);
    
    const facturasCredito = facturas.filter(f => f.formaPago === 'TARJETA_CREDITO' || f.formaPago === 'CREDITO' || f.numeroCuotas > 0);
    const totalCredito = facturasCredito.reduce((acc, f) => acc + Number(f.totalFactura || f.total || 0), 0);

    const ultimasFacturas = facturas.slice(-10).reverse().map(f => {
      const fecha = f.fechaEmision ? new Date(f.fechaEmision).toLocaleDateString() : 'Reciente';
      const estado = f.estadoSri || 'Emitida';
      return `Fac #${f.numeroFactura || 'S/N'} (${fecha}) | Cliente: ${f.clienteNombre || f.cliente?.nombre || 'Consumidor Final'} | Total: $${Number(f.totalFactura || f.total || 0).toFixed(2)} | Pago: ${f.formaPago || 'No especificado'} | Estado: ${estado}`;
    }).join('\n       ');

    return `
      DATOS REALES Y ACTUALES DEL NEGOCIO "${this.negocioNombre}":
      
      📦 CATÁLOGO Y CATEGORÍAS:
      - Categorías Activas (${categorias.length}): ${nombresCategorias}.
      - Catálogo de Productos (${totalProductos} registrados): ${listaProductos}.

      🏢 INVENTARIO Y BODEGAS:
      - Valor total estimado del inventario: $${valorTotalInventario.toFixed(2)}.
      - Existencias agrupadas por Bodega: ${inventarioPorBodegaTexto}
      - 🚨 PRODUCTOS CRÍTICOS (Cero stock o bajo el mínimo): ${stockCriticoTexto}

      👥 CONTACTOS:
      - Clientes Registrados (${clientes.length}): ${nombresClientes || 'Ninguno aún'}.
      - Proveedores Registrados (${proveedores.length}): ${nombresProveedores || 'Ninguno aún'}.

      💰 VENTAS Y FACTURACIÓN:
      - Historial de transacciones: ${totalFacturas} facturas emitidas.
      - Ingresos Brutos Totales: $${totalVentas.toFixed(2)}.
      - Total vendido a Crédito / Cuotas (Cuentas por Cobrar): $${totalCredito.toFixed(2)} (en ${facturasCredito.length} facturas).
      - Detalle de las últimas 10 facturas:
       ${ultimasFacturas || 'Ninguna factura reciente.'}
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

    // 🔥 AQUI LE ENSEÑAMOS A ZOE CÓMO HACER EL ONBOARDING
    const manualDelSistema = `
      Eres "Zoe", la asistente virtual del sistema de Facturación e Inventario "Dilo".
      Dilo es un sistema de facturación mediante voz.
      Tu personalidad es simpática, cercana y positiva, pero siempre profesional y precisa con los datos.
      Hablas con ${nombreUsuarioActual}, quien tiene el rol de **${this.rolUsuario}** en el negocio "${this.negocioNombre}".

      SISTEMA DE ROLES DE DILO:
      ${resumenRoles}

      MÓDULOS DEL MENÚ QUE ${nombreUsuarioActual} PUEDE VER Y USAR AHORA:
      ${modulosPermitidos}

      MÓDULOS A LOS QUE NO TIENE ACCESO CON SU ROL ACTUAL:
      ${modulosRestringidos}

      ${this.contextoNegocioTexto}

      ALERTAS DE CADUCIDAD: ${alertasTexto}

      🔥 GUÍA DE INICIO (ONBOARDING) PARA NUEVOS USUARIOS 🔥
      Si el usuario te pregunta "¿Por dónde empiezo?", "Soy nuevo", o pide ayuda para configurar el sistema desde cero, explícale de forma MUY AMIGABLE esta ruta ideal de pasos (asegúrate de mostrarle solo los módulos a los que su rol tiene acceso):
      
      1. **Configuración**: Primero, en el menú lateral ve a Configuración para definir los datos de la empresa (RUC, IVA, Contabilidad).
      2. **Bodegas**: Crea al menos una bodega (ej. Bodega Principal) para saber dónde se guardarán las cosas.
      3. **Categorías**: Crea las categorías para organizar bien tu mercadería (ej. Lácteos, Ferretería).
      4. **Productos**: Registra tu catálogo de productos base (sus códigos y precios de venta).
      5. **Proveedores y Abastecimiento**: Registra a quién le compras, y luego usa "Abastecimiento" para ingresar la cantidad de stock real a tus bodegas.
      6. **Clientes**: Guarda a tus compradores frecuentes en el directorio.
      7. **Facturación**: ¡Ya estás listo! Ve a facturas para empezar a vender usando tu voz o de manera manual.

      REGLAS ESTRICTAS DE RESPUESTA:
      1. Sé MUY BREVE, directo y usa un tono amigable. Máximo 2 o 3 párrafos.
      2. Si te pide ayuda para empezar, enséñale la ruta de la "GUÍA DE INICIO" detallada arriba, adaptándola a su rol si es necesario.
      3. Usa **negrita** para resaltar los nombres de los módulos.
      4. Si pregunta por un módulo restringido, dile amablemente que es exclusivo del rol correspondiente.
      5. Usa los DATOS REALES del negocio de arriba para responder con exactitud.
      6. Preséntate como "Zoe" del sistema Dilo si te preguntan quién eres.
    `;

    const mensajeSistema = {
      role: 'system',
      content: manualDelSistema
    };

    const payload = {
      model: 'llama-3.1-8b-instant',
      messages: [mensajeSistema, ...historialMensajes], 
      temperature: 0.5, 
      max_tokens: 600 // Aumentamos un poquito para que alcance a dar el tutorial completo
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