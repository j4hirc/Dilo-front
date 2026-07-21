import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import Swal from 'sweetalert2'; // 🔥 Importamos SweetAlert para avisar si algo falla

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
  clientesActivos: number = 0;

  isLoading = true;
  usuarioLogueado: any;
  negocioId: number | null = null;
  
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit(): void {
    // 🔥 1. BÚSQUEDA A PRUEBA DE BALAS EN LOCALSTORAGE
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    
    // 🔥 2. BUSCAMOS EL ID EN TODAS LAS VARIABLES POSIBLES
    this.negocioId = this.usuarioLogueado?.negocioId || 
                     this.usuarioLogueado?.selectedBusinessId || 
                     this.usuarioLogueado?.idNegocio;
                     
    console.log("👀 Datos de sesión en Dashboard:", this.usuarioLogueado);
    console.log("🔥 ID del Negocio detectado:", this.negocioId);
    
    if (this.negocioId) {
      this.cargarDatosDashboard(this.negocioId);
    } else {
      console.error("🚨 CRÍTICO: No se encontró el ID del negocio en el Dashboard.");
      this.isLoading = false;
      this.cdr.detectChanges();
      
      // 🔥 3. SI FALLA, LE AVISAMOS AL USUARIO EN VEZ DE DEJARLO EN BLANCO
      Swal.fire({
        icon: 'warning',
        title: 'Sesión desactualizada',
        text: 'No logramos detectar tu negocio actual. Por favor, cierra sesión y vuelve a ingresar.',
        confirmButtonColor: '#ed8936',
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

    // 🔥 Preparamos TODAS las peticiones (Atrapando errores para que no colapse)
    const reqInventario = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).pipe(catchError(() => of([])));
    const reqMiembros = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).pipe(catchError(() => of([])));
    const reqFacturas = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).pipe(catchError(() => of([])));
    const reqNegocio = this.http.get<any>(`${this.apiUrl}/negocios/${id}`, { headers }).pipe(catchError(() => of(null)));
    const reqClientes = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).pipe(catchError(() => of([])));

    // 🔥 Ejecutamos las 5 al mismo tiempo
    forkJoin([reqInventario, reqMiembros, reqFacturas, reqNegocio, reqClientes]).subscribe(([invData, miemData, facData, negData, cliData]) => {
      
      console.log("✅ Datos recibidos del backend:", { invData, miemData, facData, negData, cliData });

      this.negocio = negData;

      // Mapeo de inventario (aseguramos que sea un array)
      const inventarioArray = Array.isArray(invData) ? invData : [];
      this.productos = inventarioArray.slice(0, 4).map(item => ({
        nombre: item.productoNombre || 'Producto sin nombre',
        cantidad: item.cantidadActual || 0,
        porcentaje: Math.min(Math.round((item.cantidadActual / 50) * 100), 100)
      }));

      // Mapeo de equipo (aseguramos que sea un array)
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

      // Mapeo de facturas (aseguramos que sea un array)
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

      // 🔥 ASIGNAMOS EL TOTAL DE CLIENTES
      this.clientesActivos = Array.isArray(cliData) ? cliData.length : 0;

      this.isLoading = false;
      this.cdr.detectChanges();
    });
  }

  cerrarSesion() {
    // 🔥 Limpieza profunda de sesión
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('dilo_user');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }
}