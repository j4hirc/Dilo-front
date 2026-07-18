import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../auth.service';
import { CommonModule } from '@angular/common';
import Swal from 'sweetalert2'; 

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
        
        // 1. Guardamos el token
        this.authService.saveToken(response.token);
        
        // 2. Unificamos toda la data en un solo objeto limpio
        const usuarioInfo = {
            email: response.email,
            nombre: response.nombreCompleto,
            rol: response.rol,
            roles: response.roles,
            // Agregamos ambas opciones de ID por si el backend cambia el nombre
            negocioId: response.selectedBusinessId || response.negocioId, 
            businesses: response.businesses,
            needsBusinessSelection: response.needsBusinessSelection,
            needsRoleSelection: response.needsRoleSelection
        };
        
        // 3. Forzamos el guardado en localStorage y en el servicio
        localStorage.setItem('usuario', JSON.stringify(usuarioInfo));
        this.authService.saveUser(usuarioInfo);

        // 4. Evaluamos a dónde redirigir al usuario
        const rol = response.rol;
        const isSuperAdmin = response.superAdmin || rol === 'SUPER_ADMIN'; 
        const tieneNegocio = usuarioInfo.negocioId != null;
        const needsRoleSelection = response.needsRoleSelection;

        // 5. Alerta de éxito y redirección
        Swal.fire({
          icon: 'success',
          title: '¡Hola de nuevo!',
          text: 'Iniciando sesión...',
          timer: 1500,
          showConfirmButton: false,
          timerProgressBar: true
        }).then(() => {
            if (isSuperAdmin) {
                this.router.navigate(['/admin-panel']);
            } else if (!tieneNegocio) {
                this.router.navigate(['/onboarding-business']);
            } else if (needsRoleSelection) {
                this.router.navigate(['/select-role']);
            } else {
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