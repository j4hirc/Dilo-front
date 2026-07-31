import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-admin-negocios', 
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-negocios.html', 
  styleUrls: ['../admin-panel.css', './admin-negocios.css']
})
export class AdminNegocios implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef); // 🔥 Megáfono añadido
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  isLoading = false;
  negocios: any[] = [];
  negociosFiltrados: any[] = [];
  busquedaNegocio: string = '';

  showModalNegocio = false;
  negocioEditando: any = {};

  ngOnInit() {
    this.cargarNegocios();
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  formatearFecha(fecha: any, tipo: 'fecha' | 'hora' = 'fecha'): string {
    if (!fecha || fecha === null) return 'Sin Fecha';
    try {
      let dateObj: Date;
      if (Array.isArray(fecha)) {
        dateObj = new Date(fecha[0], fecha[1] - 1, fecha[2], fecha[3] || 0, fecha[4] || 0);
      } else {
        const safeDate = fecha.toString().split('.')[0].replace(' ', 'T');
        dateObj = new Date(safeDate);
      }
      
      if (isNaN(dateObj.getTime())) return 'Sin Fecha';

      if (tipo === 'fecha') {
        return dateObj.toLocaleDateString('es-EC', { year: 'numeric', month: '2-digit', day: '2-digit' });
      } else {
        return dateObj.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      return 'Sin Fecha';
    }
  }

  cargarNegocios() {
    this.isLoading = true;
    this.cdr.detectChanges();

    this.http.get<any[]>(`${this.apiUrl}/negocios`, { headers: this.getAuthHeaders() })
      .subscribe({
        next: (data) => {
          this.negocios = data || [];
          this.negociosFiltrados = [...this.negocios];
          this.isLoading = false;
          this.cdr.detectChanges(); // 🔥 Despertamos la pantalla
        },
        error: (err) => { 
          console.error(err);
          this.isLoading = false; 
          this.cdr.detectChanges(); 
          Swal.fire('Error', 'No se pudieron cargar los negocios.', 'error');
        }
      });
  }

  filtrarNegocios() {
    if (!this.busquedaNegocio.trim()) {
      this.negociosFiltrados = [...this.negocios];
      return;
    }
    const term = this.busquedaNegocio.toLowerCase().trim();
    this.negociosFiltrados = this.negocios.filter(n => 
      (n.razonSocial && n.razonSocial.toLowerCase().includes(term)) ||
      (n.nombreComercial && n.nombreComercial.toLowerCase().includes(term)) ||
      (n.ruc && n.ruc.toLowerCase().includes(term))
    );
    this.cdr.detectChanges();
  }

  abrirModalNegocio(negocio: any) {
    this.negocioEditando = { ...negocio };
    this.showModalNegocio = true;
  }

  guardarNegocio() {
    this.showModalNegocio = false;
    this.cdr.detectChanges(); 

    setTimeout(() => {
      Swal.fire({ title: 'Guardando cambios...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      const formData = new FormData();
      const requestDTO = {
        ruc: this.negocioEditando.ruc,
        razonSocial: this.negocioEditando.razonSocial,
        nombreComercial: this.negocioEditando.nombreComercial,
        direccion: this.negocioEditando.direccion,
        obligadoContabilidad: this.negocioEditando.obligadoContabilidad,
        metodoCosteo: this.negocioEditando.metodoCosteo
      };

      formData.append('datos', new Blob([JSON.stringify(requestDTO)], { type: 'application/json' }));

      this.http.put(`${this.apiUrl}/negocios/${this.negocioEditando.idNegocio}`, formData, { headers: this.getAuthHeaders() })
        .subscribe({
          next: () => {
            Swal.fire('¡Éxito!', 'Negocio actualizado correctamente.', 'success');
            this.cargarNegocios();
          },
          error: () => {
            Swal.fire('Error', 'No se pudo actualizar el negocio.', 'error');
            this.showModalNegocio = true; 
          }
        });
    }, 150);
  }

  eliminarNegocio(id: number) {
    Swal.fire({
      title: '¿Estás seguro?',
      text: "¡Esta acción no se puede deshacer!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar'
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire({ title: 'Eliminando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        this.http.delete(`${this.apiUrl}/negocios/${id}`, { headers: this.getAuthHeaders() })
          .subscribe({
            next: () => {
              Swal.fire('Eliminado', 'El negocio ha sido borrado.', 'success');
              this.cargarNegocios();
            },
            error: () => Swal.fire('Error', 'No se pudo eliminar.', 'error')
          });
      }
    });
  }
}