import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { environment } from "../../../environments/environment";

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
  private router = inject(Router);
  
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = environment.apiUrl;

  selectedFile: File | null = null;
  imagenActual: string | null = null; 
  
  negocioForm = {
    ruc: '',
    razonSocial: '',
    nombreComercial: '',
    direccion: '',
    obligadoContabilidad: false,
    metodoCosteo: 'PROMEDIO' 
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    
    this.negocioId = usuarioLogueado?.negocioId || usuarioLogueado?.selectedBusinessId || usuarioLogueado?.idNegocio;
    
    if (this.negocioId) {
      this.cargarNegocio(this.negocioId);
    } else {
      console.warn("Falta de integridad: No se detectó negocioId en el almacenamiento local.");
      this.isLoading = false;
      this.cdr.detectChanges();

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
        console.error('Error al cargar la información del negocio:', err);
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
      Swal.fire('Campos Incompletos', 'Por favor, completa todos los campos obligatorios (*).', 'warning');
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

    formData.append('datos', new Blob([JSON.stringify(requestDTO)], { type: 'application/json' }));
    
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
          Swal.fire('Error', 'Hubo un problema al actualizar la configuración.', 'error');
        }
      });
  }


  eliminarNegocio() {
    if (!this.negocioId) return;

    // Advertencia 1: Confirmación normal
    Swal.fire({
      title: '¿Estás absolutamente seguro?',
      text: "Esta acción eliminará TODO el negocio. Se perderán productos, ventas y configuración. ¡NO se puede deshacer!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Sí, eliminar negocio',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        
        // Advertencia 2: Doble check de seguridad
        Swal.fire({
          title: '¡ÚLTIMA ADVERTENCIA!',
          text: "Estás a punto de borrar los datos de tu empresa para siempre. ¿Realmente quieres continuar?",
          icon: 'error',
          showCancelButton: true,
          confirmButtonColor: '#d33',
          cancelButtonColor: '#3085d6',
          confirmButtonText: 'SÍ, ESTOY SEGURO',
          cancelButtonText: 'Me arrepentí'
        }).then((result2) => {
          if (result2.isConfirmed) {

            // Advertencia 3: Validación por texto
            Swal.fire({
              title: 'Confirmación manual requerida',
              html: 'Escribe la palabra <b>ELIMINAR</b> para confirmar la destrucción total del negocio.',
              input: 'text',
              inputPlaceholder: 'Escribe ELIMINAR aquí...',
              showCancelButton: true,
              confirmButtonColor: '#d33',
              cancelButtonText: 'Cancelar',
              preConfirm: (texto) => {
                if (texto !== 'ELIMINAR') {
                  Swal.showValidationMessage('Debes escribir la palabra exacta: ELIMINAR');
                }
              }
            }).then((result3) => {
              if (result3.isConfirmed) {
                this.ejecutarEliminacion();
              }
            });
          }
        });
      }
    });
  }

  private ejecutarEliminacion() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    Swal.fire({ 
      title: 'Destruyendo negocio...', 
      text: 'Por favor espera...',
      allowOutsideClick: false, 
      didOpen: () => Swal.showLoading() 
    });

    this.http.delete(`${this.apiUrl}/negocios/${this.negocioId}`, { headers })
      .subscribe({
        next: () => {
          Swal.fire({
            title: '¡Negocio Eliminado!', 
            text: 'Tu negocio ha sido eliminado para siempre. Cerrando sesión...', 
            icon: 'success',
            allowOutsideClick: false
          }).then(() => {
            this.cerrarSesion(); // Lo sacamos del sistema porque ya no tiene negocio
          });
        },
        error: (err) => {
          console.error(err);
          Swal.fire('Acceso Denegado', 'No se pudo eliminar. Asegúrate de ser el PROPIETARIO del negocio.', 'error');
        }
      });
  }


  cerrarSesion() {
    localStorage.removeItem('dilo_token');
    localStorage.removeItem('dilo_user');
    localStorage.removeItem('usuario');
    this.router.navigate(['/login']);
  }
}