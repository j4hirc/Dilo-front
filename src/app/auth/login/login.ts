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

  failedAttempts = 0;
  isLocked = false;
  lockoutTimeRemaining = 0;
  lockoutTimer: any;

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  onSubmit() {
    if (this.isLocked) {
      Swal.fire({
        icon: 'warning',
        title: 'Demasiados intentos',
        text: `Por favor espera ${this.lockoutTimeRemaining} segundos antes de volver a intentarlo.`,
        confirmButtonColor: '#ed8936'
      });
      return;
    }

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
        this.failedAttempts = 0;

        const rawToken = response.token || '';
        const cleanToken = rawToken.replace(/['"]+/g, '');
        
        this.authService.saveToken(cleanToken);
        localStorage.setItem('dilo_token', cleanToken); // Clave exacta que busca el dashboard

        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        this.http.get<any>(`${this.apiUrl}/usuarios/verificar-estado`, { headers }).subscribe({
          next: (estadoRes) => {
            this.isLoading = false;

            if (estadoRes && estadoRes.tienePendiente) {
              localStorage.clear();
              Swal.fire({
                icon: 'info',
                title: 'Solicitud pendiente',
                text: 'Tu solicitud para unirse al negocio aún no ha sido respondida. Debes esperar a que el administrador la acepte o rechace para poder ingresar.',
                confirmButtonColor: '#0F172A',
                confirmButtonText: 'Entendido',
                allowOutsideClick: false
              });
              return; 
            }

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
        
        this.failedAttempts++;

        if (this.failedAttempts >= 3) {
          this.iniciarBloqueo(15); 
          return; 
        }

        const mensajeError = typeof err.error === 'string' ? err.error : (err.error?.message || '');
        
        Swal.fire({
          icon: 'error',
          title: 'Acceso Denegado',
          text: 'Tu correo o contraseña son incorrectos. Por favor, intenta de nuevo.',
          confirmButtonColor: '#ed8936'
        });
      }
    });
  }

  private iniciarBloqueo(segundos: number) {
    this.isLocked = true;
    this.lockoutTimeRemaining = segundos;
    
    this.loginForm.disable();

    Swal.fire({
      icon: 'warning',
      title: 'Demasiados intentos',
      text: `Has fallado 3 veces. El acceso ha sido bloqueado por 15 segundos.`,
      confirmButtonColor: '#ed8936',
      timer: segundos * 1000, 
      timerProgressBar: true,
      allowOutsideClick: false,
      showConfirmButton: false
    });

    this.lockoutTimer = setInterval(() => {
      this.lockoutTimeRemaining--;

      if (this.lockoutTimeRemaining <= 0) {
        clearInterval(this.lockoutTimer);
        this.isLocked = false;
        this.failedAttempts = 0; 
        this.loginForm.enable(); 
      }
    }, 1000);
  }

  private procesarAccesoExitoso(response: any) {
    const usuarioInfo = {
        email: response.email,
        nombre: response.nombreCompleto,
        primerNombre: response.primerNombre,
        apellidoPaterno: response.apellidoPaterno,
        rol: response.rol,
        roles: response.roles,
        negocioId: response.selectedBusinessId || response.negocioId, 
        businesses: response.businesses,
        needsBusinessSelection: response.needsBusinessSelection,
        needsRoleSelection: response.needsRoleSelection,
        fotoPerfil: response.fotoPerfil
    };
    
    localStorage.setItem('usuario', JSON.stringify(usuarioInfo));
    localStorage.setItem('dilo_user', JSON.stringify(usuarioInfo)); // Respaldo extra
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
                case 'VENDEDOR': this.router.navigate(['/dashboard/clientes']); break;
                case 'BODEGUERO': this.router.navigate(['/dashboard/inventario']); break;
                default: this.router.navigate(['/dashboard']);
            }
        }
    });
  }

  ngOnDestroy() {
    if (this.lockoutTimer) {
      clearInterval(this.lockoutTimer);
    }
  }
}