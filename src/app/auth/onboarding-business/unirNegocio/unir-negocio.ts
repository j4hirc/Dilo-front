import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-unir-negocio',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './unir-negocio.html',
  styleUrls: ['./unir-negocio.css'] 
})
export class UnirNegocio {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private router = inject(Router);

  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1/negocios';

  isLoading = false;

  // Rol por defecto: 3 (Vendedor)
  joinForm: FormGroup = this.fb.group({
    codigoInvitacion: ['', [Validators.required, Validators.minLength(6)]],
    idRol: ['3', [Validators.required]]
  });

  onSubmit() {
    if (this.joinForm.invalid) {
      this.joinForm.markAllAsTouched();
      Swal.fire({
        icon: 'warning',
        title: 'Formulario incompleto',
        text: 'Por favor, ingresa un código de invitación válido.',
        confirmButtonColor: '#0F172A'
      });
      return;
    }

    this.isLoading = true;
    
    const payload = {
      codigoInvitacion: this.joinForm.value.codigoInvitacion.trim(),
      idRol: Number(this.joinForm.value.idRol)
    };

    const rawToken = localStorage.getItem('dilo_token') || '';
    const token = rawToken.replace(/['"]+/g, '');

    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }

    this.http.post(`${this.apiUrl}/unirse`, payload, { headers }).subscribe({
      next: (response: any) => {
        this.isLoading = false;
        
        // Limpiamos los datos temporales del negocio ya que aún no está aprobado
        localStorage.removeItem('negocioId');

        Swal.fire({
          icon: 'info',
          title: 'Solicitud enviada con éxito',
          text: 'Te has registrado correctamente. Debes esperar a que el administrador apruebe tu invitación para poder ingresar al sistema.',
          confirmButtonColor: '#0F172A',
          confirmButtonText: 'Entendido'
        }).then(() => {
          // Lo mandamos de regreso al login / inicio
          this.router.navigate(['/login']); 
        });
      },
      error: (err) => {
        this.isLoading = false;
        Swal.fire({
          icon: 'error',
          title: 'Error al unirse',
          text: err.error?.message || 'Verifica el código de invitación e intenta nuevamente.',
          confirmButtonColor: '#0F172A'
        });
      }
    });
  }
}