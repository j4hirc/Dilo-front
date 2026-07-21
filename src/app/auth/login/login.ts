import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../auth.service';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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
  private http = inject(HttpClient);
  private router = inject(Router);

  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

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
      next: (response: any) => {
        // 1. Guardamos temporalmente el token para poder consultar el estado
        this.authService.saveToken(response.token);
        
        const rawToken = response.token || '';
        const cleanToken = rawToken.replace(/['"]+/g, '');
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        // 2. Verificamos el estado en la ruta correcta del backend (/usuarios/verificar-estado)
        this.http.get<any>(`${this.apiUrl}/usuarios/verificar-estado`, { headers }).subscribe({
          next: (estadoRes) => {
            this.isLoading = false;

            if (estadoRes && estadoRes.tienePendiente) {
              // Limpiamos sesión por seguridad para que no quede autenticado
              localStorage.clear();
              
              Swal.fire({
                icon: 'info',
                title: 'Solicitud pendiente',
                text: 'Tu solicitud para unirse al negocio aún no ha sido respondida. Debes esperar a que el administrador la acepte o rechace para poder ingresar.',
                confirmButtonColor: '#0F172A',
                confirmButtonText: 'Entendido',
                allowOutsideClick: false
              });
              return; // Detenemos totalmente el flujo de acceso
            }

            // 3. Si no tiene pendientes, procedemos con el login normal
            this.procesarAccesoExitoso(response);
          },
          error: (err) => {
            this.isLoading = false;
            console.error("Error al verificar estado:", err);
            this.procesarAccesoExitoso(response);
          }
        });

      },
      error: (err) => {
        this.isLoading = false;
        console.error("Error en el login:", err);

        const mensajeError = typeof err.error === 'string' ? err.error : (err.error?.message || '');
        
        Swal.fire({
          icon: 'error',
          title: 'Acceso Denegado',
          text: mensajeError || 'Tu correo o contraseña son incorrectos. Por favor, intenta de nuevo.',
          confirmButtonColor: '#ed8936'
        });
      }
    });
  }

  private procesarAccesoExitoso(response: any) {
    const usuarioInfo = {
        email: response.email,
        nombre: response.nombreCompleto,
        rol: response.rol,
        roles: response.roles,
        negocioId: response.selectedBusinessId || response.negocioId, 
        businesses: response.businesses,
        needsBusinessSelection: response.needsBusinessSelection,
        needsRoleSelection: response.needsRoleSelection
    };
    
    localStorage.setItem('usuario', JSON.stringify(usuarioInfo));
    this.authService.saveUser(usuarioInfo);

    const rol = response.rol;
    const isSuperAdmin = response.superAdmin || rol === 'SUPER_ADMIN'; 
    const tieneNegocio = usuarioInfo.negocioId != null;
    const needsRoleSelection = response.needsRoleSelection;

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
  }
}