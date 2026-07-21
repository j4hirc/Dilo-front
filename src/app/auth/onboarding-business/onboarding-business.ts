import { Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import Swal from 'sweetalert2'; // 🔥 Importamos SweetAlert2

@Component({
  selector: 'app-onboarding-business',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './onboarding-business.html',
  styleUrls: ['./onboarding-business.css']
})
export class OnboardingBusiness {
  private router = inject(Router);

  cerrarSesion() {
    // 🔥 Mostramos la alerta de confirmación
    Swal.fire({
      title: '¿Cerrar sesión?',
      text: "Tendrás que volver a ingresar tus credenciales para acceder.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444', // Rojo para la acción destructiva
      cancelButtonColor: '#94A3B8',  // Gris para cancelar
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar',
      reverseButtons: true // Invierte los botones (opcional, mejora UX en acciones críticas)
    }).then((result) => {
      if (result.isConfirmed) {
        // Si el usuario confirma, limpiamos los datos
        localStorage.removeItem('dilo_token');
        localStorage.removeItem('dilo_user');
        localStorage.removeItem('usuario');
        
        // Redirigimos al login
        this.router.navigate(['/login']);
      }
    });
  }
}