import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../auth.service';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2'; // <-- OBLIGATORIO PARA LAS ALERTAS

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, CommonModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  isLoading = false;
  showPassword = false;

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  onSubmit() {
    // Si el formulario no es válido, disparamos el SweetAlert y detenemos todo
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      Swal.fire({
        icon: 'warning',
        title: 'Faltan datos',
        text: 'Por favor ingresa tu correo electrónico y tu contraseña.',
        confirmButtonColor: '#ed8936'
      });
      return;
    }

    this.isLoading = true;

    this.authService.login(this.loginForm.value).subscribe({
      next: (response) => {
        this.isLoading = false;
        
        // Guardamos token y usuario
        this.authService.saveToken(response.token);
        const usuarioInfo = {
            email: response.email,
            nombre: response.nombreCompleto,
            rol: response.rol,
            negocioId: response.negocioId 
        };
        this.authService.saveUser(usuarioInfo);

        const rol = response.rol; 
        const tieneNegocio = response.negocioId != null;

        // Opcional: Una alerta bonita de bienvenida antes de redirigir
        Swal.fire({
          icon: 'success',
          title: `¡Hola de nuevo!`,
          text: 'Iniciando sesión...',
          timer: 1500,
          showConfirmButton: false,
          timerProgressBar: true
        }).then(() => {
            // Rutas
            if (rol === 'SUPER_ADMIN') {
                this.router.navigate(['/admin-panel']); 
            } 
            else if (!tieneNegocio) {
                this.router.navigate(['/onboarding-negocio']);
            } 
            else {
                switch (rol) {
                    case 'PROPIETARIO': this.router.navigate(['/dashboard/propietario']); break;
                    case 'VENDEDOR': this.router.navigate(['/dashboard/ventas']); break;
                    case 'BODEGUERO': this.router.navigate(['/dashboard/inventario']); break;
                    default: this.router.navigate(['/dashboard']);
                }
            }
        });
      },
      error: (err) => {
        this.isLoading = false;
        console.error(err);
        
        // Alerta cuando las credenciales están mal
        Swal.fire({
          icon: 'error',
          title: 'Acceso Denegado',
          text: 'Tu correo o contraseña son incorrectos. Por favor, intenta de nuevo.',
          confirmButtonColor: '#ed8936'
        });
      }
    });
  }
}