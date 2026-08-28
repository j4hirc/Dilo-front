import { Component, OnInit, inject, ChangeDetectorRef, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { environment } from "../../../environments/environment";

@Component({
  selector: 'app-propietario',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './propietario.html',
  styleUrls: ['./propietario.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Propietario implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  facturas: any[] = [];
  productosBase: any[] = []; 
  productos: any[] = []; 
  terminoBusquedaInventario: string = '';

  equipo: any[] = [];
  negocio: any = null;
  
  ventasMes: number = 0;
  facturasEmitidas: number = 0;
  clientesActivos: number = 0;

  // ESTADOS DE CARGA INDEPENDIENTES
  isLoading = true; // Layout principal
  isLoadingVentas = true; // Tarjetas de ventas y facturas emitidas
  isLoadingClientes = true; // Tarjeta de clientes
  isLoadingInventario = true; // Lista de inventario
  isLoadingFacturas = true; // Lista de facturas recientes
  isLoadingEquipo = true; // Lista del equipo

  usuarioLogueado: any;
  negocioId: number | null = null;
  
  private apiUrl = environment.apiUrl;
  
  private searchSubject = new Subject<string>();
  private searchSubscription!: Subscription;

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    
    this.negocioId = this.usuarioLogueado?.negocioId || 
                     this.usuarioLogueado?.selectedBusinessId || 
                     this.usuarioLogueado?.idNegocio;
                     
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(term => {
      this.ejecutarBusqueda(term);
    });
                     
    if (this.negocioId) {
      this.cargarDatosDashboard(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
      
      Swal.fire({
        icon: 'warning',
        title: 'Sesión desactualizada',
        text: 'No logramos detectar tu negocio actual. Por favor, cierra sesión y vuelve a ingresar.',
        confirmButtonColor: '#ea580c',
        confirmButtonText: 'Ir al Login',
        allowOutsideClick: false
      }).then((result) => {
        if (result.isConfirmed) {
          this.cerrarSesion();
        }
      });
    }
  }

  ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
  }

  cargarDatosDashboard(id: number) {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    // 1. NEGOCIO
    this.http.get<any>(`${this.apiUrl}/negocios/${id}`, { headers }).pipe(catchError(() => of(null))).subscribe(negData => {
      this.negocio = negData;
      this.isLoading = false; 
      this.cdr.detectChanges();
    });

    // 2. EQUIPO
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).pipe(catchError(() => of([]))).subscribe(miemData => {
      const miembrosArray = Array.isArray(miemData) ? miemData : [];
      this.equipo = miembrosArray.slice(0, 3).map(miembro => {
        const nombreCompleto = miembro.nombreCompleto || miembro.nombreUsuario || 'Usuario';
        return {
          iniciales: nombreCompleto.substring(0, 2).toUpperCase(),
          nombre: nombreCompleto,
          rol: miembro.rolNombre || miembro.rol || 'Miembro',
          activo: miembro.estadoLaboral === 'ACTIVO' || miembro.estadoLaboral === 'Activo',
          fotoPerfil: miembro.fotoPerfil || null
        };
      });
      this.isLoadingEquipo = false; // <-- APAGAMOS LOADER
      this.cdr.detectChanges();
    });

    // 3. CLIENTES
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).pipe(catchError(() => of([]))).subscribe(cliData => {
      this.clientesActivos = Array.isArray(cliData) ? cliData.length : 0;
      this.isLoadingClientes = false; // <-- APAGAMOS LOADER
      this.cdr.detectChanges();
    });

    // 4. INVENTARIO
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).pipe(catchError(() => of([]))).subscribe(invData => {
      setTimeout(() => {
        const inventarioArray = Array.isArray(invData) ? invData : [];
        this.productosBase = inventarioArray.map(item => {
          const cantidad = Number(item.cantidadActual) || 0;
          return {
            nombre: item.productoNombre || item.producto?.nombre || 'Producto sin nombre',
            bodega: item.bodegaNombre || item.bodega?.nombre || 'Bodega Principal',
            cantidad: cantidad,
            porcentaje: cantidad > 0 ? Math.min(Math.round((cantidad / 100) * 100), 100) : 5 
          };
        });
        
        // ORDENAMIENTO CORREGIDO: De MAYOR a MENOR cantidad
        this.productosBase.sort((a, b) => b.cantidad - a.cantidad);
        this.productos = this.productosBase.slice(0, 6);
        
        this.isLoadingInventario = false; // <-- APAGAMOS LOADER
        this.cdr.detectChanges();
      }, 0);
    });

    // 5. FACTURAS
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([]))).subscribe(facData => {
      setTimeout(() => {
        const facturasArray = Array.isArray(facData) ? facData : [];
        
        const cleanNumber = (val: any): number => {
          if (val == null) return 0;
          if (typeof val === 'number') return val;
          const parsed = parseFloat(String(val).replace(/,/g, ''));
          return isNaN(parsed) ? 0 : parsed;
        };

        const obtenerTimestampSaneado = (fechaRaw: any): number => {
          if (!fechaRaw) return 0;
          if (Array.isArray(fechaRaw)) {
            return new Date(fechaRaw[0], (fechaRaw[1] || 1) - 1, fechaRaw[2] || 1, fechaRaw[3] || 0, fechaRaw[4] || 0, Math.floor(fechaRaw[5] || 0)).getTime();
          }
          const d = new Date(fechaRaw);
          return isNaN(d.getTime()) ? 0 : d.getTime();
        };

        const hace90DiasTime = new Date();
        hace90DiasTime.setDate(hace90DiasTime.getDate() - 90);
        hace90DiasTime.setHours(0, 0, 0, 0);
        const limite90 = hace90DiasTime.getTime();

        let ventasMes = 0;
        let facturasEmitidas = 0;
        const facturasValidasProcesadas: any[] = [];

        for (const f of facturasArray) {
          const estadoUpper = String(f.estado || '').toUpperCase();
          const estadoSriUpper = String(f.estadoSri || '').toUpperCase();
          
          if (estadoUpper !== 'ANULADA' && estadoSriUpper !== 'ANULADA') {
            const timestamp = obtenerTimestampSaneado(f.fechaEmision || f.fecha || f.createdAt);
            const total = cleanNumber(f.importeTotal ?? f.valorTotal ?? f.totalFactura ?? f.total ?? f.montoTotal ?? 0);
            
            facturasValidasProcesadas.push({ original: f, timestamp, total });

            if (timestamp >= limite90) {
              ventasMes += total;
              facturasEmitidas++;
            }
          }
        }

        this.ventasMes = ventasMes;
        this.facturasEmitidas = facturasEmitidas;
        
        facturasValidasProcesadas.sort((a, b) => b.timestamp - a.timestamp);

        this.facturas = facturasValidasProcesadas.slice(0, 4).map(fp => {
          const f = fp.original;
          return {
            numero: f.numeroFactura || 'S/N',
            cliente: f.clienteNombre || f.cliente?.nombre || 'Consumidor Final',
            tipo: f.formaPago || 'Manual',
            monto: fp.total,
            estado: f.estadoSri || 'Emitida'
          };
        });

        this.isLoadingVentas = false;   // <-- APAGAMOS LOADER
        this.isLoadingFacturas = false; // <-- APAGAMOS LOADER
        this.cdr.detectChanges(); 
      }, 50);
    });
  }

  onBuscarInventarioChange(termino: string) {
    this.terminoBusquedaInventario = termino;
    this.searchSubject.next(termino);
  }

  private ejecutarBusqueda(terminoOriginal: string) {
    if (!terminoOriginal.trim()) {
      this.productos = this.productosBase.slice(0, 6);
    } else {
      const term = terminoOriginal.toLowerCase().trim();
      this.productos = this.productosBase.filter(p => 
          p.nombre.toLowerCase().includes(term) || 
          p.bodega.toLowerCase().includes(term)
      ).slice(0, 15);
    }
    this.cdr.detectChanges();
  }

  cerrarSesion() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('dilo_user');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }
  
  trackByFactura(index: number, fac: any): string { return fac.numero; }
  trackByProducto(index: number, prod: any): string { return prod.nombre + prod.bodega; }
  trackByUsuario(index: number, user: any): string { return user.nombre; }
}