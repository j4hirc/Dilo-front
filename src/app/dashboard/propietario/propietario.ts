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

      const facturasArray = Array.isArray(facData) ? facData : [];
      this.facturasEmitidas = facturasArray.length;
      this.ventasMes = facturasArray.reduce((acc, f) => acc + (f.totalFactura || f.total || 0), 0);
      
      this.facturas = facturasArray.slice(0, 4).map(f => ({
        numero: f.numeroFactura || 'S/N',
        cliente: f.clienteNombre || f.cliente?.nombre || 'Consumidor Final',
        tipo: f.formaPago || 'Manual',
        monto: f.totalFactura || f.total || 0,
        estado: f.estadoSri || 'Emitida'
      }));

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