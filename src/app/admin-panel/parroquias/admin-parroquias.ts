import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-admin-parroquias',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-parroquias.html',
  styleUrls: ['../admin-panel.css', './admin-parroquias.css']
})
export class AdminParroquias implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1/parroquias';

  isLoading = false;
  parroquias: any[] = [];
  parroquiasFiltradas: any[] = [];
  busqueda: string = '';

  // Variables del Modal
  showModal = false;
  isEditing = false;
  parroquiaActual: any = { nombre: '' };

  ngOnInit() {
    this.cargarParroquias();
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cargarParroquias() {
    this.isLoading = true;
    this.http.get<any[]>(this.apiUrl, { headers: this.getAuthHeaders() }).subscribe({
      next: (data) => {
        this.parroquias = data || [];
        this.parroquiasFiltradas = [...this.parroquias];
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error(err);
        this.isLoading = false;
        this.cdr.detectChanges();
        Swal.fire('Error', 'No se pudieron cargar las parroquias.', 'error');
      }
    });
  }

  filtrarParroquias() {
    if (!this.busqueda.trim()) {
      this.parroquiasFiltradas = [...this.parroquias];
      return;
    }
    const term = this.busqueda.toLowerCase().trim();
    this.parroquiasFiltradas = this.parroquias.filter(p => 
      p.nombre && p.nombre.toLowerCase().includes(term)
    );
    this.cdr.detectChanges();
  }

  abrirModalCrear() {
    this.isEditing = false;
    this.parroquiaActual = { nombre: '' };
    this.showModal = true;
  }

  abrirModalEditar(parroquia: any) {
    this.isEditing = true;
    this.parroquiaActual = { ...parroquia };
    this.showModal = true;
  }

  guardarParroquia() {
    if (!this.parroquiaActual.nombre || !this.parroquiaActual.nombre.trim()) {
      Swal.fire('Faltan Datos', 'El nombre de la parroquia es obligatorio.', 'warning');
      return;
    }

    this.showModal = false;
    Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const payload = { nombre: this.parroquiaActual.nombre.trim() };

    if (this.isEditing) {
      // ACTUALIZAR (PUT)
      this.http.put(`${this.apiUrl}/${this.parroquiaActual.id}`, payload, { headers: this.getAuthHeaders() }).subscribe({
        next: () => {
          Swal.fire('¡Éxito!', 'Parroquia actualizada correctamente.', 'success');
          this.cargarParroquias();
        },
        error: (err) => {
          this.manejarErrorBackend(err);
        }
      });
    } else {
      // CREAR (POST)
      this.http.post(this.apiUrl, payload, { headers: this.getAuthHeaders() }).subscribe({
        next: () => {
          Swal.fire('¡Éxito!', 'Parroquia creada correctamente.', 'success');
          this.cargarParroquias();
        },
        error: (err) => {
          this.manejarErrorBackend(err);
        }
      });
    }
  }

  eliminarParroquia(id: number) {
    Swal.fire({
      title: '¿Estás seguro?',
      text: "Esta acción no se puede deshacer. Se eliminará la parroquia.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire({ title: 'Eliminando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        this.http.delete(`${this.apiUrl}/${id}`, { headers: this.getAuthHeaders() }).subscribe({
          next: () => {
            Swal.fire('¡Eliminada!', 'La parroquia ha sido eliminada.', 'success');
            this.cargarParroquias();
          },
          error: (err) => {
            console.error(err);
            Swal.fire('Error', 'No se pudo eliminar la parroquia (puede estar en uso por un usuario).', 'error');
          }
        });
      }
    });
  }

  private manejarErrorBackend(err: HttpErrorResponse) {
    this.showModal = true;
    this.cdr.detectChanges();
    
    console.error('Error completo del backend:', err); 

    let errorMsg = 'Ocurrió un error inesperado al comunicarse con el servidor.';

    if (err.status === 0) {
      errorMsg = 'No se pudo conectar con el servidor. Verifica tu conexión o posibles errores de CORS.';
    } 
   
    else if (err.error) {
       if (typeof err.error === 'string') {
           errorMsg = err.error;
       } else if (err.error.message) {
           errorMsg = err.error.message; 
       } else if (err.error.error) {
           errorMsg = err.error.error; 
       }
    }

    Swal.fire('Error', errorMsg, 'error');
  }
}