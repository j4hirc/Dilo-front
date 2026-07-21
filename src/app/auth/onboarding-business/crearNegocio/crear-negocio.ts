import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http'; // 🔥 Importamos HttpHeaders
import Swal from 'sweetalert2';

@Component({
  selector: 'app-crear-negocio',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './crear-negocio.html',
  styleUrls: ['./crear-negocio.css']
})
export class CrearNegocio {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private router = inject(Router);

  // 🔥 RUTA REAL DE PRODUCCIÓN (RENDER)
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1/negocios';

  isLoading = false;
  archivoLogo: File | null = null;
  logoPreview: string | ArrayBuffer | null = null;

  createForm: FormGroup = this.fb.group({
    ruc: ['', [Validators.required, Validators.minLength(13), Validators.maxLength(13)]],
    razonSocial: ['', Validators.required],
    nombreComercial: ['', Validators.required],
    direccion: ['', Validators.required],
    metodoCosteo: ['PROMEDIO', Validators.required],
    obligadoContabilidad: [false]
  });

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.archivoLogo = file;
      const reader = new FileReader();
      reader.onload = e => this.logoPreview = reader.result;
      reader.readAsDataURL(file);
    }
  }

  onSubmit() {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      Swal.fire({
        icon: 'warning',
        title: 'Campos incompletos',
        text: 'Por favor, completa todos los campos requeridos.',
        confirmButtonColor: '#ed8936'
      });
      return;
    }

    this.isLoading = true;

    const formData = new FormData();
    const dto = this.createForm.value;
    
    formData.append('datos', new Blob([JSON.stringify(dto)], { type: 'application/json' }));
    
    if (this.archivoLogo) {
      formData.append('imagen', this.archivoLogo);
    }

    const rawToken = localStorage.getItem('dilo_token') || '';
    const token = rawToken.replace(/['"]+/g, '');

    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }

    this.http.post<any>(this.apiUrl, formData, { headers }).subscribe({
      next: (response) => {
        this.isLoading = false;
        
        // 🔥 VAMOS A VER QUÉ NOS MANDA REALMENTE SPRING BOOT EN LA CONSOLA
        console.log("🚀 Respuesta exacta del backend al crear negocio:", response);

        // =================================================================
        // 🔥 LA MAGIA BLINDADA: Atrapamos el ID sin importar cómo se llame
        // =================================================================
        const idGenerado = response.id || response.idNegocio || response.negocioId || response.Id;
        
        // Actualizamos la sesión en 'usuario'
        const userStr = localStorage.getItem('usuario');
        if (userStr) {
          const usuarioObj = JSON.parse(userStr);
          usuarioObj.negocioId = idGenerado; 
          localStorage.setItem('usuario', JSON.stringify(usuarioObj));
        }

        // Actualizamos la sesión en 'dilo_user' (por si acaso el Auth usa esta)
        const diloUserStr = localStorage.getItem('dilo_user');
        if (diloUserStr) {
          const diloUserObj = JSON.parse(diloUserStr);
          diloUserObj.negocioId = idGenerado; 
          localStorage.setItem('dilo_user', JSON.stringify(diloUserObj));
        }
        // =================================================================

        Swal.fire({
          icon: 'success',
          title: '¡Negocio Creado!',
          text: 'Tu negocio se configuró exitosamente.',
          timer: 2000,
          showConfirmButton: false
        }).then(() => {
          this.router.navigate(['/dashboard/propietario']);
        });
      },
      error: (err) => {
        this.isLoading = false;
        
        if (err.status === 401 || err.status === 403) {
           Swal.fire({
            icon: 'error',
            title: 'Sesión expirada',
            text: 'Tu sesión ha caducado o no tienes permisos. Por favor, inicia sesión nuevamente.',
            confirmButtonColor: '#ed8936'
          }).then(() => {
             this.router.navigate(['/login']); 
          });
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error al crear',
            text: err.error?.message || 'Hubo un problema al registrar el negocio.',
            confirmButtonColor: '#ed8936'
          });
        }
      }
    });
  }
}