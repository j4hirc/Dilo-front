import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Component({
  selector: 'app-dashboard-default',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './dashboard-default.html',
  styleUrls: ['./dashboard-default.css']
})
export class DashboardDefault implements OnInit {
  private router = inject(Router);
  private http = inject(HttpClient);
  
  negocioId: number | null = null;
  negocioNombre: string = 'Cargando...'; // 🔥 NUEVA VARIABLE PARA EL NOMBRE
  usuarioLogueado: any = null;
  isSidebarOpen = false;

  alertasCaducidad: any[] = [];
  showNotificaciones = false;
  showUserMenu = false; // 🔥 NUEVA VARIABLE PARA MENÚ DE USUARIO
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit() {
    const userStr = localStorage.getItem('usuario');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = this.usuarioLogueado?.negocioId;

    if (this.negocioId) {
       this.cargarDatosNegocio(); // 🔥 LLAMAMOS A LA NUEVA FUNCIÓN
       this.cargarAlertasCaducidad();
    }
  }

  // 🔥 NUEVA FUNCIÓN: Trae el nombre real del negocio
  cargarDatosNegocio() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any>(`${this.apiUrl}/negocios/${this.negocioId}`, { headers })
      .subscribe({
        next: (data) => {
          // Usa el nombre comercial, si no tiene, usa la razón social
          this.negocioNombre = data.nombreComercial || data.razonSocial || 'Mi Empresa';
        },
        error: (err) => {
          console.error("Error al cargar datos del negocio", err);
          this.negocioNombre = 'Mi Empresa';
        }
      });
  }

  cargarAlertasCaducidad() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/dashboard/alertas-caducidad?dias=30`, { headers })
      .subscribe({
        next: (data) => {
          this.alertasCaducidad = data || [];
        },
        error: (err) => console.error("Error al cargar alertas de caducidad", err)
      });
  }

  toggleNotificaciones() {
    this.showNotificaciones = !this.showNotificaciones;
    if (this.showNotificaciones) this.showUserMenu = false; // Cierra el otro menú
  }

  // 🔥 NUEVA FUNCIÓN: Menú desplegable del usuario
  toggleUserMenu() {
    this.showUserMenu = !this.showUserMenu;
    if (this.showUserMenu) this.showNotificaciones = false; // Cierra notificaciones
  }

  toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  cerrarSesion() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }
}