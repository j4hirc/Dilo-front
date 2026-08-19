import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './perfil.html',
  styleUrls: ['./perfil.css'],
})
export class Perfil implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  usuario: any = null;
  isLoading = true;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  isEditing = false;
  editData: any = {};
  selectedFile: File | null = null;
  previewUrl: string | null = null;

  isChangingPassword = false;
  passwordData = {
    newPassword: '',
    confirmPassword: ''
  };

  showNewPassword = false;
  showConfirmPassword = false;

  parroquiasList: any[] = [];

  ngOnInit(): void {
    this.cargarMiPerfil();
    this.cargarParroquias();
  }

  cargarParroquias() {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/parroquias`, { headers }).subscribe({
      next: (data) => {
        this.parroquiasList = data || [];
        this.cdr.detectChanges();
      },
      error: (err) => console.warn('No se pudo cargar la lista de parroquias', err)
    });
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

  toggleEdit() {
    this.isEditing = !this.isEditing;
    if (this.isEditing) {
      this.editData = {
        primerNombre: this.usuario.primerNombre,
        segundoNombre: this.usuario.segundoNombre,
        apellidoPaterno: this.usuario.apellidoPaterno,
        apellidoMaterno: this.usuario.apellidoMaterno,
        telefono: this.usuario.telefono,
        direccion: this.usuario.direccion,
        fechaNacimiento: this.usuario.fechaNacimiento,
        id_parroquia: this.usuario.id_parroquia || this.usuario.parroquia?.id || null
      };
      this.selectedFile = null;
      this.previewUrl = null;
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      const reader = new FileReader();
      reader.onload = (e: any) => this.previewUrl = e.target.result;
      reader.readAsDataURL(file);
    }
  }

  toggleChangePassword() {
    this.isChangingPassword = !this.isChangingPassword;
    if (!this.isChangingPassword) {
      this.passwordData = { newPassword: '', confirmPassword: '' };
      this.showNewPassword = false;
      this.showConfirmPassword = false;
    }
  }

  togglePasswordVisibility(field: 'new' | 'confirm') {
    if (field === 'new') {
      this.showNewPassword = !this.showNewPassword;
    } else {
      this.showConfirmPassword = !this.showConfirmPassword;
    }
  }

  guardarPassword() {
    if (!this.passwordData.newPassword || !this.passwordData.confirmPassword) {
      Swal.fire('Atención', 'Ambos campos son obligatorios.', 'warning');
      return;
    }

    if (this.passwordData.newPassword.length < 8) {
      Swal.fire('Atención', 'La contraseña debe tener al menos 8 caracteres.', 'warning');
      return;
    }

    if (this.passwordData.newPassword !== this.passwordData.confirmPassword) {
      Swal.fire('Error', 'Las contraseñas no coinciden.', 'error');
      return;
    }

    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.put<any>(`${this.apiUrl}/usuarios/me/password`, this.passwordData, { headers }).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.toggleChangePassword();
        this.cdr.detectChanges();
        Swal.fire('¡Éxito!', 'Tu contraseña ha sido actualizada correctamente.', 'success');
      },
      error: (err) => {
        console.error('Error al cambiar contraseña:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
        const mensajeError = err.error ? err.error : 'No se pudo actualizar la contraseña.';
        Swal.fire('Error', typeof mensajeError === 'string' ? mensajeError : 'Verifica tus datos.', 'error');
      }
    });
  }

  guardarCambios() {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    const formData = new FormData();
    const jsonBlob = new Blob([JSON.stringify(this.editData)], { type: 'application/json' });
    formData.append('datos', jsonBlob);

    if (this.selectedFile) {
      formData.append('foto', this.selectedFile);
    }

    this.http.put<any>(`${this.apiUrl}/usuarios/me`, formData, { headers }).subscribe({
      next: (data) => {
        this.usuario = data;
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