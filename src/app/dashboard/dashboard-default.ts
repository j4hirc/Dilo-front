import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// 🔥 IMPORTAMOS NUESTRO CEREBRO DE IA
import { ZoeAiService } from './zoe-ai.service';

@Component({
  selector: 'app-dashboard-default',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './dashboard-default.html',
  styleUrls: ['./dashboard-default.css']
})
export class DashboardDefault implements OnInit, OnDestroy, AfterViewChecked {
  private router = inject(Router);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  
  public zoeService = inject(ZoeAiService); 
  
  // 🔥 Control para matar procesos y evitar que se trabe al cambiar de ruta
  private destroy$ = new Subject<void>();

  // 🔥 Elemento para el Auto-Scroll del chat
  @ViewChild('chatScroll') private chatScrollContainer!: ElementRef;
  
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

  nuevoMensajeTexto = '';

  // 🔥 FUENTE DE VERDAD ÚNICA de los módulos del dashboard.
  // "ruta" debe coincidir EXACTO con los routerLink reales del sidebar (dashboard-default.html)
  // para que Zoe nunca invente ni confunda una URL de navegación.
  // "disponible: false" = el módulo existe en el código pero aún no está terminado/enlazado
  // (ej. Reportes es solo un componente placeholder todavía sin ruta en el menú).
  private readonly modulosSistema: { nombre: string; ruta: string | null; roles: string[]; descripcion: string; disponible?: boolean }[] = [
    { nombre: 'Dashboard', ruta: '/dashboard/propietario', roles: ['PROPIETARIO'], descripcion: 'Pantalla de inicio con resumen general del negocio: ventas del mes, número de facturas emitidas, clientes activos y un vistazo rápido al inventario.' },
    { nombre: 'Facturas', ruta: '/dashboard/facturas', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Registrar nuevas ventas, cobrar a clientes y emitir comprobantes. Permite crear facturas de forma tradicional (formulario) o por voz, dictando los productos a un asistente de dictado.' },
    { nombre: 'Cuentas por Cobrar', ruta: '/dashboard/cuentas-cobrar', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Ver y gestionar los saldos pendientes de clientes a crédito: registrar abonos/pagos parciales y detectar cuentas vencidas.' },
    { nombre: 'Abastecimiento', ruta: '/dashboard/compras', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Registrar compras de mercadería a proveedores: elegir proveedor, bodega de ingreso, número de comprobante y, si aplica, fecha de caducidad del lote.' },
    { nombre: 'Clientes', ruta: '/dashboard/clientes', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Directorio para registrar y consultar clientes: cédula/DNI, nombres, correo, teléfono y dirección.' },
    { nombre: 'Proveedores', ruta: '/dashboard/proveedores', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Directorio de empresas y contactos que abastecen al negocio, organizados por categoría y con estado activo/inactivo.' },
    { nombre: 'Productos', ruta: '/dashboard/productos', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Catálogo de mercadería: nombre, código, marca, precio (PVP), categoría, si graba IVA (15%) y si el producto maneja control de caducidad.' },
    { nombre: 'Categorías', ruta: '/dashboard/categorias', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Organizar los productos por categoría (nombre y descripción de cada una).' },
    { nombre: 'Bodegas', ruta: '/dashboard/bodegas', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Creación y administración de sucursales o cuartos de almacenamiento del negocio.' },
    { nombre: 'Inventario', ruta: '/dashboard/inventario', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Stock actual por bodega, valor total invertido y detalle de lotes por producto (incluye alertas de próxima caducidad).' },
    { nombre: 'Movimientos (Kardex)', ruta: '/dashboard/kardex', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Historial contable detallado de movimientos de inventario: ingresos, salidas y transferencias entre bodegas, con filtros por producto, tipo, bodega y fecha. En el menú aparece como "Movimientos".' },
    { nombre: 'Mi Equipo', ruta: '/dashboard/equipo', roles: ['PROPIETARIO'], descripcion: 'Agregar empleados/cajeros mediante un código de invitación/acceso del negocio, revisar solicitudes de ingreso y cambiar roles del personal.' },
    { nombre: 'Configuración', ruta: '/dashboard/configuracion', roles: ['PROPIETARIO'], descripcion: 'Editar los datos del negocio: RUC, razón social, nombre comercial, logo, dirección, si es obligado a llevar contabilidad y el método de costeo de inventario.' },
    { nombre: 'Mi Perfil', ruta: '/dashboard/perfil', roles: ['PROPIETARIO', 'VENDEDOR', 'BODEGUERO'], descripcion: 'Ver y editar los datos personales del usuario, su foto de perfil y cambiar la contraseña.' },
    { nombre: 'Reportes', ruta: null, roles: ['PROPIETARIO', 'VENDEDOR', 'BODEGUERO'], descripcion: 'Módulo de reportes del negocio.', disponible: false },
  ];

  private readonly rolesSistema: { rol: string; descripcion: string }[] = [
    { rol: 'PROPIETARIO', descripcion: 'Control total del negocio. Acceso a todos los módulos.' },
    { rol: 'VENDEDOR', descripcion: 'Enfocado solo en ventas y clientes. No tiene acceso a inventario.' },
    { rol: 'BODEGUERO', descripcion: 'Enfocado solo en mercadería e inventario. No puede facturar.' },
  ];

  ngOnInit() {
    const token = localStorage.getItem('dilo_token');
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');

    if (!token || !userStr) {
      this.cerrarSesionForzada(); 
      return; 
    }

    this.usuarioLogueado = JSON.parse(userStr);
    this.rolUsuario = this.usuarioLogueado?.rol || 'PROPIETARIO';
    this.fotoPerfilUrl = this.usuarioLogueado?.fotoPerfil || null;
    const nombre = this.usuarioLogueado?.primerNombre || '';
    this.inicialesUsuario = nombre ? nombre.substring(0, 2).toUpperCase() : 'EC';
    this.negocioId = this.usuarioLogueado?.negocioId || this.usuarioLogueado?.idNegocio;

    this.zoeService.inicializarChat(this.usuarioLogueado?.primerNombre || 'Usuario', this.rolUsuario);

    if (this.negocioId) {
       this.cargarDatosNegocio();
       if (this.rolUsuario === 'PROPIETARIO' || this.rolUsuario === 'BODEGUERO') {
           this.cargarAlertasCaducidad();
       }
       this.cargarContextoNegocioParaIA();
    }
  }

  // 🔥 MATA TODOS LOS PROCESOS PARA QUE NO SE TRABE AL CAMBIAR DE PANTALLA
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    // Apagamos el micrófono si quedó abierto
    if (this.zoeService.isListening) {
      this.zoeService.toggleEscucha();
    }
  }

  // 🔥 MAGIA: Auto-Scroll suave cada vez que la vista cambia (nuevo mensaje)
  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    try {
      if (this.chatScrollContainer) {
        this.chatScrollContainer.nativeElement.scrollTop = this.chatScrollContainer.nativeElement.scrollHeight;
      }
    } catch(err) { }
  }

  tieneRol(rolesPermitidos: string[]): boolean {
    return rolesPermitidos.includes(this.rolUsuario);
  }

  cerrarSesionForzada() {
    if (this.zoeService.isListening) this.zoeService.toggleEscucha();
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
      .pipe(takeUntil(this.destroy$)) // 🔥 Se detiene si cambias de página
      .subscribe({
        next: (data) => {
          this.negocioNombre = data.nombreComercial || data.razonSocial || 'Mi Empresa';
          this.cdr.detectChanges();
        },
        error: (err) => {
          if (err.status === 401) this.cerrarSesionForzada();
          else if (err.status === 403) {
            this.negocioNombre = 'Mi Negocio'; 
            this.cdr.detectChanges();
          }
        }
      });
  }

  cargarAlertasCaducidad() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/dashboard/alertas-caducidad?dias=30`, { headers })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.alertasCaducidad = data || [];
          this.cdr.detectChanges();
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

 cargarContextoNegocioParaIA() {
    if (!this.negocioId) return;

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
    const id = this.negocioId;

    forkJoin([
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/categorias`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/bodegas`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/cuentas-por-cobrar/negocio/${id}`, { headers }).pipe(catchError(() => of([]))),
      this.http.get<any>(`${this.apiUrl}/negocios/${id}`, { headers }).pipe(catchError(() => of(null)))
    ])
    .pipe(takeUntil(this.destroy$))
    .subscribe(([productos, categorias, clientes, proveedores, inventario, facturas, bodegas, miembros, cuentasPorCobrar, negocioInfo]) => {
        this.contextoNegocioTexto = this.construirResumenDelNegocio(
          Array.isArray(productos) ? productos : [], Array.isArray(categorias) ? categorias : [],
          Array.isArray(clientes) ? clientes : [], Array.isArray(proveedores) ? proveedores : [],
          Array.isArray(inventario) ? inventario : [], Array.isArray(facturas) ? facturas : [],
          Array.isArray(bodegas) ? bodegas : [], Array.isArray(miembros) ? miembros : [],
          Array.isArray(cuentasPorCobrar) ? cuentasPorCobrar : [], negocioInfo
        );

        if (negocioInfo?.nombreComercial || negocioInfo?.razonSocial) {
          this.negocioNombre = negocioInfo.nombreComercial || negocioInfo.razonSocial;
          this.cdr.detectChanges();
        }

        const modulosDisponiblesParaRol = this.modulosSistema.filter(m => m.disponible !== false && this.tieneRol(m.roles));

        // 🔥 FIX ANTICOLAPSO 1: Quitamos m.descripcion. Zoe ya sabe deducir qué hace cada pantalla por su nombre.
        const modulosPerm = modulosDisponiblesParaRol
          .map(m => `- ${m.nombre} (ruta: ${m.ruta})`)
          .join('\n');

        const modulosRest = this.modulosSistema
          .filter(m => m.disponible !== false && !this.tieneRol(m.roles))
          .map(m => m.nombre).join(', ');

        const modulosEnConstruccion = this.modulosSistema
          .filter(m => m.disponible === false)
          .map(m => m.nombre).join(', ') || 'Ninguno';

        const resumenRoles = this.rolesSistema.map(r => `- ${r.rol}`).join('\n');
        
        // 🔥 FIX ANTICOLAPSO 2: Máximo 3 alertas para no gastar tokens
        const alertasStr = this.alertasCaducidad.slice(0, 3).map((a: any) => `${a.productoNombre} caduca ${a.fechaCaducidad}`).join('; ');

        const rutasNavegables = modulosDisponiblesParaRol.map(m => ({ nombre: m.nombre, ruta: m.ruta as string }));

        this.zoeService.actualizarContexto(
          this.contextoNegocioTexto, modulosPerm, modulosRest, resumenRoles,
          this.usuarioLogueado?.primerNombre || 'Usuario', this.rolUsuario, this.negocioNombre, alertasStr,
          rutasNavegables, modulosEnConstruccion
        );
    });
  } 

  construirResumenDelNegocio(
    productos: any[], categorias: any[], clientes: any[], proveedores: any[],
    inventario: any[], facturas: any[], bodegas: any[], miembros: any[],
    cuentasPorCobrar: any[], negocioInfo: any
  ): string {
    const nombresCategorias = categorias.map(c => c.nombre).filter(Boolean).join(', ') || 'Ninguna registrada';
    
    // 🔥 FIX ANTICOLAPSO 3: Reducimos a máximo 10 productos como muestra general
    const listaProductos = productos.slice(0, 10).map(p => `${p.nombre} (Costo: $${Number(p.costoPromedioActual || p.costoPromedio || 0).toFixed(2)})`).join('; ');

    const bodegasMap = new Map<string, string[]>();
    
    inventario.forEach(i => {
      const bodega = i.bodegaNombre || 'Bodega Principal';
      if (!bodegasMap.has(bodega)) bodegasMap.set(bodega, []);
      
      const prod = productos.find(p => p.id === i.productoId || p.id === i.producto?.id);
      const costo = prod ? Number(prod.costoPromedioActual || prod.costoPromedio || 0).toFixed(2) : '0.00';

      bodegasMap.get(bodega)!.push(`${i.productoNombre}: ${i.cantidadActual} uds disp. (Costo: $${costo})`);
    });

    let inventarioPorBodegaTexto = '';
    bodegasMap.forEach((items, bodega) => {
        // 🔥 FIX ANTICOLAPSO 4: Muestra solo los primeros 10 productos por bodega, si hay más, pone una alerta simple.
        const itemsSeguros = items.slice(0, 10); 
        const avisoMas = items.length > 10 ? `...(+${items.length - 10} más)` : '';
        
        inventarioPorBodegaTexto += `\n       - ${bodega} (${items.length} prods totales): ${itemsSeguros.join(' | ')} ${avisoMas}`;
    });

    const totalVentas = facturas.reduce((acc, f) => acc + Number(f.totalFactura || f.total || 0), 0);
    const contabilidadTexto = negocioInfo?.obligadoContabilidad ? 'SÍ' : 'NO';
    const nombresBodegas = bodegas.map(b => b.nombre).filter(Boolean).join(', ') || 'Ninguna';
    const miembrosActivos = miembros.filter(m => m.estadoInvitacion !== 'PENDIENTE');
    const listaMiembros = miembrosActivos.map(m => `${m.nombreUsuario} (${m.rol})`).join(', ') || 'Solo propietario';
    const totalPorCobrar = cuentasPorCobrar.reduce((acc, c) => acc + Number(c.saldoPendiente || 0), 0);
    
    // 🔥 FIX ANTICOLAPSO 5: Redacción ultracorta para ahorrar tokens
    return `
      NEGOCIO: "${this.negocioNombre}"
      - Bodegas: ${nombresBodegas}
      - Catálogo Muestra: ${listaProductos}
      - STOCK BODEGAS: ${inventarioPorBodegaTexto || 'Vacío'}
      - Totales: ${clientes.length} Clientes | ${proveedores.length} Proveedores | ${miembros.length} Miembros: ${listaMiembros}
      - Finanzas: Cuentas por cobrar $${totalPorCobrar.toFixed(2)}. Ventas Históricas $${totalVentas.toFixed(2)}.
    `;
  }
  cerrarSesion() {
    this.cerrarSesionForzada();
  }

  enviarMensajeDesdeInput() {
    if (this.nuevoMensajeTexto.trim()) {
      this.zoeService.enviarMensaje(this.nuevoMensajeTexto, false); 
      this.nuevoMensajeTexto = '';
      this.scrollToBottom(); // Fuerzo el scroll cuando envías el mensaje
    }
  }
}