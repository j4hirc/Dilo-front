import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2'; // 🔥 Añadido para avisar errores

@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-usuarios.html', 
  styleUrls: ['../admin-panel.css'] 
})
export class AdminUsuarios implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef); // 🔥 El Megáfono de Angular
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  isLoading = false;
  usuarios: any[] = [];
  usuariosFiltrados: any[] = [];
  busquedaUsuario: string = '';

  showModalUsuario = false;
  usuarioViendo: any = {};

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
    this.cdr.detectChanges(); // Avisamos que empezó a cargar

    this.http.get<any[]>(`${this.apiUrl}/usuarios`, { headers: this.getAuthHeaders() })
      .subscribe({
        next: (data) => {
          this.usuarios = data || [];
          this.usuariosFiltrados = [...this.usuarios];
          this.isLoading = false;
          this.cdr.detectChanges(); // 🔥 Despertamos a Angular al instante
        },
        error: (err) => { 
          console.error(err);
          this.isLoading = false; 
          this.cdr.detectChanges(); // Apagamos el spinner
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
    this.cdr.detectChanges(); // Aseguramos la búsqueda en tiempo real
  }

  verUsuario(usuario: any) {
    this.usuarioViendo = usuario;
    this.showModalUsuario = true;
  }
}