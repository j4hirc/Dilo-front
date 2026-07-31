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
  styleUrls: ['../admin-panel.css', './admin-usuarios.css'] 
})
export class AdminUsuarios implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  isLoading = false;
  usuarios: any[] = [];
  usuariosFiltrados: any[] = [];
  busquedaUsuario: string = '';
  
  parroquias: any[] = [];

  // Modal Ver/Editar
  showModalUsuario = false;
  usuarioViendo: any = {};
  isEditingUser = false; 
  usuarioEditando: any = {}; 

  // Modal Crear
  showModalCrear = false;
  nuevoUsuario: any = {};

  ngOnInit() {
    this.cargarUsuarios();
    this.cargarParroquias(); 
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cargarParroquias() {
    this.http.get<any[]>(`${this.apiUrl}/parroquias`, { headers: this.getAuthHeaders() })
      .subscribe({
        next: (data) => {
          this.parroquias = data || [];
          this.cdr.detectChanges();
        },
        error: (err) => console.error("Error al cargar parroquias", err)
      });
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

  // ==========================================
  // 🔥 LÓGICA DE VER / EDITAR USUARIOS
  // ==========================================
  verUsuario(usuario: any) {
    this.usuarioViendo = usuario;
    this.isEditingUser = false; 
    this.showModalUsuario = true;
  }

  toggleEditUsuario() {
    this.isEditingUser = !this.isEditingUser;
    if (this.isEditingUser) {
      this.usuarioEditando = { ...this.usuarioViendo };
      // 🔥 Nos aseguramos de que el campo password nazca vacío para no enviar cosas raras
      this.usuarioEditando.password = '';
    }
  }

  guardarEdicionUsuario() {
    // 1. Validaciones básicas
    if (!this.usuarioEditando.dni || !this.usuarioEditando.primerNombre || !this.usuarioEditando.apellidoPaterno || !this.usuarioEditando.email || !this.usuarioEditando.fechaNacimiento) {
      Swal.fire('Faltan Datos', 'El DNI, Nombres, Apellidos, Email y Fecha de Nacimiento son obligatorios.', 'warning');
      return;
    }

    // 2. Validación de Cédula
    const dniRegex = /^[0-9]{10}$/;
    if (!dniRegex.test(this.usuarioEditando.dni)) {
      Swal.fire('Cédula Inválida', 'El número de cédula debe tener exactamente 10 dígitos numéricos.', 'warning');
      return;
    }

    // 3. Validación de Edad
    const birthDate = new Date(this.usuarioEditando.fechaNacimiento);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) { age--; }

    if (age < 18) {
        Swal.fire('Usuario menor de edad', 'El usuario debe tener al menos 18 años.', 'warning');
        return;
    }
    if (age >= 99) {
        Swal.fire('Edad Inválida', 'La edad del usuario debe ser menor a 99 años.', 'warning');
        return;
    }

    // 🔥 4. Validación de Contraseña (SOLO SI ESCRIBIÓ ALGO)
    if (this.usuarioEditando.password && this.usuarioEditando.password.trim().length > 0) {
      if (this.usuarioEditando.password.length < 8) {
        Swal.fire('Contraseña Insegura', 'La nueva contraseña debe tener un mínimo de 8 caracteres.', 'warning');
        return;
      }
    }

    this.showModalUsuario = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      Swal.fire({ title: 'Guardando cambios...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      const dtoData = {
        dni: this.usuarioEditando.dni,
        primerNombre: this.usuarioEditando.primerNombre.trim(),
        segundoNombre: this.usuarioEditando.segundoNombre ? this.usuarioEditando.segundoNombre.trim() : "",
        apellidoPaterno: this.usuarioEditando.apellidoPaterno.trim(),
        apellidoMaterno: this.usuarioEditando.apellidoMaterno ? this.usuarioEditando.apellidoMaterno.trim() : "",
        email: this.usuarioEditando.email.trim(),
        telefono: this.usuarioEditando.telefono ? this.usuarioEditando.telefono.trim() : "",
        direccion: this.usuarioEditando.direccion ? this.usuarioEditando.direccion.trim() : "",
        id_parroquia: this.usuarioEditando.id_parroquia ? Number(this.usuarioEditando.id_parroquia) : null,
        fechaNacimiento: this.usuarioEditando.fechaNacimiento,
        // 🔥 Mandamos la contraseña. Si está vacía, Java la ignorará.
        password: this.usuarioEditando.password ? this.usuarioEditando.password : "" 
      };

      const formData = new FormData();
      formData.append('datos', new Blob([JSON.stringify(dtoData)], { type: 'application/json' }));

      this.http.put(`${this.apiUrl}/usuarios/${this.usuarioEditando.id}`, formData, { headers: this.getAuthHeaders() }).subscribe({
        next: () => {
          Swal.fire('¡Éxito!', 'Los datos del usuario han sido actualizados.', 'success');
          this.isEditingUser = false;
          this.cargarUsuarios();
        },
        error: (err) => {
          console.error(err);
          this.showModalUsuario = true;
          this.cdr.detectChanges();
          Swal.fire('Error al actualizar', 'No se pudo guardar la información.', 'error');
        }
      });
    }, 150);
  }

  // ==========================================
  // 🔥 LÓGICA DE CREACIÓN DE USUARIOS
  // ==========================================
  abrirModalCrear() {
    this.nuevoUsuario = { id_parroquia: '', esAdmin: false };
    this.showModalCrear = true;
  }

  guardarNuevoUsuario() {
    if (!this.nuevoUsuario.dni || !this.nuevoUsuario.primerNombre || !this.nuevoUsuario.apellidoPaterno || !this.nuevoUsuario.email || !this.nuevoUsuario.password || !this.nuevoUsuario.id_parroquia || !this.nuevoUsuario.fechaNacimiento) {
      Swal.fire('Faltan Datos', 'El DNI, Nombres, Email, Contraseña, Parroquia y Fecha de Nacimiento son obligatorios.', 'warning');
      return;
    }

    const dniRegex = /^[0-9]{10}$/;
    if (!dniRegex.test(this.nuevoUsuario.dni)) {
      Swal.fire('Cédula Inválida', 'El número de cédula debe tener exactamente 10 dígitos numéricos.', 'warning');
      return;
    }

    const birthDate = new Date(this.nuevoUsuario.fechaNacimiento);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) { age--; }

    if (age < 18) {
        Swal.fire('Usuario menor de edad', 'El usuario debe tener al menos 18 años para ser registrado.', 'warning');
        return;
    }
    if (age >= 99) {
        Swal.fire('Edad Inválida', 'La edad del usuario ingresada no es válida (debe ser menor a 99 años).', 'warning');
        return;
    }

    if (this.nuevoUsuario.password.length < 8) {
      Swal.fire('Contraseña Insegura', 'La contraseña debe tener un mínimo de 8 caracteres.', 'warning');
      return;
    }

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
        id_parroquia: Number(this.nuevoUsuario.id_parroquia),
        fechaNacimiento: this.nuevoUsuario.fechaNacimiento,
        fotoPerfil: "",
        esAdmin: this.nuevoUsuario.esAdmin
      };

      const formData = new FormData();
      formData.append('datos', new Blob([JSON.stringify(dtoData)], { type: 'application/json' }));

      this.http.post(`${this.apiUrl}/auth/registro`, formData).subscribe({
        next: () => {
          Swal.fire('¡Éxito!', 'El usuario ha sido creado y registrado en el sistema.', 'success');
          this.nuevoUsuario = { id_parroquia: '', esAdmin: false }; 
          this.cargarUsuarios();
        },
        error: (err) => {
          console.error(err);
          this.showModalCrear = true;
          this.cdr.detectChanges();
          
          let errorMsg = 'No se pudo crear el usuario. Revisa que el DNI o Email no estén repetidos.';
          if (err.error) {
             if (typeof err.error === 'string') { errorMsg = err.error; } 
             else if (err.error.message) { errorMsg = err.error.message; } 
             else if (err.error.error) { errorMsg = err.error.error; }
          }
          Swal.fire('Error al crear', errorMsg, 'error');
        }
      });
    }, 150);
  }
}