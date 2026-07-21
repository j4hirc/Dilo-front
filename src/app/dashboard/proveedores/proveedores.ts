import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './proveedores.html',
  styleUrls: ['./proveedores.css'],
})
export class Proveedores implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  filtroEstado: string = '';


  

  proveedores: any[] = [];
  proveedoresFiltrados: any[] = [];
  categorias: any[] = [];

  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  searchTerm: string = '';
  
  showModal = false;
  isEditing = false;
  currentId: number | null = null;

  proveedorForm = {
    dni: '',
    nombre: '',
    telefono: '',
    estado: true,
    categoriasIds: [] as number[]
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;

    if (this.negocioId) {
      this.cargarCategorias(this.negocioId);
      this.cargarProveedores(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarCategorias(id: number) {
    const headers = this.getHeaders();
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/categorias`, { headers }).subscribe({
      next: (data) => this.categorias = data || [],
      error: (err) => console.error("Error al cargar categorías", err)
    });
  }

cargarProveedores(id: number) {
    this.isLoading = true;
    const headers = this.getHeaders();

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, { headers }).subscribe({
      next: (data) => {
        this.proveedores = data || [];
        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar proveedores:', err);
        // 🔥 SOLUCIÓN NG0100: Retrasamos el apagado del loading al siguiente ciclo del event loop
        setTimeout(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        });
      }
    });
  }

  aplicarFiltros() {
    let result = this.proveedores;

    // Filtro por Estado
    if (this.filtroEstado === 'ACTIVO') {
        result = result.filter(p => p.estado === true);
    } else if (this.filtroEstado === 'INACTIVO') {
        result = result.filter(p => p.estado === false);
    }

    // Filtro por Texto
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(p => 
        (p.nombre && p.nombre.toLowerCase().includes(term)) ||
        (p.dni && p.dni.toLowerCase().includes(term))
      );
    }
    
    this.proveedoresFiltrados = result;
  }

  abrirModalNuevo() {
    this.isEditing = false;
    this.currentId = null;
    this.proveedorForm = {
      dni: '',
      nombre: '',
      telefono: '',
      estado: true,
      categoriasIds: []
    };
    this.showModal = true;
  }

  abrirModalEditar(prov: any) {
    this.isEditing = true;
    this.currentId = prov.id;
    this.proveedorForm = {
      dni: prov.dni,
      nombre: prov.nombre,
      telefono: prov.telefono,
      estado: prov.estado,
      categoriasIds: prov.categorias ? prov.categorias.map((c: any) => c.id) : []
    };
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges();
  }

  guardarProveedor() {
    if (!this.negocioId) return;

    if (!this.proveedorForm.dni || !this.proveedorForm.nombre) {
      Swal.fire('Error', 'El RUC/DNI y la Razón Social son obligatorios.', 'error');
      return;
    }

    Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const headers = this.getHeaders();
    const url = `${this.apiUrl}/negocios/${this.negocioId}/proveedores`;

    if (this.isEditing && this.currentId) {
      this.http.put(`${url}/${this.currentId}`, this.proveedorForm, { headers }).subscribe({
        next: () => this.postGuardadoExitoso('Proveedor actualizado correctamente.'),
        error: (err) => this.manejarError(err)
      });
    } else {
      this.http.post(url, this.proveedorForm, { headers }).subscribe({
        next: () => this.postGuardadoExitoso('Proveedor creado correctamente.'),
        error: (err) => this.manejarError(err)
      });
    }
  }

  eliminarProveedor(id: number) {
    if (!this.negocioId) return;

    Swal.fire({
      title: '¿Eliminar proveedor?',
      text: "Si eliminas este proveedor no podrás recuperarlo, aunque su historial en el Kardex se mantendrá.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar'
    }).then((result) => {
      if (result.isConfirmed) {
        const headers = this.getHeaders();
        this.http.delete(`${this.apiUrl}/negocios/${this.negocioId}/proveedores/${id}`, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Eliminado!', 'El proveedor ha sido borrado.', 'success');
            this.cargarProveedores(this.negocioId!);
          },
          error: (err) => this.manejarError(err)
        });
      }
    });
  }

  postGuardadoExitoso(mensaje: string) {
    this.cerrarModal();
    Swal.fire('Éxito', mensaje, 'success');
    if (this.negocioId) this.cargarProveedores(this.negocioId);
  }

  manejarError(err: any) {
    Swal.close();
    const mensajeBackend = err.error?.message || err.error;
    
    if (err.status === 400 || err.status === 500) {
        Swal.fire('Atención', typeof mensajeBackend === 'string' ? mensajeBackend : 'El DNI ingresado ya existe.', 'warning');
    } else {
        Swal.fire('Error', 'Ocurrió un error al procesar la solicitud.', 'error');
    }
  }

  private getHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }
}