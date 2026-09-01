import { Component, OnInit, inject, ChangeDetectorRef, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ZoeAiService } from './zoe-ai.service';
import Swal from 'sweetalert2';

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

  chatMinimizado = false;
  hintChatOculto = false;
  private hintAutoHideTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly modulosSistema = [
    { nombre: 'Dashboard', ruta: '/dashboard/propietario', roles: ['PROPIETARIO'], descripcion: 'Pantalla donde el usuario puede ver estadísticas: ventas del mes, facturas, clientes, etc.', disponible: true },
    { nombre: 'Categorías', ruta: '/dashboard/categorias', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Módulo para que el usuario cree, describa o edite las categorías.', disponible: true },
    { nombre: 'Bodegas', ruta: '/dashboard/bodegas', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Módulo para que el usuario gestione las ubicaciones y nombres de sus bodegas.', disponible: true },
    { nombre: 'Productos', ruta: '/dashboard/productos', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Catálogo donde el usuario registra, edita e ingresa sus productos.', disponible: true },
    { nombre: 'Proveedores', ruta: '/dashboard/proveedores', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Directorio donde el usuario guarda las empresas que abastecen su inventario.', disponible: true },
    { nombre: 'Abastecimiento', ruta: '/dashboard/compras', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Pantalla donde el usuario registra la nueva mercadería que llega a la bodega.', disponible: true },
    { nombre: 'Clientes', ruta: '/dashboard/clientes', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Directorio donde el usuario guarda a sus clientes.', disponible: true },
    { nombre: 'Facturas', ruta: '/dashboard/facturas', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Módulo donde el usuario hace facturas manuales o por voz.', disponible: true },
    { nombre: 'Cuentas por Cobrar', ruta: '/dashboard/cuentas-cobrar', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Sección donde el usuario revisa las cuotas y deudas pendientes.', disponible: true },
    { nombre: 'Inventario', ruta: '/dashboard/inventario', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Consulta general de stock de productos organizados por cada bodega.', disponible: true },
    { nombre: 'Movimientos (Kardex)', ruta: '/dashboard/kardex', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Historial donde el usuario ve las entradas, salidas y costos de mercadería.', disponible: true },
    { nombre: 'Rendimiento', ruta: '/dashboard/reportes', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Pantalla de métricas para que el usuario vea zonas de calor, demanda, top clientes, etc.', disponible: true },
    { nombre: 'Mi Equipo', ruta: '/dashboard/equipo', roles: ['PROPIETARIO'], descripcion: 'Módulo donde el usuario administra a las personas de su negocio y su código de acceso.', disponible: true },
    { nombre: 'Configuración', ruta: '/dashboard/configuracion', roles: ['PROPIETARIO'], descripcion: 'Formulario donde el usuario edita la información del negocio.', disponible: true },
    { nombre: 'Mi Perfil', ruta: '/dashboard/perfil', roles: ['PROPIETARIO', 'VENDEDOR', 'BODEGUERO'], descripcion: 'Ajustes de la cuenta del usuario actual.', disponible: true },
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
    
    let nombreCompleto = '';
    
    if (this.usuarioLogueado?.nombreUsuario) {
        nombreCompleto = this.usuarioLogueado.nombreUsuario;
    } else if (this.usuarioLogueado?.primerNombre) {
        nombreCompleto = this.usuarioLogueado.primerNombre + ' ' + (this.usuarioLogueado?.apellidoPaterno || '');
    } else if (this.usuarioLogueado?.nombre) {
        nombreCompleto = this.usuarioLogueado.nombre;
    }

    nombreCompleto = nombreCompleto.trim();

    if (nombreCompleto) {
        const partes = nombreCompleto.split(' ').filter(p => p.length > 0);
        
        if (partes.length >= 2) {
            this.inicialesUsuario = (partes[0].charAt(0) + partes[1].charAt(0)).toUpperCase();
        } else {
            this.inicialesUsuario = partes[0].substring(0, 2).toUpperCase();
        }
    } else {
        this.inicialesUsuario = 'US';
    }

    this.negocioId = this.usuarioLogueado?.negocioId || this.usuarioLogueado?.idNegocio;

    this.zoeService.inicializarChat(this.usuarioLogueado?.primerNombre || this.usuarioLogueado?.nombreUsuario || 'Usuario', this.rolUsuario);

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

    this.zoeService.actualizarContexto$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.negocioId) {
          this.cargarContextoNegocioParaIA();
        }
      });

    this.chatMinimizado = localStorage.getItem('dilo_chat_minimizado') === '1';
    this.hintChatOculto = localStorage.getItem('dilo_chat_hint_oculto') === '1';

    if (this.negocioId) {
       this.cargarDatosNegocio();
       if (this.rolUsuario === 'PROPIETARIO' || this.rolUsuario === 'BODEGUERO') {
           this.cargarAlertasCaducidad();
       }
       this.cargarContextoNegocioParaIA();
    }
  }

  minimizarChat() {
    if (this.zoeService.isChatOpen) this.zoeService.toggleChat();
    if (this.zoeService.isListening) this.zoeService.toggleEscucha();
    this.chatMinimizado = true;
    localStorage.setItem('dilo_chat_minimizado', '1');
  }

  restaurarChat() {
    this.chatMinimizado = false;
    localStorage.removeItem('dilo_chat_minimizado');
  }

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

  private inicioDiaZoe(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

private restarDiasZoe(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - n);
  return r;
}

private calcularVentasPorPeriodo(
  facturasOrdenadas: any[],
  dias: number,
  ahora: Date,
  obtenerFechaSaneada: (f: any) => Date,
  obtenerTotalFactura: (f: any) => number
): { total: number; cantidad: number; variacionPct: number } {
  const inicioPeriodo = this.inicioDiaZoe(this.restarDiasZoe(ahora, dias - 1));
  const inicioAnterior = this.inicioDiaZoe(this.restarDiasZoe(inicioPeriodo, dias));
  const finAnterior = this.inicioDiaZoe(this.restarDiasZoe(inicioPeriodo, 1));

  const facturasPeriodo = facturasOrdenadas.filter(f => {
    const d = obtenerFechaSaneada(f.fechaEmision || f.fecha || f.createdAt);
    return d >= inicioPeriodo && d <= ahora;
  });

  const facturasAnterior = facturasOrdenadas.filter(f => {
    const d = obtenerFechaSaneada(f.fechaEmision || f.fecha || f.createdAt);
    return d >= inicioAnterior && d <= finAnterior;
  });

  const total = facturasPeriodo.reduce((acc, f) => acc + obtenerTotalFactura(f), 0);
  const anterior = facturasAnterior.reduce((acc, f) => acc + obtenerTotalFactura(f), 0);
  const cantidad = facturasPeriodo.length;

  const variacionPct = anterior === 0
    ? (total > 0 ? 100 : 0)
    : Math.round(((total - anterior) / anterior) * 1000) / 10;

  return { total, cantidad, variacionPct };
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
          const mensajeError = err.error?.message || err.error?.error || (typeof err.error === 'string' ? err.error : err.message || '');
          const msjLower = mensajeError.toLowerCase();
          
          if (msjLower.includes('propietario') || msjLower.includes('negocio suspendido')) {
             Swal.fire({
                icon: 'warning',
                title: 'Negocio Suspendido',
                text: 'La cuenta del dueño de este negocio ha sido suspendida. ¿Deseas desvincularte para unirte a otro, o prefieres cerrar sesión?',
                showCancelButton: true,
                confirmButtonText: 'Sí, abandonar negocio',
                cancelButtonText: 'Cerrar sesión',
                confirmButtonColor: '#e53e3e',
                cancelButtonColor: '#64748b',
                allowOutsideClick: false
             }).then((result) => {
                if (result.isConfirmed) {
                     this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/abandonar`, {}, { headers: this.authHeaders })
                       .subscribe({
                         next: () => {
                           Swal.fire('Desvinculado', 'Has abandonado el negocio exitosamente.', 'success').then(() => {
                             const user = JSON.parse(localStorage.getItem('usuario') || '{}');
                             user.negocioId = null;
                             user.selectedBusinessId = null;
                             localStorage.setItem('usuario', JSON.stringify(user));
                             this.router.navigate(['/onboarding-business']);
                           });
                         },
                         error: () => {
                           Swal.fire('Error', 'No se pudo desvincular en este momento. Cerrando sesión...', 'error').then(() => {
                             this.cerrarSesionForzada();
                           });
                         }
                       });
                  } else {
                   this.cerrarSesionForzada();
                }
             });
          } 
          else if (msjLower.includes('suspendida') || err.status === 401 || err.status === 403) {
             Swal.fire({
                icon: 'error',
                title: 'Acceso Denegado',
                text: 'Tu acceso ha sido revocado o tu sesión expiró. Contacta al administrador.',
                confirmButtonColor: '#e53e3e',
                allowOutsideClick: false
             }).then(() => {
                this.cerrarSesionForzada();
             });
          } 
          else {
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
        const modulosPerm = modulosDisponiblesParaRol.map(m => `- ${m.nombre}: ${m.descripcion} (ruta: ${m.ruta})`).join('\n');
        
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
  const listaProductos = productos.slice(0, 40).map(p => {
    const costo = Number(p.costoPromedioActual ?? p.costoPromedio ?? 0).toFixed(2);
    const cat = p.categoriaNombre || p.categoria?.nombre || '';
    return `${p.nombre}${cat ? ' [' + cat + ']' : ''} (costo:$${costo})`;
  }).join('; ');
  const avisoMasProductos = productos.length > 40 ? ` ...(+${productos.length - 40} productos más en el catálogo)` : '';

  const listaCategorias = categorias.slice(0, 25).map(c => c.nombre).filter(Boolean).join(', ') || 'Ninguna';

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
      const itemsSeguros = data.items.slice(0, 30);
      const avisoMas = data.items.length > 30 ? ` ...(+${data.items.length - 30} más)` : '';
      inventarioPorBodegaTexto += `\n       • ${bodega} (${data.items.length} productos): ${itemsSeguros.join(' | ')}${avisoMas}`;
      if (data.bajos.length) {
        inventarioPorBodegaTexto += `\n         ⚠ Stock bajo en esta bodega: ${data.bajos.slice(0, 10).join('; ')}`;
      }
      if (data.ceros.length) {
        inventarioPorBodegaTexto += `\n         ✖ Sin stock (0): ${data.ceros.slice(0, 10).join('; ')}`;
      }
    });
  }

  let resumenFaltantes = '';
  if (cerosGlobal.length === 0 && bajosGlobal.length === 0) {
    resumenFaltantes = 'Ningún producto con stock 0 ni por debajo del mínimo según los datos cargados.';
  } else {
    if (cerosGlobal.length) {
      resumenFaltantes += `SIN STOCK (0 unidades): ${cerosGlobal.slice(0, 20).join('; ')}${cerosGlobal.length > 20 ? ` ...(+${cerosGlobal.length - 20} más)` : ''}. `;
    }
    if (bajosGlobal.length) {
      resumenFaltantes += `STOCK BAJO (≤ mínimo): ${bajosGlobal.slice(0, 20).join('; ')}${bajosGlobal.length > 20 ? ` ...(+${bajosGlobal.length - 20} más)` : ''}.`;
    }
  }

  // =================================================================================
  // ========== SECCIÓN DE VENTAS - LÓGICA DE 30 DÍAS ALINEADA CON REPORTES ==========
  // =================================================================================
  const cleanNumber = (val: any): number => {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    const parsed = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  };

  const obtenerTotalFactura = (f: any): number => {
    return cleanNumber(f.importeTotal ?? f.valorTotal ?? f.totalFactura ?? f.total ?? f.montoTotal ?? 0);
  };

  const obtenerFechaSaneada = (fechaRaw: any): Date => {
    if (!fechaRaw) return new Date(0);
    // Formato array Spring Boot: [2026, 8, 27]
    if (Array.isArray(fechaRaw) && fechaRaw.length >= 3) {
      const d = new Date(Number(fechaRaw[0]), Number(fechaRaw[1]) - 1, Number(fechaRaw[2]), 12, 0, 0);
      return isNaN(d.getTime()) ? new Date(0) : d;
    }
    
    const s = String(fechaRaw).trim();
    // Filtro ISO exacto para evitar el desfase de 5 horas a Ecuador
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
       const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12, 0, 0);
       return isNaN(d.getTime()) ? new Date(0) : d;
    }
    
    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date(0) : d;
  };

  // 1. Filtrar asegurándonos de ignorar las Anuladas
  const facturasValidas = [...facturas].filter(f => 
    f && (!f.estado || String(f.estado).toUpperCase() !== 'ANULADA') &&
         (!f.estadoSri || String(f.estadoSri).toUpperCase() !== 'ANULADA')
  );

  const facturasOrdenadas = facturasValidas.sort((a, b) => {
    const fechaA = obtenerFechaSaneada(a.fechaEmision || a.fecha || a.createdAt).getTime();
    const fechaB = obtenerFechaSaneada(b.fechaEmision || b.fecha || b.createdAt).getTime();
    return fechaB - fechaA;
  });

  const totalVentas = facturasOrdenadas.reduce((acc, f) => acc + obtenerTotalFactura(f), 0);
  const cantidadFacturas = facturasOrdenadas.length;
  const ticketPromedio = cantidadFacturas > 0 ? totalVentas / cantidadFacturas : 0;

  const ultimasFacturas = facturasOrdenadas.slice(0, 10).map(f => {
    const total = obtenerTotalFactura(f).toFixed(2);
    const cliente = f.clienteNombre || f.cliente?.nombre || f.nombreCliente || 'Cliente';
    const fechaRaw = f.fechaEmision || f.fecha || f.createdAt;
    const fechaSaneada = obtenerFechaSaneada(fechaRaw);
    const fechaCorta = fechaSaneada.getTime() > 0 
      ? fechaSaneada.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : '';
    const num = f.numeroFactura || f.numero || f.id || '';
    return `#${num} ${cliente} $${total}${fechaCorta ? ' (' + fechaCorta + ')' : ''}`;
  }).join(' | ');


   const ahoraRef = new Date();
  const hace30Dias = new Date(
    ahoraRef.getFullYear(),
    ahoraRef.getMonth(),
    ahoraRef.getDate() - 29,
    0, 0, 0, 0
  );

  const ventasUltimos30Dias = facturasOrdenadas
    .filter(f => obtenerFechaSaneada(f.fechaEmision || f.fecha || f.createdAt) >= hace30Dias)
    .reduce((acc, f) => acc + obtenerTotalFactura(f), 0);

  const periodosAConsultar = [7, 15, 30, 60, 90];
  const resumenPorPeriodo = periodosAConsultar.map(dias => {
    const r = this.calcularVentasPorPeriodo(facturasOrdenadas, dias, ahoraRef, obtenerFechaSaneada, obtenerTotalFactura);
    const signo = r.variacionPct > 0 ? '+' : '';
    return `Últimos ${dias} días: $${r.total.toFixed(2)} en ${r.cantidad} factura(s) (variación vs periodo anterior equivalente: ${signo}${r.variacionPct}%)`;
  }).join('\n     - ');
  // =================================================================================

  const totalPorCobrar = cuentasPorCobrar.reduce((acc, c) => acc + Number(c.saldoPendiente || 0), 0);

  const nombresBodegas = bodegas.map(b => b.nombre).filter(Boolean).join(', ') || 'Ninguna registrada';
  const miembrosActivos = miembros.filter(m => m.estadoInvitacion !== 'PENDIENTE');
  const listaMiembros = miembrosActivos.map(m => `${m.nombreUsuario || m.primerNombre || 'Usuario'} (${m.rol})`).join(', ') || 'Solo el propietario';

  const ruc = negocioInfo?.ruc || negocioInfo?.identificacion || '';
  const dir = negocioInfo?.direccion || '';

  return `
NEGOCIO: "${this.negocioNombre}"${ruc ? ` | RUC: ${ruc}` : ''}${dir ? ` | Dir: ${dir}` : ''}

=== VENTAS (datos reales del sistema) ===
- Total histórico de ventas: $${totalVentas.toFixed(2)} (${cantidadFacturas} facturas)
- Ticket promedio: $${ticketPromedio.toFixed(2)}
- Ventas de los últimos 30 días: $${ventasUltimos30Dias.toFixed(2)}
- Ventas por periodo (mismo cálculo que el módulo Rendimiento):
     - ${resumenPorPeriodo}
- Últimas facturas: ${ultimasFacturas || 'Sin facturas registradas'}
- Cuentas por cobrar pendientes: $${totalPorCobrar.toFixed(2)}

BODEGAS REGISTRADAS: ${nombresBodegas}
Total productos en catálogo: ${productos.length}
Categorías: ${listaCategorias}

CATÁLOGO (muestra de hasta 40): ${listaProductos || 'Sin productos'}${avisoMasProductos}

STOCK POR BODEGA (cantidadActual y stockMinimo):
${inventarioPorBodegaTexto}

PRODUCTOS CON STOCK BAJO O CERO:
${resumenFaltantes}

RESUMEN GENERAL:
- Clientes: ${clientes.length} | Proveedores: ${proveedores.length}
- Equipo: ${listaMiembros}
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