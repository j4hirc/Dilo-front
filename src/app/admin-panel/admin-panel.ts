import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

// Importamos los componentes
import { AdminNegocios } from './negocios/admin-negocios';
import { AdminUsuarios } from './usuarios/admin-usuarios';
import { AdminIva } from './iva/admin-iva';
import { AdminPerfil } from './perfil/admin-perfil'; 
import { AdminParroquias } from './parroquias/admin-parroquias'; // 🔥 NUEVO

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule, AdminNegocios, AdminUsuarios, AdminIva, AdminPerfil, AdminParroquias], // 🔥 Agregado
  templateUrl: './admin-panel.html',
  styleUrls: ['./admin-panel.css']
})
export class AdminPanel implements OnInit {
  private router = inject(Router);

  // 🔥 Añadimos 'parroquias' a los tipos permitidos
  activeTab: 'negocios' | 'usuarios' | 'parametros' | 'perfil' | 'parroquias' = 'negocios';
  
  adminNombre: string = 'Super Admin';
  adminEmail: string = '';
  isMobileMenuOpen = false;

  ngOnInit() {
    this.cargarDatosUsuarioLocales();
  }

  cargarDatosUsuarioLocales() {
    const token = localStorage.getItem('dilo_token');
    const userStr = localStorage.getItem('usuario');

    if (!token || !userStr) {
      this.cerrarSesion();
      return;
    }

    const usuario = JSON.parse(userStr);
    this.adminNombre = `${usuario.primerNombre || 'Super'} ${usuario.apellidoPaterno || 'Admin'}`;
    this.adminEmail = usuario.email || '';
  }

  // 🔥 Ahora acepta 'parroquias'
  switchTab(tab: 'negocios' | 'usuarios' | 'parametros' | 'perfil' | 'parroquias') {
    this.activeTab = tab;
    this.isMobileMenuOpen = false;
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  cerrarSesion() {
    localStorage.clear();
    this.router.navigate(['/login']);
  }
}