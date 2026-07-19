import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-propietario',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './propietario.html',
  styleUrls: ['./propietario.css']
})
export class Propietario implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  facturas: any[] = [];
  productos: any[] = [];
  equipo: any[] = [];
  negocio: any = null;
  
  ventasMes: number = 0;
  facturasEmitidas: number = 0;
  clientesActivos: number = 0; // 🔥 Aquí se guardará el total

  isLoading = true;
  usuarioLogueado: any;
  negocioId: number | null = null;
  
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = this.usuarioLogueado?.negocioId;
    
    if (this.negocioId) {
      this.cargarDatosDashboard(this.negocioId);
    } else {
      this.isLoading = false;
    }
  }

  cargarDatosDashboard(id: number) {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    // 🔥 Preparamos TODAS las peticiones (Agregamos la de clientes)
    const reqInventario = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).pipe(catchError(() => of([])));
    const reqMiembros = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).pipe(catchError(() => of([])));
    const reqFacturas = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([])));
    const reqNegocio = this.http.get<any>(`${this.apiUrl}/negocios/${id}`, { headers }).pipe(catchError(() => of(null)));
    const reqClientes = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).pipe(catchError(() => of([])));

    // 🔥 Ejecutamos las 5 al mismo tiempo
    forkJoin([reqInventario, reqMiembros, reqFacturas, reqNegocio, reqClientes]).subscribe(([invData, miemData, facData, negData, cliData]) => {
      
      this.negocio = negData;

      this.productos = invData.slice(0, 4).map(item => ({
        nombre: item.productoNombre || 'Producto sin nombre',
        cantidad: item.cantidadActual || 0,
        porcentaje: Math.min(Math.round((item.cantidadActual / 50) * 100), 100)
      }));

      this.equipo = miemData.slice(0, 3).map(miembro => {
        const nombreCompleto = miembro.nombreCompleto || miembro.nombreUsuario || 'Usuario';
        return {
          iniciales: nombreCompleto.substring(0, 2).toUpperCase(),
          nombre: nombreCompleto,
          rol: miembro.rolNombre || miembro.rol || 'Miembro',
          activo: miembro.estadoLaboral === 'ACTIVO' || miembro.estadoLaboral === 'Activo',
          fotoPerfil: miembro.fotoPerfil || null
        };
      });

      this.facturasEmitidas = facData.length;
      this.ventasMes = facData.reduce((acc, f) => acc + (f.totalFactura || f.total || 0), 0);
      
      this.facturas = facData.slice(0, 4).map(f => ({
        numero: f.numeroFactura || 'S/N',
        cliente: f.clienteNombre || f.cliente?.nombre || 'Consumidor Final',
        tipo: f.formaPago || 'Manual',
        monto: f.totalFactura || f.total || 0,
        estado: f.estadoSri || 'Emitida'
      }));

      // 🔥 ASIGNAMOS EL TOTAL DE CLIENTES
      this.clientesActivos = Array.isArray(cliData) ? cliData.length : 0;

      this.isLoading = false;
      this.cdr.detectChanges();
    });
  }

  cerrarSesion() {
    localStorage.clear();
    this.router.navigate(['/login']);
  }
}