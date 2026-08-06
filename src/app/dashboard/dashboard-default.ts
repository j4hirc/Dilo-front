import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { environment } from '../../environments/environment';
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
  
  private destroy$ = new Subject<void>();

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

  /** Chat flotante minimizado (solo pestaña lateral) — no estorba */
  chatMinimizado = false;
  /** Burbuja de ayuda "¿Necesitas ayuda?" ocultada por el usuario */
  hintChatOculto = false;
  private hintAutoHideTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly modulosSistema = [
    { nombre: 'Dashboard', ruta: '/dashboard/propietario', roles: ['PROPIETARIO'], descripcion: 'Pantalla de inicio con resumen general del negocio.', disponible: true },
    { nombre: 'Facturas', ruta: '/dashboard/facturas', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Registrar nuevas ventas, cobrar a clientes y emitir comprobantes.', disponible: true },
    { nombre: 'Cuentas por Cobrar', ruta: '/dashboard/cuentas-cobrar', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Ver y gestionar los saldos pendientes de clientes a crédito.', disponible: true },
    { nombre: 'Abastecimiento', ruta: '/dashboard/compras', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Registrar compras de mercadería a proveedores.', disponible: true },
    { nombre: 'Clientes', ruta: '/dashboard/clientes', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Directorio para registrar y consultar clientes.', disponible: true },
    { nombre: 'Proveedores', ruta: '/dashboard/proveedores', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Directorio de empresas y contactos que abastecen al negocio.', disponible: true },
    { nombre: 'Productos', ruta: '/dashboard/productos', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Catálogo de mercadería.', disponible: true },
    { nombre: 'Categorías', ruta: '/dashboard/categorias', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Organizar los productos por categoría.', disponible: true },
    { nombre: 'Bodegas', ruta: '/dashboard/bodegas', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Creación y administración de sucursales o cuartos de almacenamiento.', disponible: true },
    { nombre: 'Inventario', ruta: '/dashboard/inventario', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Stock actual por bodega y valor total invertido.', disponible: true },
    { nombre: 'Movimientos (Kardex)', ruta: '/dashboard/kardex', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Historial contable detallado de movimientos de inventario.', disponible: true },
    { nombre: 'Mi Equipo', ruta: '/dashboard/equipo', roles: ['PROPIETARIO'], descripcion: 'Agregar empleados/cajeros mediante un código de invitación.', disponible: true },
    { nombre: 'Configuración', ruta: '/dashboard/configuracion', roles: ['PROPIETARIO'], descripcion: 'Editar los datos del negocio.', disponible: true },
    { nombre: 'Mi Perfil', ruta: '/dashboard/perfil', roles: ['PROPIETARIO', 'VENDEDOR', 'BODEGUERO'], descripcion: 'Ver y editar los datos personales del usuario.', disponible: true },
    { nombre: 'Rendimiento', ruta: '/dashboard/reportes', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Dashboard de rendimiento comercial: rachas de ventas, zonas de calor y comparativas.', disponible: true },
  ];

  private readonly rolesSistema = [
    { rol: 'PROPIETARIO', descripcion: 'Control total del negocio. Acceso a todos los módulos.' },
    { rol: 'VENDEDOR', descripcion: 'Enfocado solo en ventas y clientes. No tiene acceso a inventario.' },
    { rol: 'BODEGUERO', descripcion: 'Enfocado solo en mercadería e inventario. No puede facturar.' },
  ];

  private get authHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

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
    this.inicialesUsuario = nombre ? nombre.substring(0, 2).toUpperCase() : 'US';
    this.negocioId = this.usuarioLogueado?.negocioId || this.usuarioLogueado?.idNegocio;

    this.zoeService.inicializarChat(this.usuarioLogueado?.primerNombre || 'Usuario', this.rolUsuario);

    // Preferencias del chat flotante (no estorbar)
    this.chatMinimizado = localStorage.getItem('dilo_chat_minimizado') === '1';
    // Burbuja de VOZ: se mantiene visible para hablar con la IA (solo se oculta si el usuario pulsa ×)
    this.hintChatOculto = localStorage.getItem('dilo_chat_hint_oculto') === '1';

    if (this.negocioId) {
       this.cargarDatosNegocio();
       if (this.rolUsuario === 'PROPIETARIO' || this.rolUsuario === 'BODEGUERO') {
           this.cargarAlertasCaducidad();
       }
       this.cargarContextoNegocioParaIA();
    }
  }

  /** Minimiza el chat a una pestaña lateral (deja de estorbar) */
  minimizarChat() {
    if (this.zoeService.isChatOpen) this.zoeService.toggleChat();
    if (this.zoeService.isListening) this.zoeService.toggleEscucha();
    this.chatMinimizado = true;
    localStorage.setItem('dilo_chat_minimizado', '1');
  }

  /** Restaura el FAB del chat desde la pestaña minimizada */
  restaurarChat() {
    this.chatMinimizado = false;
    localStorage.removeItem('dilo_chat_minimizado');
  }

  /** Cierra la burbuja de ayuda y no la vuelve a mostrar en esta sesión / navegador */
  ocultarHintChat(event?: Event) {
    if (event) event.stopPropagation();
    this.hintChatOculto = true;
    localStorage.setItem('dilo_chat_hint_oculto', '1');
    if (this.hintAutoHideTimer) {
      clearTimeout(this.hintAutoHideTimer);
      this.hintAutoHideTimer = null;
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.hintAutoHideTimer) clearTimeout(this.hintAutoHideTimer);
    if (this.zoeService.isListening) {
      this.zoeService.toggleEscucha();
    }
  }

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

  cerrarSesion() {
    this.cerrarSesionForzada();
  }

  cargarDatosNegocio() {
    this.http.get<any>(`${this.apiUrl}/negocios/${this.negocioId}`, { headers: this.authHeaders })
      .pipe(takeUntil(this.destroy$))
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
    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/dashboard/alertas-caducidad?dias=30`, { headers: this.authHeaders })
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

    const id = this.negocioId;
    const opts = { headers: this.authHeaders };

    forkJoin([
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/categorias`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/bodegas`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, opts).pipe(catchError(() => of([]))),
      this.http.get<any[]>(`${this.apiUrl}/cuentas-por-cobrar/negocio/${id}`, opts).pipe(catchError(() => of([]))),
      this.http.get<any>(`${this.apiUrl}/negocios/${id}`, opts).pipe(catchError(() => of(null)))
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
        const modulosPerm = modulosDisponiblesParaRol.map(m => `- ${m.nombre} (ruta: ${m.ruta})`).join('\n');
        
        const modulosRest = this.modulosSistema
          .filter(m => m.disponible !== false && !this.tieneRol(m.roles))
          .map(m => m.nombre).join(', ');

        const modulosEnConstruccion = this.modulosSistema
          .filter(m => m.disponible === false)
          .map(m => m.nombre).join(', ') || 'Ninguno';

        const resumenRoles = this.rolesSistema.map(r => `- ${r.rol}`).join('\n');
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
        const itemsSeguros = items.slice(0, 10); 
        const avisoMas = items.length > 10 ? `...(+${items.length - 10} más)` : '';
        inventarioPorBodegaTexto += `\n       - ${bodega} (${items.length} prods totales): ${itemsSeguros.join(' | ')} ${avisoMas}`;
    });

    const totalVentas = facturas.reduce((acc, f) => acc + Number(f.totalFactura || f.total || 0), 0);
    const nombresBodegas = bodegas.map(b => b.nombre).filter(Boolean).join(', ') || 'Ninguna';
    const miembrosActivos = miembros.filter(m => m.estadoInvitacion !== 'PENDIENTE');
    const listaMiembros = miembrosActivos.map(m => `${m.nombreUsuario} (${m.rol})`).join(', ') || 'Solo propietario';
    const totalPorCobrar = cuentasPorCobrar.reduce((acc, c) => acc + Number(c.saldoPendiente || 0), 0);
    
    return `
      NEGOCIO: "${this.negocioNombre}"
      - Bodegas: ${nombresBodegas}
      - Catálogo Muestra: ${listaProductos}
      - STOCK BODEGAS: ${inventarioPorBodegaTexto || 'Vacío'}
      - Totales: ${clientes.length} Clientes | ${proveedores.length} Proveedores | ${miembros.length} Miembros: ${listaMiembros}
      - Finanzas: Cuentas por cobrar $${totalPorCobrar.toFixed(2)}. Ventas Históricas $${totalVentas.toFixed(2)}.
    `;
  }

  enviarMensajeDesdeInput() {
    if (this.nuevoMensajeTexto.trim()) {
      this.zoeService.enviarMensaje(this.nuevoMensajeTexto, false); 
      this.nuevoMensajeTexto = '';
      this.scrollToBottom(); 
    }
  }
}