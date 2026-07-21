import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router'; // 🔥 Importamos el Router
import Swal from 'sweetalert2';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracion.html',
  styleUrls: ['./configuracion.css'],
})
export class Configuracion implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router); // 🔥 Inyectamos el router para poder sacarlo al login
  
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  // Archivos y vista previa
  selectedFile: File | null = null;
  imagenActual: string | null = null; 
  
  // DTO exacto al de tu backend (NegocioRequestDTO)
  negocioForm = {
    ruc: '',
    razonSocial: '',
    nombreComercial: '',
    direccion: '',
    obligadoContabilidad: false,
    metodoCosteo: 'PROMEDIO' 
  };

  ngOnInit(): void {
    // 🔥 BÚSQUEDA A PRUEBA DE BALAS EN LOCALSTORAGE
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    
    console.log("👀 Revisando qué hay guardado en el navegador (Config):", usuarioLogueado);

    // Buscamos el ID en cualquier llave posible
    this.negocioId = usuarioLogueado?.negocioId || usuarioLogueado?.selectedBusinessId || usuarioLogueado?.idNegocio;
    
    if (this.negocioId) {
      this.cargarNegocio(this.negocioId);
    } else {
      console.error("🚨 CRÍTICO en Configuración: No hay negocioId en el localStorage.");
      this.isLoading = false;
      this.cdr.detectChanges();

      // 🔥 ALERTA VISUAL PARA LIMPIAR LA SESIÓN ROTA
      Swal.fire({
        icon: 'warning',
        title: 'Sesión desactualizada',
        text: 'No logramos detectar tu negocio actual. Por favor, cierra sesión y vuelve a ingresar para sincronizar tus datos.',
        confirmButtonColor: '#ed8936',
        confirmButtonText: 'Ir al Login',
        allowOutsideClick: false
      }).then((result) => {
        if (result.isConfirmed) {
          this.cerrarSesion();
        }
      });
    }
  }

  cargarNegocio(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any>(`${this.apiUrl}/negocios/${id}`, { headers }).subscribe({
      next: (data) => {
        this.negocioForm = {
          ruc: data.ruc || '',
          razonSocial: data.razonSocial || '',
          nombreComercial: data.nombreComercial || '',
          direccion: data.direccion || '',
          obligadoContabilidad: data.obligadoContabilidad || false,
          metodoCosteo: data.metodoCosteo || 'PROMEDIO' 
        };
        this.imagenActual = data.rutaImagen || null;
        
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar datos del negocio:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  onFileSelected(event: any) {
    if (event.target.files.length > 0) {
      this.selectedFile = event.target.files[0];
      
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.imagenActual = e.target.result;
        this.cdr.detectChanges();
      };
      reader.readAsDataURL(this.selectedFile!); 
    }
  }
  
  guardarCambios() {
    if (!this.negocioId) {
      Swal.fire('Error', 'No se encontró el ID del negocio. Cierra sesión e inténtalo de nuevo.', 'error');
      return;
    }

    if (!this.negocioForm.ruc || !this.negocioForm.razonSocial || !this.negocioForm.nombreComercial || !this.negocioForm.direccion) {
      Swal.fire('Campos Incompletos', 'Por favor, llena todos los campos obligatorios (*).', 'warning');
      return;
    }

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    const formData = new FormData();
    const requestDTO = {
      ruc: this.negocioForm.ruc,
      razonSocial: this.negocioForm.razonSocial,
      nombreComercial: this.negocioForm.nombreComercial,
      direccion: this.negocioForm.direccion,
      obligadoContabilidad: this.negocioForm.obligadoContabilidad,
      metodoCosteo: this.negocioForm.metodoCosteo 
    };

    // Empaquetar como lo espera @RequestPart("datos")
    formData.append('datos', new Blob([JSON.stringify(requestDTO)], { type: 'application/json' }));
    
    // Si eligió un logo nuevo, lo mandamos
    if (this.selectedFile) {
      formData.append('imagen', this.selectedFile);
    }

    Swal.fire({ title: 'Actualizando Negocio...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    this.http.put(`${this.apiUrl}/negocios/${this.negocioId}`, formData, { headers })
      .subscribe({
        next: () => {
          Swal.fire('¡Éxito!', 'Los datos de tu negocio han sido actualizados.', 'success').then(() => {
            window.location.reload(); 
          });
        },
        error: (err) => {
          Swal.close();
          console.error(err);
          Swal.fire('Error', 'Hubo un problema al actualizar el negocio.', 'error');
        }
      });
  }

  // 🔥 MÉTODO PARA LIMPIAR SESIÓN ROTA
  cerrarSesion() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('dilo_user');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }
}