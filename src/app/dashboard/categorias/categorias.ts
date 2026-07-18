import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-categorias',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './categorias.html',
  styleUrls: ['./categorias.css'],
})
export class Categorias implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  
  categorias: any[] = [];
  categoriasFiltradas: any[] = [];
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  searchTerm: string = '';
  showModal = false;
  isEditing = false;
  currentId: number | null = null;
  
  categoriaForm = {
    nombre: '',
    descripcion: ''
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;
    
    if (this.negocioId) {
      this.cargarCategorias(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarCategorias(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/categorias`, { headers }).subscribe({
      next: (data) => {
        this.categorias = Array.isArray(data) ? data : [];
        this.filtrarCategorias();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  filtrarCategorias() {
    if (this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase().trim();
      this.categoriasFiltradas = this.categorias.filter(c => 
        c.nombre.toLowerCase().includes(term) || 
        (c.descripcion && c.descripcion.toLowerCase().includes(term))
      );
    } else {
      this.categoriasFiltradas = this.categorias;
    }
    this.cdr.detectChanges();
  }

  abrirModalNuevo() {
    this.isEditing = false;
    this.currentId = null;
    this.categoriaForm = { nombre: '', descripcion: '' };
    this.showModal = true;
  }

  abrirModalEditar(cat: any) {
    this.isEditing = true;
    this.currentId = cat.id;
    this.categoriaForm = { nombre: cat.nombre, descripcion: cat.descripcion || '' };
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges();
  }
  
  guardarCategoria() {
    if (!this.negocioId) return;

    if (!this.categoriaForm.nombre) {
      Swal.fire('Error', 'El nombre de la categoría es obligatorio.', 'error');
      return;
    }

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    // Aquí enviamos JSON puro, como lo espera tu @RequestBody
    const requestDTO = {
      nombre: this.categoriaForm.nombre,
      descripcion: this.categoriaForm.descripcion
    };

    Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    if (this.isEditing && this.currentId) {
      this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/categorias/${this.currentId}`, requestDTO, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Categoría actualizada!'),
          error: (err) => this.manejarError(err)
        });
    } else {
      this.http.post(`${this.apiUrl}/negocios/${this.negocioId}/categorias`, requestDTO, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Categoría creada exitosamente!'),
          error: (err) => this.manejarError(err)
        });
    }
  }

  postGuardadoExitoso(mensaje: string) {
    this.cerrarModal(); 
    Swal.fire('Éxito', mensaje, 'success');
    if (this.negocioId) this.cargarCategorias(this.negocioId);
  }

  eliminarCategoria(id: number) {
    if (!this.negocioId) return;

    Swal.fire({
      title: '¿Eliminar categoría?',
      text: "Se borrará permanentemente.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar'
    }).then((result) => {
      if (result.isConfirmed) {
        const rawToken = localStorage.getItem('dilo_token') || '';
        const cleanToken = rawToken.replace(/['"]+/g, ''); 
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        // Java devuelve un String de éxito en tu controlador
        this.http.delete(`${this.apiUrl}/negocios/${this.negocioId}/categorias/${id}`, { headers, responseType: 'text' }).subscribe({
          next: () => {
            Swal.fire('¡Eliminado!', 'Categoría borrada.', 'success');
            this.cargarCategorias(this.negocioId!);
          },
          error: (err) => this.manejarError(err)
        });
      }
    });
  }

  manejarError(err: any) {
    Swal.close();
    console.error(err);
    Swal.fire('Error', 'Hubo un problema al procesar la solicitud.', 'error');
  }
}