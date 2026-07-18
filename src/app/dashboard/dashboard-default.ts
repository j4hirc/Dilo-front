import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-dashboard-default',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet], // <-- IMPORTANTE: RouterOutlet
  templateUrl: './dashboard-default.html',
  styleUrls: ['./dashboard-default.css'] 
})
export class DashboardDefault implements OnInit {
  private router = inject(Router);
  
  usuarioLogueado: any;
  negocioId: number | null = null;

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    this.usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = this.usuarioLogueado?.negocioId;
  }

  cerrarSesion() {
    localStorage.clear();
    this.router.navigate(['/login']);
  }
}