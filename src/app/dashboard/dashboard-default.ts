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

    // ── FIX: Zoe actualiza sus BehaviorSubject (chatMensajes$ / isChatLoading$)
    // fuera del ciclo de detección de cambios que esta vista capta automáticamente
    // (el mismo motivo por el que cargarDatosNegocio() y cargarAlertasCaducidad()
    // ya usan cdr.detectChanges() manualmente más abajo). Sin esto, el mensaje
    // nuevo queda guardado en el servicio pero no se pinta hasta el próximo ciclo
    // de CD que se dispare por otra vía (por eso "aparecía" recién al salir y volver).
    this.zoeService.chatMensajes$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.cdr.detectChanges();
      });

    this.zoeService.isChatLoading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.cdr.detectChanges();
      });

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
    // Catálogo de productos (hasta 25 para no saturar el prompt)
    const listaProductos = productos.slice(0, 25).map(p => {
      const costo = Number(p.costoPromedioActual ?? p.costoPromedio ?? 0).toFixed(2);
      const cat = p.categoriaNombre || p.categoria?.nombre || '';
      return `${p.nombre}${cat ? ' [' + cat + ']' : ''} (id:${p.id}, costo:$${costo})`;
    }).join('; ');
    const avisoMasProductos = productos.length > 25 ? ` ...(+${productos.length - 25} productos más en el catálogo)` : '';

    // Categorías
    const listaCategorias = categorias.slice(0, 15).map(c => c.nombre).filter(Boolean).join(', ') || 'Ninguna';

    // Mapa de stock por bodega + detección de stock bajo / cero
    const bodegasMap = new Map<string, { items: string[]; bajos: string[]; ceros: string[] }>();
    const bajosGlobal: string[] = [];
    const cerosGlobal: string[] = [];

    inventario.forEach(i => {
      const bodega = (i.bodegaNombre || 'Bodega Principal').trim();
      if (!bodegasMap.has(bodega)) {
        bodegasMap.set(bodega, { items: [], bajos: [], ceros: [] });
      }
      const entry = bodegasMap.get(bodega)!;
      const cant = Number(i.cantidadActual ?? 0);
      const min = Number(i.stockMinimo ?? 0);
      const nombreProd = i.productoNombre || 'Producto';
      const linea = `${nombreProd}: ${cant} uds (mín:${min})`;

      entry.items.push(linea);

      if (cant <= 0) {
        entry.ceros.push(`${nombreProd} (0 en ${bodega})`);
        cerosGlobal.push(`${nombreProd} → ${bodega}`);
      } else if (min > 0 && cant <= min) {
        entry.bajos.push(`${nombreProd}: ${cant}/${min} en ${bodega}`);
        bajosGlobal.push(`${nombreProd}: ${cant} uds (mín ${min}) → ${bodega}`);
      }
    });

    let inventarioPorBodegaTexto = '';
    if (bodegasMap.size === 0) {
      inventarioPorBodegaTexto = '\n       (Sin registros de inventario todavía)';
    } else {
      bodegasMap.forEach((data, bodega) => {
        const itemsSeguros = data.items.slice(0, 18);
        const avisoMas = data.items.length > 18 ? ` ...(+${data.items.length - 18} más)` : '';
        inventarioPorBodegaTexto += `\n       • ${bodega} (${data.items.length} productos): ${itemsSeguros.join(' | ')}${avisoMas}`;
        if (data.bajos.length) {
          inventarioPorBodegaTexto += `\n         ⚠ Stock bajo en esta bodega: ${data.bajos.slice(0, 8).join('; ')}`;
        }
        if (data.ceros.length) {
          inventarioPorBodegaTexto += `\n         ✖ Sin stock (0): ${data.ceros.slice(0, 8).join('; ')}`;
        }
      });
    }

    // Resumen explícito de faltantes / bajos (lo más útil para el usuario)
    let resumenFaltantes = '';
    if (cerosGlobal.length === 0 && bajosGlobal.length === 0) {
      resumenFaltantes = 'Ningún producto con stock 0 ni por debajo del mínimo según los datos cargados.';
    } else {
      if (cerosGlobal.length) {
        resumenFaltantes += `SIN STOCK (0 unidades): ${cerosGlobal.slice(0, 15).join('; ')}${cerosGlobal.length > 15 ? ` ...(+${cerosGlobal.length - 15} más)` : ''}. `;
      }
      if (bajosGlobal.length) {
        resumenFaltantes += `STOCK BAJO (≤ mínimo): ${bajosGlobal.slice(0, 15).join('; ')}${bajosGlobal.length > 15 ? ` ...(+${bajosGlobal.length - 15} más)` : ''}.`;
      }
    }

    const totalVentas = facturas.reduce((acc, f) => acc + Number(f.totalFactura || f.total || 0), 0);
    const nombresBodegas = bodegas.map(b => b.nombre).filter(Boolean).join(', ') || 'Ninguna registrada';
    const miembrosActivos = miembros.filter(m => m.estadoInvitacion !== 'PENDIENTE');
    const listaMiembros = miembrosActivos.map(m => `${m.nombreUsuario || m.primerNombre || 'Usuario'} (${m.rol})`).join(', ') || 'Solo el propietario';
    const totalPorCobrar = cuentasPorCobrar.reduce((acc, c) => acc + Number(c.saldoPendiente || 0), 0);

    const ruc = negocioInfo?.ruc || negocioInfo?.identificacion || '';
    const dir = negocioInfo?.direccion || '';

    return `
NEGOCIO: "${this.negocioNombre}"${ruc ? ` | RUC: ${ruc}` : ''}${dir ? ` | Dir: ${dir}` : ''}

BODEGAS REGISTRADAS: ${nombresBodegas}
Total productos en catálogo: ${productos.length}
Categorías: ${listaCategorias}

CATÁLOGO (muestra): ${listaProductos || 'Sin productos'}${avisoMasProductos}

STOCK POR BODEGA (cantidadActual y stockMinimo):
${inventarioPorBodegaTexto}

PRODUCTOS CON STOCK BAJO O CERO (lo que "falta" o está crítico):
${resumenFaltantes}

RESUMEN GENERAL:
- Clientes: ${clientes.length} | Proveedores: ${proveedores.length}
- Equipo: ${listaMiembros}
- Cuentas por cobrar: $${totalPorCobrar.toFixed(2)}
- Ventas históricas (suma facturas): $${totalVentas.toFixed(2)}
- Registros de inventario: ${inventario.length}
    `.trim();
  }

  enviarMensajeDesdeInput() {
    if (this.nuevoMensajeTexto.trim()) {
      this.zoeService.enviarMensaje(this.nuevoMensajeTexto, false); 
      this.nuevoMensajeTexto = '';
      this.scrollToBottom(); 
    }
  }
}