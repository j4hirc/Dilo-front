import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-bodegas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bodegas.html',
  styleUrls: ['./bodegas.css'],
})
export class Bodegas implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  // 🔥 Guardamos los headers en una variable para no reconstruirlos
  private authHeaders: HttpHeaders | null = null;

  bodegas: any[] = [];
  isLoading = true;
  negocioId: number | null = null;
  rolUsuario: string = '';
  terminoBusqueda: string = '';
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;
    this.rolUsuario = usuarioLogueado?.rol || '';

    // 🔥 Inicializamos los headers una sola vez al iniciar
    this.initHeaders();

    if (this.negocioId) {
      this.cargarBodegas();
    } else {
      this.isLoading = false;
    }
  }

  private initHeaders() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    this.authHeaders = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cargarBodegas() {
    this.isLoading = true;
    // Usamos los headers cacheados
    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, { headers: this.authHeaders! }).subscribe({
      next: (data) => {
        this.bodegas = data;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar bodegas:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // 🔥 2. BUSCADOR EN TIEMPO REAL
  buscarBodegas() {
    if (!this.terminoBusqueda.trim()) {
      this.cargarBodegas();
      return;
    }

    this.isLoading = true;
    const headers = this.getHeaders();

    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas/search?term=${this.terminoBusqueda}`, { headers }).subscribe({
      next: (data) => {
        this.bodegas = data;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error en búsqueda:', err);
        this.bodegas = []; // Si no encuentra, vaciamos la lista
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // 🔥 3. CREAR NUEVA BODEGA (Solo Propietario)
  abrirModalCrear() {
    Swal.fire({
      title: 'Nueva Bodega',
      html: `
        <div class="swal-form-container">
            <input id="swal-nombre" class="swal2-input custom-swal-input" placeholder="Nombre de la bodega (Ej: Bodega Central)">
            <input id="swal-direccion" class="swal2-input custom-swal-input" placeholder="Dirección (Opcional)">
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#ed8936',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Crear Bodega',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement).value;
        const direccion = (document.getElementById('swal-direccion') as HTMLInputElement).value;
        
        if (!nombre) {
          Swal.showValidationMessage('El nombre de la bodega es obligatorio');
          return false;
        }
        return { nombre, direccion };
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const headers = this.getHeaders();
        this.http.post(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, result.value, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Creada!', 'La bodega se registró correctamente.', 'success');
            this.cargarBodegas();
          },
          error: (err) => Swal.fire('Error', 'No se pudo crear la bodega.', 'error')
        });
      }
    });
  }

  // 🔥 4. EDITAR BODEGA (Solo Propietario)
  abrirModalEditar(bodega: any) {
    Swal.fire({
      title: 'Editar Bodega',
      html: `
        <div class="swal-form-container">
            <input id="swal-nombre" class="swal2-input custom-swal-input" value="${bodega.nombre}" placeholder="Nombre de la bodega">
            <input id="swal-direccion" class="swal2-input custom-swal-input" value="${bodega.direccion || ''}" placeholder="Dirección">
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#ed8936',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Guardar Cambios',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement).value;
        const direccion = (document.getElementById('swal-direccion') as HTMLInputElement).value;
        if (!nombre) {
          Swal.showValidationMessage('El nombre no puede estar vacío');
          return false;
        }
        return { nombre, direccion };
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const headers = this.getHeaders();
        this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/bodegas/${bodega.id}`, result.value, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Actualizada!', 'La bodega ha sido modificada.', 'success');
            this.cargarBodegas();
          },
          error: (err) => Swal.fire('Error', 'No se pudo actualizar.', 'error')
        });
      }
    });
  }

  // 🔥 5. ELIMINAR BODEGA (Solo Propietario)
  eliminarBodega(id: number) {
    Swal.fire({
      title: '¿Estás seguro?',
      text: "¡Esta acción eliminará la bodega y no se puede deshacer!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        const headers = this.getHeaders();
        this.http.delete(`${this.apiUrl}/negocios/${this.negocioId}/bodegas/${id}`, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Eliminada!', 'La bodega fue eliminada.', 'success');
            this.cargarBodegas();
          },
          error: (err) => Swal.fire('Error', 'Hubo un problema al eliminar.', 'error')
        });
      }
    });
  }

  // Función Helper para los Headers
  private getHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }
}