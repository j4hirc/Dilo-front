import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { environment } from "../../../environments/environment";

@Component({
  selector: 'app-propietario',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './propietario.html',
  styleUrls: ['./propietario.css']
})
export class Propietario implements OnInit {
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

  isLoading = true;
  usuarioLogueado: any;
  negocioId: number | null = null;
  
  private apiUrl = environment.apiUrl;

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    
    this.negocioId = this.usuarioLogueado?.negocioId || 
                     this.usuarioLogueado?.selectedBusinessId || 
                     this.usuarioLogueado?.idNegocio;
                     
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

  cargarDatosDashboard(id: number) {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    const reqInventario = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).pipe(catchError(() => of([])));
    const reqMiembros = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).pipe(catchError(() => of([])));
    const reqFacturas = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([])));
    const reqNegocio = this.http.get<any>(`${this.apiUrl}/negocios/${id}`, { headers }).pipe(catchError(() => of(null)));
    const reqClientes = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).pipe(catchError(() => of([])));

    forkJoin([reqInventario, reqMiembros, reqFacturas, reqNegocio, reqClientes]).subscribe(([invData, miemData, facData, negData, cliData]) => {
      
      this.negocio = negData;

      // --- 1. INVENTARIO ---
      const inventarioArray = Array.isArray(invData) ? invData : [];
      this.productosBase = inventarioArray.map(item => {
        const cantidad = Number(item.cantidadActual) || 0;
        const porcentaje = Math.min(Math.round((cantidad / 100) * 100), 100); 

        return {
          nombre: item.productoNombre || item.producto?.nombre || 'Producto sin nombre',
          bodega: item.bodegaNombre || item.bodega?.nombre || 'Bodega Principal',
          cantidad: cantidad,
          porcentaje: porcentaje > 0 ? porcentaje : 5 
        };
      });
      
      this.productosBase.sort((a, b) => a.cantidad - b.cantidad);
      this.productos = this.productosBase.slice(0, 6);

      // --- 2. MIEMBROS ---
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

      // --- 3. FACTURAS Y VENTAS ---
      const facturasArray = Array.isArray(facData) ? facData : [];
      
      // Helpers para evitar bugs numéricos y de fechas
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
        if (Array.isArray(fechaRaw)) {
          return new Date(fechaRaw[0], (fechaRaw[1] || 1) - 1, fechaRaw[2] || 1, fechaRaw[3] || 0, fechaRaw[4] || 0, Math.floor(fechaRaw[5] || 0));
        }
        const d = new Date(fechaRaw);
        return isNaN(d.getTime()) ? new Date(0) : d;
      };

      // Excluimos las facturas anuladas
      const facturasValidas = facturasArray.filter(f => 
        f && (!f.estado || String(f.estado).toUpperCase() !== 'ANULADA') &&
             (!f.estadoSri || String(f.estadoSri).toUpperCase() !== 'ANULADA')
      );

      // --- CÁLCULO DE LOS ÚLTIMOS 90 DÍAS (Para el Dashboard Visual) ---
      const hace90Dias = new Date();
      hace90Dias.setDate(hace90Dias.getDate() - 90);
      hace90Dias.setHours(0, 0, 0, 0); // Desde el inicio de ese día

      // Filtramos facturas que se emitieron dentro de los últimos 90 días
      const facturasUltimos90Dias = facturasValidas.filter(f => {
         const d = obtenerFechaSaneada(f.fechaEmision || f.fecha || f.createdAt);
         return d >= hace90Dias;
      });

      // Sumamos y contamos para las tarjetas de arriba
      this.ventasMes = facturasUltimos90Dias.reduce((acc, f) => acc + obtenerTotalFactura(f), 0);
      this.facturasEmitidas = facturasUltimos90Dias.length;
      
      // Ordenamos las facturas recientes para la tabla (mostramos de las más nuevas a las más viejas)
      facturasValidas.sort((a, b) => {
        const fechaA = obtenerFechaSaneada(a.fechaEmision || a.fecha || a.createdAt).getTime();
        const fechaB = obtenerFechaSaneada(b.fechaEmision || b.fecha || b.createdAt).getTime();
        return fechaB - fechaA;
      });

      this.facturas = facturasValidas.slice(0, 4).map(f => ({
        numero: f.numeroFactura || 'S/N',
        cliente: f.clienteNombre || f.cliente?.nombre || 'Consumidor Final',
        tipo: f.formaPago || 'Manual',
        monto: obtenerTotalFactura(f),
        estado: f.estadoSri || 'Emitida'
      }));

      // --- 4. CLIENTES ---
      this.clientesActivos = Array.isArray(cliData) ? cliData.length : 0;

      this.isLoading = false;
      this.cdr.detectChanges();
    });
  }

  buscarInventario() {
      if (!this.terminoBusquedaInventario.trim()) {
          this.productos = this.productosBase.slice(0, 6);
          return;
      }
      
      const term = this.terminoBusquedaInventario.toLowerCase().trim();
      
      this.productos = this.productosBase.filter(p => 
          p.nombre.toLowerCase().includes(term) || 
          p.bodega.toLowerCase().includes(term)
      ).slice(0, 15);
  }

  cerrarSesion() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('dilo_user');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }
}