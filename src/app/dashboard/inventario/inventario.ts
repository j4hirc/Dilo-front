import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
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
  private apiUrl = environment.apiUrl;

  searchTerm: string = '';
  bodegaSeleccionada: string = '';

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

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  /**
   * Normaliza un ítem de inventario del API.
   * - costoPromedio: del producto
   * - valorInventario: si viene 0/null se recalcula como costo × cantidad
   */
  private normalizarItem(item: any): any {
    const cantidadActual = Number(
      item.cantidadActual ?? item.cantidad ?? item.stock ?? 0
    ) || 0;

    const stockMinimo = Number(item.stockMinimo ?? item.minimo ?? 0) || 0;

    let costoPromedio = Number(
      item.costoPromedio ??
      item.costoPromedioActual ??
      item.producto?.costoPromedioActual ??
      0
    );
    if (!isFinite(costoPromedio) || costoPromedio < 0) costoPromedio = 0;

    let valorInventario = Number(item.valorInventario ?? item.valor ?? 0);
    if (!isFinite(valorInventario) || valorInventario <= 0) {
      valorInventario = Math.round(costoPromedio * cantidadActual * 100) / 100;
    } else {
      valorInventario = Math.round(valorInventario * 100) / 100;
    }

    return {
      ...item,
      productoId: item.productoId ?? item.producto?.id ?? null,
      productoNombre: item.productoNombre ?? item.producto?.nombre ?? 'Producto',
      productoCodigo: item.productoCodigo ?? item.producto?.codigoPrincipal ?? '',
      bodegaId: item.bodegaId ?? item.bodega?.id ?? null,
      bodegaNombre: item.bodegaNombre ?? item.bodega?.nombre ?? 'Bodega',
      cantidadActual,
      stockMinimo,
      costoPromedio,
      valorInventario,
      alertaStock: cantidadActual <= stockMinimo
    };
  }

  cargarInventario(id: number) {
    this.isLoading = true;
    const headers = this.getAuthHeaders();

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).subscribe({
      next: (data) => {
        const lista = Array.isArray(data) ? data : [];
        this.inventario = lista.map(item => this.normalizarItem(item));

        const bodegasSet = new Set(
          this.inventario.map(item => item.bodegaNombre).filter(Boolean)
        );
        this.bodegasDisponibles = Array.from(bodegasSet).sort();

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
    let result = [...this.inventario];

    if (this.bodegaSeleccionada) {
      result = result.filter(item => item.bodegaNombre === this.bodegaSeleccionada);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase().trim();
      result = result.filter(item =>
        (item.productoNombre && item.productoNombre.toLowerCase().includes(term)) ||
        (item.productoCodigo && item.productoCodigo.toLowerCase().includes(term))
      );
    }

    this.inventarioFiltrado = result;
    this.calcularTotales();
    this.cdr.detectChanges();
  }

  limpiarFiltros() {
    this.searchTerm = '';
    this.bodegaSeleccionada = '';
    this.aplicarFiltros();
  }

  calcularTotales() {
    this.totalInvertido = this.inventarioFiltrado.reduce((sum, item) => {
      const v = Number(item.valorInventario);
      return sum + (isFinite(v) ? v : 0);
    }, 0);

    this.totalArticulos = this.inventarioFiltrado.reduce((sum, item) => {
      const c = Number(item.cantidadActual);
      return sum + (isFinite(c) ? c : 0);
    }, 0);
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
        const nuevoMinimo = parseInt(result.value, 10);
        if (nuevoMinimo >= 0) {
          const headers = this.getAuthHeaders();
          Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });

          this.http.patch(
            `${this.apiUrl}/negocios/${this.negocioId}/inventario/${item.id}/stock-minimo?valor=${nuevoMinimo}`,
            null,
            { headers }
          ).subscribe({
            next: () => {
              Swal.fire('¡Actualizado!', 'El stock mínimo ha sido guardado.', 'success');
              this.cargarInventario(this.negocioId!);
            },
            error: () => {
              Swal.fire('Error', 'No se pudo actualizar el stock mínimo', 'error');
            }
          });
        }
      }
    });
  }

  abrirModalLotes(item: any) {
    if (!this.negocioId) return;

    this.productoLotesActivo = item;
    this.showModalLotes = true;
    this.isLoadingLotes = true;
    this.lotesDelProducto = [];

    const headers = this.getAuthHeaders();
    this.http.get<any[]>(
      `${this.apiUrl}/negocios/${this.negocioId}/inventario/bodegas/${item.bodegaId}/productos/${item.productoId}/lotes`,
      { headers }
    ).subscribe({
      next: (data) => {
        this.lotesDelProducto = (data || []).map((lote: any) => ({
          ...lote,
          cantidadInicial: Number(lote.cantidadInicial ?? 0),
          cantidadDisponible: Number(lote.cantidadDisponible ?? 0),
          costoUnitario: Number(lote.costoUnitario ?? 0)
        }));
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

  /** Siempre exactamente 2 decimales: 12 -> 12.00 | 8.9813 -> 8.98 */
  formatCosto(valor: any): string {
    const n = Number(valor);
    if (!isFinite(n)) return '0.00';
    return n.toFixed(2);
  }

  cerrarModalLotes() {
    this.showModalLotes = false;
    this.productoLotesActivo = null;
    this.lotesDelProducto = [];
  }
}
