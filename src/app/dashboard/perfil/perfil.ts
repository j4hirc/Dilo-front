import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms'; // 🔥 VITAL PARA LOS INPUTS
import Swal from 'sweetalert2';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule], // 🔥 AGREGADO AQUÍ
  templateUrl: './perfil.html',
  styleUrls: ['./perfil.css'],
})
export class Perfil implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  usuario: any = null;
  isLoading = true;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  // Variables para la edición
  isEditing = false;
  editData: any = {};
  selectedFile: File | null = null;
  previewUrl: string | null = null;

  ngOnInit(): void {
    this.cargarMiPerfil();
  }

  cargarMiPerfil() {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any>(`${this.apiUrl}/usuarios/me`, { headers }).subscribe({
      next: (data) => {
        this.usuario = data;
        const userLocalStr = localStorage.getItem('usuario');
        if (userLocalStr) {
            const userLocal = JSON.parse(userLocalStr);
            const updatedUser = { ...userLocal, ...data };
            localStorage.setItem('usuario', JSON.stringify(updatedUser));
        }
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar el perfil:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
        Swal.fire('Error', 'No se pudo cargar la información del perfil.', 'error');
      }
    });
  }

  // 🔥 ACTIVA/DESACTIVA EL MODO EDICIÓN
  toggleEdit() {
    this.isEditing = !this.isEditing;
    if (this.isEditing) {
      // Clonar los datos para no afectar la vista si el usuario cancela
      this.editData = {
        primerNombre: this.usuario.primerNombre,
        segundoNombre: this.usuario.segundoNombre,
        apellidoPaterno: this.usuario.apellidoPaterno,
        apellidoMaterno: this.usuario.apellidoMaterno,
        telefono: this.usuario.telefono,
        direccion: this.usuario.direccion,
        fechaNacimiento: this.usuario.fechaNacimiento
      };
      this.selectedFile = null;
      this.previewUrl = null;
    }
  }

  // 🔥 DETECTA CUANDO SE ELIGE UNA FOTO NUEVA
  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      // Crear previsualización
      const reader = new FileReader();
      reader.onload = (e: any) => this.previewUrl = e.target.result;
      reader.readAsDataURL(file);
    }
  }

  // 🔥 GUARDA LOS CAMBIOS EN SPRING BOOT
  guardarCambios() {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    const formData = new FormData();
    
    // Convertimos los datos a un Blob tipo JSON (Lo que pide tu backend)
    const jsonBlob = new Blob([JSON.stringify(this.editData)], { type: 'application/json' });
    formData.append('datos', jsonBlob);

    // Si hay foto nueva, la adjuntamos
    if (this.selectedFile) {
      formData.append('foto', this.selectedFile);
    }

    this.http.put<any>(`${this.apiUrl}/usuarios/me`, formData, { headers }).subscribe({
      next: (data) => {
        this.usuario = data;
        // Actualizamos localstorage
        const userLocalStr = localStorage.getItem('usuario');
        if (userLocalStr) {
            const userLocal = JSON.parse(userLocalStr);
            const updatedUser = { ...userLocal, ...data };
            localStorage.setItem('usuario', JSON.stringify(updatedUser));
        }
        this.isEditing = false;
        this.isLoading = false;
        this.cdr.detectChanges();
        Swal.fire('¡Éxito!', 'Tu perfil ha sido actualizado correctamente.', 'success');
      },
      error: (err) => {
        console.error('Error al actualizar:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
        Swal.fire('Error', 'No se pudieron guardar los cambios.', 'error');
      }
    });
  }
}