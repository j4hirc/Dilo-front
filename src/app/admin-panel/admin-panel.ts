import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

// Importamos los componentes
import { AdminNegocios } from './negocios/admin-negocios';
import { AdminUsuarios } from './usuarios/admin-usuarios';
import { AdminIva } from './iva/admin-iva';
import { AdminPerfil } from './perfil/admin-perfil'; 

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule, AdminNegocios, AdminUsuarios, AdminIva, AdminPerfil], 
  templateUrl: './admin-panel.html',
  styleUrls: ['./admin-panel.css']
})
export class AdminPanel implements OnInit {
  private router = inject(Router);

  // 🔥 Agregamos 'perfil' a los tipos de pestaña permitidos
  activeTab: 'negocios' | 'usuarios' | 'parametros' | 'perfil' = 'negocios';
  
  adminNombre: string = 'Super Admin';
  adminEmail: string = '';

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

  // 🔥 Ahora esta función acepta 'perfil'
  switchTab(tab: 'negocios' | 'usuarios' | 'parametros' | 'perfil') {
    this.activeTab = tab;
  }

  cerrarSesion() {
    localStorage.clear();
    this.router.navigate(['/login']);
  }
}