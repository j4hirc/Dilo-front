import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink], 
  templateUrl: './inventario.html',
  styleUrls: ['./inventario.css'],
})
export class Inventario implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  inventario: any[] = [];
  inventarioFiltrado: any[] = [];
  bodegasDisponibles: string[] = []; 

  totalInvertido: number = 0;
  totalArticulos: number = 0;

  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  searchTerm: string = '';
  bodegaSeleccionada: string = '';

  // 🔥 VARIABLES PARA EL MODAL DE LOTES
  showModalLotes = false;
  isLoadingLotes = false;
  productoLotesActivo: any = null;
  lotesDelProducto: any[] = [];

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;

    if (this.negocioId) {
      this.cargarInventario(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  

  cargarInventario(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).subscribe({
      next: (data) => {
        this.inventario = (data || []).map(item => ({
            ...item,
            costoPromedio: Number(item.costoPromedio || 0),
            valorInventario: Number(item.valorInventario || 0),
            cantidadActual: Number(item.cantidadActual || 0)
        }));

        const bodegasSet = new Set(this.inventario.map(item => item.bodegaNombre));
        this.bodegasDisponibles = Array.from(bodegasSet);

        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar el inventario:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltros() {
    let result = this.inventario;

    if (this.bodegaSeleccionada) {
      result = result.filter(item => item.bodegaNombre === this.bodegaSeleccionada);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(item =>
        (item.productoNombre && item.productoNombre.toLowerCase().includes(term)) ||
        (item.productoCodigo && item.productoCodigo.toLowerCase().includes(term))
      );
    }

    this.inventarioFiltrado = result;
    this.calcularTotales(); 
    this.cdr.detectChanges();
  }

  // 🔥 NUEVO: Limpia los filtros rápidamente
  limpiarFiltros() {
      this.searchTerm = '';
      this.bodegaSeleccionada = '';
      this.aplicarFiltros();
  }

  calcularTotales() {
      this.totalInvertido = this.inventarioFiltrado.reduce((sum, item) => sum + item.valorInventario, 0);
      this.totalArticulos = this.inventarioFiltrado.reduce((sum, item) => sum + item.cantidadActual, 0);
  }

  editarStockMinimo(item: any) {
    if (!this.negocioId) return;

    Swal.fire({
      title: 'Editar Stock Mínimo',
      text: `¿Cuál es el mínimo permitido para "${item.productoNombre}" en la bodega ${item.bodegaNombre}?`,
      input: 'number',
      inputValue: item.stockMinimo,
      inputAttributes: { min: '0', step: '1' },
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ed8936',
    }).then((result) => {
      if (result.isConfirmed) {
        const nuevoMinimo = parseInt(result.value);
        if (nuevoMinimo >= 0) {

          const rawToken = localStorage.getItem('dilo_token') || '';
          const cleanToken = rawToken.replace(/['"]+/g, '');
          const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

          Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });

          this.http.patch(`${this.apiUrl}/negocios/${this.negocioId}/inventario/${item.id}/stock-minimo?valor=${nuevoMinimo}`, null, { headers }).subscribe({
            next: () => {
              Swal.fire('¡Actualizado!', 'El stock mínimo ha sido guardado.', 'success');
              this.cargarInventario(this.negocioId!); 
            },
            error: (err) => {
              Swal.fire('Error', 'No se pudo actualizar el stock mínimo', 'error');
            }
          });
        }
      }
    });
  }

  // 🔥 NUEVOS MÉTODOS PARA AUDITORÍA DE LOTES
  abrirModalLotes(item: any) {
      if (!this.negocioId) return;

      this.productoLotesActivo = item;
      this.showModalLotes = true;
      this.isLoadingLotes = true;
      this.lotesDelProducto = [];

      const rawToken = localStorage.getItem('dilo_token') || '';
      const cleanToken = rawToken.replace(/['"]+/g, '');
      const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

      // Consultamos al backend los lotes activos
      this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/inventario/bodegas/${item.bodegaId}/productos/${item.productoId}/lotes`, { headers }).subscribe({
          next: (data) => {
              this.lotesDelProducto = data || [];
              this.isLoadingLotes = false;
              this.cdr.detectChanges();
          },
          error: (err) => {
              console.error('Error al cargar lotes', err);
              this.isLoadingLotes = false;
              this.cdr.detectChanges();
          }
      });
  }

  cerrarModalLotes() {
      this.showModalLotes = false;
      this.productoLotesActivo = null;
      this.lotesDelProducto = [];
  }
}