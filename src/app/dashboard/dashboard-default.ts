import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';

@Component({
  selector: 'app-dashboard-default',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './dashboard-default.html',
  styleUrls: ['./dashboard-default.css']
})
export class DashboardDefault implements OnInit {
  private router = inject(Router);
  
  negocioId: number | null = null;
  usuarioLogueado: any = null;
  isSidebarOpen = false; // 🔥 NUEVO: Controla si el menú está abierto en el celular

  ngOnInit() {
    const userStr = localStorage.getItem('usuario');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = this.usuarioLogueado?.negocioId;
  }

  // 🔥 NUEVO: Función para abrir/cerrar el menú en celulares
  toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  cerrarSesion() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }
}