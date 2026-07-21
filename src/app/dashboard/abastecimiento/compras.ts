import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-compras',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './compras.html',
  styleUrls: ['./compras.css'],
})
export class Compras implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  compras: any[] = [];
  comprasFiltradas: any[] = [];
  
  proveedores: any[] = [];
  bodegas: any[] = [];
  productos: any[] = [];

  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  searchTerm: string = '';
  
  // Modales
  showModal = false;
  showModalDetalles = false; // 🔥 NUEVO MODAL DE LECTURA
  compraSeleccionada: any = null; // 🔥 ALMACENA LA COMPRA A VER

  compraForm = {
    proveedorId: null as number | null,
    bodegaIngresoId: null as number | null,
    numeroComprobante: '',
    detalles: [] as any[]
  };

  detalleTemp = {
    productoId: null as number | null,
    cantidad: 1,
    costoUnitario: 0,
    fechaCaducidad: null as string | null
  };

  productoRequiereCaducidad = false;

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;

    if (this.negocioId) {
      this.cargarCompras(this.negocioId);
      this.cargarCatalogos(this.negocioId);
    } else {
      setTimeout(() => { this.isLoading = false; this.cdr.detectChanges(); });
    }
  }

  cargarCompras(id: number) {
    this.isLoading = true;
    const headers = this.getHeaders();
    
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/compras`, { headers }).subscribe({
      next: (data) => {
        this.compras = data || [];
        this.aplicarFiltros();
        setTimeout(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        this.compras = [];
        this.aplicarFiltros();
        // 🔥 FIX NG0100: También lo protegemos si da error
        setTimeout(() => { 
          this.isLoading = false; 
          this.cdr.detectChanges(); 
        });
      }
    });
  }

  cargarCatalogos(id: number) {
    const headers = this.getHeaders();
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, { headers }).subscribe(res => this.proveedores = res.filter((p:any) => p.estado));
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/bodegas`, { headers }).subscribe(res => this.bodegas = res);
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, { headers }).subscribe(res => this.productos = res);
  }

  aplicarFiltros() {
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      this.comprasFiltradas = this.compras.filter(c => 
        (c.numeroComprobante && c.numeroComprobante.toLowerCase().includes(term)) ||
        (c.proveedorNombre && c.proveedorNombre.toLowerCase().includes(term))
      );
    } else {
      this.comprasFiltradas = [...this.compras];
    }
    this.cdr.detectChanges();
  }

  // --- LÓGICA DEL MODAL DE REGISTRO ---
  abrirModalNuevo() {
    this.compraForm = {
      proveedorId: null,
      bodegaIngresoId: null,
      numeroComprobante: '',
      detalles: []
    };
    this.limpiarDetalleTemp();
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges();
  }

  // --- 🔥 LÓGICA DEL NUEVO MODAL DE LECTURA DE DETALLES ---
  abrirModalDetalles(compra: any) {
    this.compraSeleccionada = compra;
    this.showModalDetalles = true;
  }

  cerrarModalDetalles() {
    this.showModalDetalles = false;
    this.compraSeleccionada = null;
  }

  // --- LÓGICA DEL CARRITO ---
  onProductoChange() {
    if (!this.detalleTemp.productoId) return;
    
    const prod = this.productos.find(p => p.id === this.detalleTemp.productoId);
    if (prod) {
        this.detalleTemp.costoUnitario = 0; 
        
        this.productoRequiereCaducidad = prod.tieneCaducidad;
        if (!this.productoRequiereCaducidad) {
            this.detalleTemp.fechaCaducidad = null;
        }
    }
  }

  agregarDetalle() {
    if (!this.detalleTemp.productoId || this.detalleTemp.cantidad <= 0 || this.detalleTemp.costoUnitario < 0) {
        Swal.fire('Atención', 'Selecciona un producto y verifica la cantidad/costo.', 'warning');
        return;
    }

    if (this.productoRequiereCaducidad && !this.detalleTemp.fechaCaducidad) {
        Swal.fire('Caducidad Obligatoria', 'Este producto está marcado como perecedero. Debes ingresar su fecha de caducidad.', 'error');
        return;
    }

    const indexExistente = this.compraForm.detalles.findIndex(d => d.productoId === this.detalleTemp.productoId && d.costoUnitario === this.detalleTemp.costoUnitario);
    
    if (indexExistente !== -1) {
        this.compraForm.detalles[indexExistente].cantidad += this.detalleTemp.cantidad;
    } else {
        this.compraForm.detalles.push({ ...this.detalleTemp });
    }

    this.limpiarDetalleTemp();
  }

  removerDetalle(index: number) {
      this.compraForm.detalles.splice(index, 1);
  }

  limpiarDetalleTemp() {
      this.detalleTemp = { productoId: null, cantidad: 1, costoUnitario: 0, fechaCaducidad: null };
      this.productoRequiereCaducidad = false;
  }

  calcularTotalCompra(): number {
      return this.compraForm.detalles.reduce((acc, current) => acc + (current.cantidad * current.costoUnitario), 0);
  }

  obtenerNombreProducto(id: number): string {
      const prod = this.productos.find(p => p.id === id);
      return prod ? `${prod.codigoPrincipal} - ${prod.nombre}` : 'Producto Desconocido';
  }


  registrarCompra() {
    if (!this.negocioId) return;

    if (!this.compraForm.proveedorId || !this.compraForm.bodegaIngresoId || !this.compraForm.numeroComprobante) {
      Swal.fire('Error', 'Completa los datos del comprobante (Proveedor, Bodega y Número).', 'error');
      return;
    }

    if (this.compraForm.detalles.length === 0) {
      Swal.fire('Error', 'Debes añadir al menos un producto al ingreso.', 'error');
      return;
    }

    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    const emailUsuario = usuarioLogueado?.email || '';

    Swal.fire({ title: 'Procesando e Ingresando Lotes...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const headers = this.getHeaders();
    const url = `${this.apiUrl}/negocios/${this.negocioId}/compras?emailUsuario=${emailUsuario}`;

    this.http.post(url, this.compraForm, { headers }).subscribe({
      next: (res: any) => {
        this.cerrarModal();
        Swal.fire('¡Abastecimiento Registrado!', `Se ha ingresado el inventario. Total invertido: $${res.totalCompra}`, 'success');
        this.cargarCompras(this.negocioId!);
      },
      error: (err) => {
        Swal.close();
        console.error(err);
        Swal.fire('Error', err.error?.message || 'No se pudo procesar el abastecimiento.', 'error');
      }
    });
  }

  private getHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }
}