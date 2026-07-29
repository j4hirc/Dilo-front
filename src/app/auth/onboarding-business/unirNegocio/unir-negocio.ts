import { Component, inject, OnInit } from '@angular/core';
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
export class UnirNegocio implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private router = inject(Router);

  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1/negocios';

  isLoading = false;

  joinForm: FormGroup = this.fb.group({
    codigoInvitacion: ['', [Validators.required, Validators.minLength(6)]],
    idRol: ['3', [Validators.required]]
  });

  ngOnInit() {
    // 🔥 1. VALIDACIÓN DE SEGURIDAD (TOKEN Y SESIÓN)
    const token = localStorage.getItem('dilo_token');
    const usuarioStr = localStorage.getItem('dilo_user') || localStorage.getItem('usuario');
    
    if (!token || !usuarioStr) {
      this.router.navigate(['/login']);
      return; 
    }

    // 🔥 2. VALIDACIÓN BLINDADA (CORREGIDA)
    const usuario = JSON.parse(usuarioStr);
    console.log("🔍 Datos del usuario en localStorage:", usuario);

    // CORRECCIÓN: Usamos Boolean() para verificar que la variable exista y tenga un valor válido (no undefined, no null, no 0)
    const tieneUnNegocio = Boolean(usuario.negocioId || usuario.idNegocio || usuario.tieneNegocio || usuario.negocio);

    const estaDeshabilitado = 
          usuario.rol === 'INACTIVO' || 
          usuario.rol === 'DESHABILITADO' || 
          usuario.rol === 'NINGUNO' || 
          usuario.estado === 'INACTIVO' || 
          usuario.activo === false;

    // Si tiene un negocio Y NO está deshabilitado, entonces sí lo botamos al dashboard.
    // Si no tiene negocio, este IF da falso y lo deja entrar normalmente.
    if (tieneUnNegocio && !estaDeshabilitado) {
      console.log("⛔ El usuario ya tiene negocio activo. Expulsando al dashboard...");
      this.router.navigate(['/dashboard']); 
      return;
    }
  }

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
        
        localStorage.removeItem('negocioId');

        Swal.fire({
          icon: 'info',
          title: 'Solicitud enviada con éxito',
          text: 'Te has registrado correctamente. Debes esperar a que el administrador apruebe tu invitación para poder ingresar al sistema.',
          confirmButtonColor: '#0F172A',
          confirmButtonText: 'Entendido'
        }).then(() => {
          this.router.navigate(['/login']); 
        });
      },
      error: (err) => {
        this.isLoading = false;
        
        const mensajeError = err.error?.message || (typeof err.error === 'string' ? err.error : 'Verifica el código de invitación e intenta nuevamente.');
        const msgLower = mensajeError.toLowerCase();

        // 🔥 Aquí ya quitamos la alerta de "rechazada", porque si está rechazada, 
        // tu backend lo borró y le dejará enviar una nueva.
        if (msgLower.includes('revocado') || msgLower.includes('perteneces')) {
          Swal.fire({
            icon: 'warning',
            title: 'Acción no permitida',
            text: mensajeError,
            confirmButtonColor: '#0F172A'
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error al unirse',
            text: mensajeError,
            confirmButtonColor: '#0F172A'
          });
        }
      }
    });
  }
}