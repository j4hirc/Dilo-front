import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import Swal from 'sweetalert2'; // 🔥 Importamos SweetAlert2

@Component({
  selector: 'app-onboarding-business',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './onboarding-business.html',
  styleUrls: ['./onboarding-business.css']
})
export class OnboardingBusiness implements OnInit {
  private router = inject(Router);

  ngOnInit() {
    this.verificarNegocio();
  }

  verificarNegocio() {
    // Obtenemos los datos del usuario logueado
    const usuarioStr = localStorage.getItem('dilo_user') || localStorage.getItem('usuario');
    
    if (usuarioStr) {
      const usuario = JSON.parse(usuarioStr);
      
      // ⚠️ Cambia 'tieneNegocio' o 'idNegocio' por la propiedad real que devuelve tu backend
      if (usuario.tieneNegocio || usuario.idNegocio) {
        // Lo sacamos obligatoriamente a la vista principal
        this.router.navigate(['/dashboard']); // Ajusta esta ruta a donde debe ir
      }
    }
  }

  cerrarSesion() {
    Swal.fire({
      title: '¿Cerrar sesión?',
      text: "Tendrás que volver a ingresar tus credenciales para acceder.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444',
      cancelButtonColor: '#94A3B8',
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar',
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        localStorage.removeItem('dilo_token');
        localStorage.removeItem('dilo_user');
        localStorage.removeItem('usuario');
        
        this.router.navigate(['/login']);
      }
    });
  }
} 