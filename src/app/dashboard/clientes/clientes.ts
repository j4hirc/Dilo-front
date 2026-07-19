import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clientes.html',
  styleUrls: ['./clientes.css'],
})
export class Clientes implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  
  clientes: any[] = [];
  clientesFiltrados: any[] = []; 
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  searchTerm: string = '';

  // Control del Modal
  showModal = false;
  isEditing = false;
  currentClienteId: number | null = null;
  
  // 🔥 DTO Exacto al de tu Java
  clienteForm = {
    dni: '',
    primerNombre: '',
    segundoNombre: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    email: '',
    fechaNacimiento: '',
    telefono: '',
    direccion: ''
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;
    
    if (this.negocioId) {
      this.cargarClientes(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarClientes(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).subscribe({
      next: (data) => {
        this.clientes = Array.isArray(data) ? data : [];
        this.filtrarClientes(); 
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error("Error al cargar clientes:", err);
        this.isLoading = false;
        this.cdr.detectChanges();
        this.manejarError(err);
      }
    });
  }

  filtrarClientes() {
    if (this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase().trim();
      this.clientesFiltrados = this.clientes.filter(c => 
        (c.nombreCompleto && c.nombreCompleto.toLowerCase().includes(term)) || 
        (c.dni && c.dni.toLowerCase().includes(term)) ||
        (c.email && c.email.toLowerCase().includes(term))
      );
    } else {
      this.clientesFiltrados = this.clientes;
    }
    this.cdr.detectChanges(); 
  }

  abrirModalNuevo() {
    this.isEditing = false;
    this.currentClienteId = null;
    this.clienteForm = { 
        dni: '', primerNombre: '', segundoNombre: '', 
        apellidoPaterno: '', apellidoMaterno: '', 
        email: '', fechaNacimiento: '', telefono: '', direccion: '' 
    };
    this.showModal = true;
  }

  abrirModalEditar(cli: any) {
    this.isEditing = true;
    this.currentClienteId = cli.id;
    this.clienteForm = {
      dni: cli.dni,
      primerNombre: cli.primerNombre,
      segundoNombre: cli.segundoNombre || '',
      apellidoPaterno: cli.apellidoPaterno,
      apellidoMaterno: cli.apellidoMaterno || '',
      email: cli.email || '',
      fechaNacimiento: cli.fechaNacimiento || '',
      telefono: cli.telefono || '',
      direccion: cli.direccion || ''
    };
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges(); 
  }
  
  guardarCliente() {
    if (!this.negocioId) return;

    // Validación de los @NotBlank de tu Java
    if (!this.clienteForm.dni || !this.clienteForm.primerNombre || !this.clienteForm.apellidoPaterno) {
      Swal.fire('Error', 'El DNI, Primer Nombre y Apellido Paterno son obligatorios.', 'error');
      return;
    }

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    // 🔥 Envío de JSON Puro (No es FormData porque no hay imagen)
    const requestDTO = {
      dni: this.clienteForm.dni,
      primerNombre: this.clienteForm.primerNombre,
      segundoNombre: this.clienteForm.segundoNombre,
      apellidoPaterno: this.clienteForm.apellidoPaterno,
      apellidoMaterno: this.clienteForm.apellidoMaterno,
      email: this.clienteForm.email,
      fechaNacimiento: this.clienteForm.fechaNacimiento ? this.clienteForm.fechaNacimiento : null,
      telefono: this.clienteForm.telefono,
      direccion: this.clienteForm.direccion
    };

    Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    if (this.isEditing && this.currentClienteId) {
      this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/clientes/${this.currentClienteId}`, requestDTO, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Cliente actualizado!'),
          error: (err) => this.manejarError(err)
        });
    } else {
      this.http.post(`${this.apiUrl}/negocios/${this.negocioId}/clientes`, requestDTO, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Cliente creado exitosamente!'),
          error: (err) => this.manejarError(err)
        });
    }
  }

  postGuardadoExitoso(mensaje: string) {
    this.cerrarModal(); 
    Swal.fire('Éxito', mensaje, 'success');
    if (this.negocioId) this.cargarClientes(this.negocioId);
  }

  eliminarCliente(id: number) {
    if (!this.negocioId) return;

    Swal.fire({
      title: '¿Estás seguro?',
      text: "Eliminarás este cliente de tu base de datos.",
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

        this.http.delete(`${this.apiUrl}/negocios/${this.negocioId}/clientes/${id}`, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Eliminado!', 'El cliente ha sido borrado.', 'success');
            this.cargarClientes(this.negocioId!);
          },
          error: (err) => this.manejarError(err)
        });
      }
    });
  }

  manejarError(err: any) {
    Swal.close();
    console.error('Error HTTP:', err);
    if (err.status === 401) {
      Swal.fire({ icon: 'warning', title: 'Sesión expirada', text: 'Cierra sesión y vuelve a entrar.', confirmButtonColor: '#ed8936' });
    } else {
      Swal.fire('Oops...', 'Revisa que el DNI no esté duplicado o los datos sean correctos.', 'error');
    }
  }
}