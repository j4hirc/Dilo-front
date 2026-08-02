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

  private readonly modulosSistema: { nombre: string; roles: string[]; descripcion: string }[] = [
    { nombre: 'Dashboard (Propietario)', roles: ['PROPIETARIO'], descripcion: 'Gráficas y resumen general del negocio (ventas, stock, ganancias).' },
    { nombre: 'Facturas', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Registrar nuevas ventas, cobrar a clientes y emitir comprobantes (facturación tradicional y por voz).' },
    { nombre: 'Cuentas por Cobrar', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Ver y gestionar los saldos pendientes de clientes (crédito).' },
    { nombre: 'Abastecimiento', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Registrar compras de mercadería a proveedores.' },
    { nombre: 'Clientes', roles: ['PROPIETARIO', 'VENDEDOR'], descripcion: 'Directorio para registrar y consultar la información de los clientes.' },
    { nombre: 'Proveedores', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Directorio de empresas y contactos que abastecen al negocio.' },
    { nombre: 'Productos', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Catálogo de mercadería: precios (PVP), códigos, IVA (15%) y control de caducidad.' },
    { nombre: 'Categorías', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Organizar los productos por categoría.' },
    { nombre: 'Bodegas', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Creación de sucursales o cuartos de almacenamiento.' },
    { nombre: 'Inventario', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Stock actual por bodega y alertas de productos.' },
    { nombre: 'Kardex (Movimientos)', roles: ['PROPIETARIO', 'BODEGUERO'], descripcion: 'Historial contable detallado de entradas y salidas.' },
    { nombre: 'Mi Equipo', roles: ['PROPIETARIO'], descripcion: 'Agregar empleados/cajeros y cambiar roles.' },
    { nombre: 'Configuración', roles: ['PROPIETARIO'], descripcion: 'Cambiar Logo, RUC, y definir método de costeo.' },
    { nombre: 'Mi Perfil', roles: ['PROPIETARIO', 'VENDEDOR', 'BODEGUERO'], descripcion: 'Datos personales, foto y contraseña del usuario.' },
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

    this.zoeService.inicializarChat(this.usuarioLogueado?.primerNombre || 'Usuario', this.rolUsuario, this.negocioNombre);

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
      this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([])))
    ])
    .pipe(takeUntil(this.destroy$))
    .subscribe(([productos, categorias, clientes, proveedores, inventario, facturas]) => {
        this.contextoNegocioTexto = this.construirResumenDelNegocio(
          Array.isArray(productos) ? productos : [], Array.isArray(categorias) ? categorias : [],
          Array.isArray(clientes) ? clientes : [], Array.isArray(proveedores) ? proveedores : [],
          Array.isArray(inventario) ? inventario : [], Array.isArray(facturas) ? facturas : []
        );

        const modulosPerm = this.modulosSistema.filter(m => this.tieneRol(m.roles)).map(m => `- ${m.nombre}: ${m.descripcion}`).join('\n');
        const modulosRest = this.modulosSistema.filter(m => !this.tieneRol(m.roles)).map(m => `${m.nombre}`).join(', ');
        const resumenRoles = this.rolesSistema.map(r => `- ${r.rol}: ${r.descripcion}`).join('\n');
        const alertasStr = this.alertasCaducidad.slice(0, 10).map((a: any) => `${a.productoNombre} caduca el ${a.fechaCaducidad}`).join('; ');

        this.zoeService.actualizarContexto(
          this.contextoNegocioTexto, modulosPerm, modulosRest, resumenRoles,
          this.usuarioLogueado?.primerNombre || 'Usuario', this.rolUsuario, this.negocioNombre, alertasStr
        );
    });
  }

  construirResumenDelNegocio(productos: any[], categorias: any[], clientes: any[], proveedores: any[], inventario: any[], facturas: any[]): string {
    const nombresCategorias = categorias.map(c => c.nombre).filter(Boolean).join(', ') || 'Ninguna registrada';
    const listaProductos = productos.slice(0, 30).map(p => `${p.nombre} (PVP: $${Number(p.precioUnitario || 0).toFixed(2)})`).join('; ');

    const bodegasMap = new Map<string, string[]>();
    inventario.forEach(i => {
      const bodega = i.bodegaNombre || 'Bodega Principal';
      if (!bodegasMap.has(bodega)) bodegasMap.set(bodega, []);
      bodegasMap.get(bodega)!.push(`${i.productoNombre}: ${i.cantidadActual} unids`);
    });

    let inventarioPorBodegaTexto = '';
    bodegasMap.forEach((items, bodega) => { inventarioPorBodegaTexto += `\n       - ${bodega}: ${items.slice(0, 25).join(', ')}`; });

    const totalVentas = facturas.reduce((acc, f) => acc + Number(f.totalFactura || f.total || 0), 0);

    return `
      DATOS REALES DEL NEGOCIO "${this.negocioNombre}":
      - Categorías (${categorias.length}): ${nombresCategorias}.
      - Productos (${productos.length}): ${listaProductos}.
      - Existencias por Bodega: ${inventarioPorBodegaTexto || 'Sin stock'}
      - Clientes: ${clientes.length} | Proveedores: ${proveedores.length}
      - Total Histórico de Ventas: $${totalVentas.toFixed(2)} (${facturas.length} facturas emitidas).
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