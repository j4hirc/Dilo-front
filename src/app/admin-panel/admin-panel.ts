import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
// 🔥 Importamos los nuevos componentes
import { AdminNegocios } from './negocios/admin-negocios';
import { AdminUsuarios } from './usuarios/admin-usuarios';
import { AdminIva } from './iva/admin-iva';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule, AdminNegocios, AdminUsuarios, AdminIva], // 🔥 Se declaran aquí
  templateUrl: './admin-panel.html',
  styleUrls: ['./admin-panel.css']
})
export class AdminPanel implements OnInit {
  private router = inject(Router);

  activeTab: 'negocios' | 'usuarios' | 'parametros' = 'negocios';
  adminNombre: string = 'Super Admin';
  adminEmail: string = '';

  ngOnInit() {
    const token = localStorage.getItem('dilo_token');
    const userStr = localStorage.getItem('usuario');

    if (!token || !userStr) {
      this.cerrarSesion();
      return;
    }

    const usuario = JSON.parse(userStr);
    this.adminNombre = usuario.primerNombre || usuario.nombre || 'Super Admin';
    this.adminEmail = usuario.email || '';
  }

  switchTab(tab: 'negocios' | 'usuarios' | 'parametros') {
    this.activeTab = tab;
  }

  cerrarSesion() {
    localStorage.clear();
    this.router.navigate(['/login']);
  }
}