import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
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
    obligadoContabilidad: false
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;
    
    if (this.negocioId) {
      this.cargarNegocio(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
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
          obligadoContabilidad: data.obligadoContabilidad || false
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
      
      // Vista previa de la imagen local
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.imagenActual = e.target.result;
        this.cdr.detectChanges();
      };
      reader.readAsDataURL(this.selectedFile!); 
    }
  }
  
  guardarCambios() {
    if (!this.negocioId) return;

    // Validación básica
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
      obligadoContabilidad: this.negocioForm.obligadoContabilidad
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
            // Recargar la página para que la imagen nueva aparezca en la barra lateral
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
}