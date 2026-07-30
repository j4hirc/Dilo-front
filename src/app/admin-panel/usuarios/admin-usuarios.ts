import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-usuarios.html', 
  styleUrls: ['../admin-panel.css'] 
})
export class AdminUsuarios implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  isLoading = false;
  usuarios: any[] = [];
  usuariosFiltrados: any[] = [];
  busquedaUsuario: string = '';

  // Modal Ver
  showModalUsuario = false;
  usuarioViendo: any = {};

  // 🔥 NUEVO: Modal Crear
  showModalCrear = false;
  nuevoUsuario: any = {};

  ngOnInit() {
    this.cargarUsuarios();
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cargarUsuarios() {
    this.isLoading = true;
    this.cdr.detectChanges();

    this.http.get<any[]>(`${this.apiUrl}/usuarios`, { headers: this.getAuthHeaders() })
      .subscribe({
        next: (data) => {
          this.usuarios = data || [];
          this.usuariosFiltrados = [...this.usuarios];
          this.isLoading = false;
          this.cdr.detectChanges();
        },
        error: (err) => { 
          console.error(err);
          this.isLoading = false; 
          this.cdr.detectChanges();
          Swal.fire('Error', 'No se pudieron cargar los usuarios.', 'error');
        }
      });
  }

  filtrarUsuarios() {
    if (!this.busquedaUsuario.trim()) {
      this.usuariosFiltrados = [...this.usuarios];
      return;
    }
    const term = this.busquedaUsuario.toLowerCase().trim();
    this.usuariosFiltrados = this.usuarios.filter(u => 
      (u.primerNombre && u.primerNombre.toLowerCase().includes(term)) ||
      (u.apellidoPaterno && u.apellidoPaterno.toLowerCase().includes(term)) ||
      (u.dni && u.dni.toLowerCase().includes(term)) ||
      (u.email && u.email.toLowerCase().includes(term))
    );
    this.cdr.detectChanges();
  }

  verUsuario(usuario: any) {
    this.usuarioViendo = usuario;
    this.showModalUsuario = true;
  }

  // ==========================================
  // 🔥 LÓGICA DE CREACIÓN DE USUARIOS
  // ==========================================
  abrirModalCrear() {
    // Inicializamos el objeto vacío pero con la parroquia 1 por defecto para que Java no falle
    this.nuevoUsuario = { id_parroquia: 1 };
    this.showModalCrear = true;
  }

  guardarNuevoUsuario() {
    // Validaciones básicas
    if (!this.nuevoUsuario.dni || !this.nuevoUsuario.primerNombre || !this.nuevoUsuario.apellidoPaterno || !this.nuevoUsuario.email || !this.nuevoUsuario.password) {
      Swal.fire('Faltan Datos', 'El DNI, Primer Nombre, Apellido Paterno, Email y Contraseña son obligatorios.', 'warning');
      return;
    }

    // Cerramos modal y redibujamos
    this.showModalCrear = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      Swal.fire({ title: 'Creando usuario...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      const dtoData = {
        dni: this.nuevoUsuario.dni,
        primerNombre: this.nuevoUsuario.primerNombre.trim(),
        segundoNombre: this.nuevoUsuario.segundoNombre ? this.nuevoUsuario.segundoNombre.trim() : "",
        apellidoPaterno: this.nuevoUsuario.apellidoPaterno.trim(),
        apellidoMaterno: this.nuevoUsuario.apellidoMaterno ? this.nuevoUsuario.apellidoMaterno.trim() : "",
        email: this.nuevoUsuario.email.trim(),
        password: this.nuevoUsuario.password,
        telefono: this.nuevoUsuario.telefono ? this.nuevoUsuario.telefono.trim() : "",
        direccion: this.nuevoUsuario.direccion ? this.nuevoUsuario.direccion.trim() : "",
        id_parroquia: Number(this.nuevoUsuario.id_parroquia || 1),
        fechaNacimiento: this.nuevoUsuario.fechaNacimiento || null,
        fotoPerfil: "" 
      };

      const formData = new FormData();
      formData.append('datos', new Blob([JSON.stringify(dtoData)], { type: 'application/json' }));

      // 🔥 FIX APLICADO: Cambiamos "/registrar" por "/registro"
      this.http.post(`${this.apiUrl}/auth/registro`, formData).subscribe({
        next: () => {
          Swal.fire('¡Éxito!', 'El usuario ha sido creado y registrado en el sistema.', 'success');
          this.nuevoUsuario = { id_parroquia: 1 }; // Limpiamos el formulario
          this.cargarUsuarios();
        },
        error: (err) => {
          console.error(err);
          this.showModalCrear = true;
          this.cdr.detectChanges();
          
          let errorMsg = 'No se pudo crear el usuario. Revisa que el DNI o Email no estén repetidos.';
          if (err.error) {
             if (typeof err.error === 'string') {
                 errorMsg = err.error;
             } else if (err.error.message) {
                 errorMsg = err.error.message;
             } else if (err.error.error) {
                 errorMsg = err.error.error;
             }
          }

          Swal.fire('Error al crear', errorMsg, 'error');
        }
      });
    }, 150);
  }
}