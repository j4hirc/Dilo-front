import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-admin-iva', 
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-iva.html', 
  styleUrls: ['../admin-panel.css', './admin-iva.css'] 
})
export class AdminIva implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef); // 🔥 Megáfono añadido
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  // 🔥 AQUÍ ESTÁ LO QUE FALTABA
  isLoading: boolean = true; 

  ivaActual: number = 0;
  isIvaLoaded: boolean = false;
  nuevoIva: number | null = null;

  ngOnInit() {
    this.cargarIva();
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cargarIva() {
    this.isLoading = true; // Le decimos que empiece a cargar
    
    this.http.get<any>(`${this.apiUrl}/parametros/iva`, { headers: this.getAuthHeaders() })
      .subscribe({
        next: (data) => {
          this.ivaActual = parseFloat(data.ivaActual || '0.15');
          this.isIvaLoaded = true;
          this.isLoading = false; // 🔥 Apagamos la carga al terminar
          this.cdr.detectChanges(); // Forzamos la vista
        },
        error: () => {
          this.isLoading = false; // 🔥 Apagamos la carga si hay error
          this.cdr.detectChanges();
          Swal.fire('Error', 'Fallo al cargar la configuración de IVA.', 'error');
        }
      });
  }

  actualizarIva() {
    if (this.nuevoIva === null || isNaN(this.nuevoIva)) {
      Swal.fire('Error', 'Por favor ingresa un valor numérico (ej. 0.15)', 'error');
      return;
    }

    Swal.fire({
      title: '¿Actualizar el IVA global?',
      text: `El IVA cambiará a ${this.nuevoIva * 100}%. Esto afectará a todos.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#0F172A',
      confirmButtonText: 'Sí, actualizar'
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire({ title: 'Actualizando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const payload = { nuevoIva: this.nuevoIva!.toString() };

        this.http.put(`${this.apiUrl}/parametros/iva`, payload, { headers: this.getAuthHeaders() })
          .subscribe({
            next: () => {
              this.ivaActual = this.nuevoIva!;
              this.nuevoIva = null;
              this.cdr.detectChanges();
              Swal.fire('¡Actualizado!', 'IVA modificado con éxito.', 'success');
            },
            error: () => Swal.fire('Error', 'No se pudo actualizar', 'error')
          });
      }
    });
  }
}