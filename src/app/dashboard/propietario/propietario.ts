import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../auth/auth.service';
import { Router, RouterLink } from '@angular/router'; // Importamos el Router

@Component({
  selector: 'app-propietario',
  standalone: true,
  imports: [CommonModule, RouterLink], // Agregamos RouterLink
  templateUrl: './propietario.html',
  styleUrls: ['./propietario.css']
})
export class Propietario implements OnInit {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private router = inject(Router); // Inyectamos para navegar

  facturas: any[] = [];
  productos: any[] = [];
  equipo: any[] = [];
  
  ventasMes: number = 0;
  facturasEmitidas: number = 0;
  clientesActivos: number = 0;
  pedidosVoz: number = 0;

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

    // 1. CARGAR INVENTARIO (CORREGIDO)
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).subscribe({
      next: (data) => {
        console.log("🛠 Mapeando inventario:", data);
        this.productos = data.slice(0, 4).map(item => {
          // OJO: Usamos 'productoNombre' que es el campo real que llega del API
          return {
            nombre: item.productoNombre || 'Producto sin nombre',
            cantidad: item.cantidadActual || 0,
            porcentaje: Math.min(Math.round((item.cantidadActual / 50) * 100), 100)
          };
        });
      },
      error: (err) => console.error('Error inventario:', err)
    });

    // 2. CARGAR EQUIPO
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).subscribe({
      next: (data) => {
        this.equipo = data.slice(0, 3).map(miembro => {
          // Usamos 'nombreCompleto' que viene directo en el objeto miembro
          const nombreCompleto = miembro.nombreCompleto || 'Usuario';
          return {
            iniciales: nombreCompleto.substring(0, 2).toUpperCase(),
            nombre: nombreCompleto,
            rol: miembro.rolNombre || 'Miembro',
            activo: miembro.estadoLaboral === 'Activo',
            color: this.getRandomColor()
          };
        });
      },
      error: (err) => console.error('Error equipo:', err)
    });

    // 3. CARGAR FACTURAS
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).subscribe({
      next: (data) => {
        this.facturasEmitidas = data.length;
        this.ventasMes = data.reduce((acc, f) => acc + (f.totalFactura || 0), 0);
        
        this.facturas = data.slice(0, 4).map(f => ({
          numero: f.numeroFactura,
          cliente: f.clienteNombre || 'Consumidor Final',
          tipo: f.formaPago || 'Manual',
          monto: f.totalFactura || 0,
          estado: f.estadoSri || 'Emitida'
        }));
        this.isLoading = false;
      },
      error: (err) => console.error('Error facturas:', err)
    });
  }

  getRandomColor(): string {
    const colors = ['#1e3a8a', '#312e81', '#172a46', '#ea580c', '#0f172a'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // MÉTODO PARA CERRAR SESIÓN
  cerrarSesion() {
    localStorage.clear();
    this.router.navigate(['/login']);
  }
}