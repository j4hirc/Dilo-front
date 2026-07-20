import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http'; // 🔥 Agregado para peticiones HTTP

@Component({
  selector: 'app-dashboard-default',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './dashboard-default.html',
  styleUrls: ['./dashboard-default.css']
})
export class DashboardDefault implements OnInit {
  private router = inject(Router);
  private http = inject(HttpClient); // 🔥 Inyectamos HttpClient
  
  negocioId: number | null = null;
  usuarioLogueado: any = null;
  isSidebarOpen = false;

  // 🔥 NUEVAS VARIABLES PARA ALERTAS
  alertasCaducidad: any[] = [];
  showNotificaciones = false;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit() {
    const userStr = localStorage.getItem('usuario');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = this.usuarioLogueado?.negocioId;

    // 🔥 Cargamos las alertas si tenemos el ID del negocio
    if (this.negocioId) {
       this.cargarAlertasCaducidad();
    }
  }

  // 🔥 NUEVA FUNCIÓN: Consulta las alertas al backend
  cargarAlertasCaducidad() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    // Consultamos los lotes que vencen en los próximos 30 días
    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/dashboard/alertas-caducidad?dias=30`, { headers })
      .subscribe({
        next: (data) => {
          this.alertasCaducidad = data || [];
        },
        error: (err) => console.error("Error al cargar alertas de caducidad", err)
      });
  }

  // 🔥 NUEVA FUNCIÓN: Muestra/Oculta el menú de la campana
  toggleNotificaciones() {
    this.showNotificaciones = !this.showNotificaciones;
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