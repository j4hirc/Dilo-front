import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-kardex',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kardex.html',
  styleUrls: ['./kardex.css'],
})
export class Kardex implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  kardex: any[] = [];
  kardexFiltrado: any[] = [];
  
  // Listas de datos
  productos: any[] = [];
  bodegas: any[] = [];
  inventarioTotal: any[] = []; // 🔥 Guardamos el inventario actual para saber el stock
  bodegasOrigenDisponibles: any[] = []; // Bodegas filtradas que sí tienen el producto
  maxCantidad: number | null = null; // Límite de stock

  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  searchTerm: string = '';
  filtroTipo: string = ''; 

  showModal = false;
  
  transaccionForm = {
    tipo: 'INGRESO',
    productoId: null as number | null,
    bodegaOrigenId: null as number | null,
    bodegaDestinoId: null as number | null,
    cantidad: 1,
    motivo: ''
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;

    if (this.negocioId) {
      this.cargarKardex(this.negocioId);
      this.cargarListas(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarKardex(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/kardex`, { headers }).subscribe({
      next: (data) => {
        this.kardex = data || [];
        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar Kardex:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  cargarListas(id: number) {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, { headers }).subscribe(res => this.productos = res);
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/bodegas`, { headers }).subscribe(res => {
      this.bodegas = res;
      this.bodegasOrigenDisponibles = [...res]; 
    });
    // 🔥 Descargamos el stock actual en memoria
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).subscribe(res => this.inventarioTotal = res);
  }

  aplicarFiltros() {
    let result = this.kardex;
    
    if (this.filtroTipo) {
      result = result.filter(k => k.tipo === this.filtroTipo);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(k => 
        (k.productoNombre && k.productoNombre.toLowerCase().includes(term)) ||
        (k.bodegaOrigenNombre && k.bodegaOrigenNombre.toLowerCase().includes(term)) ||
        (k.bodegaDestinoNombre && k.bodegaDestinoNombre.toLowerCase().includes(term)) ||
        (k.motivo && k.motivo.toLowerCase().includes(term))
      );
    }
    
    this.kardexFiltrado = result;
    this.cdr.detectChanges();
  }

  abrirModalNuevo() {
    this.transaccionForm = { tipo: 'INGRESO', productoId: null, bodegaOrigenId: null, bodegaDestinoId: null, cantidad: 1, motivo: '' };
    this.maxCantidad = null;
    this.bodegasOrigenDisponibles = [...this.bodegas];
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges();
  }

  // ==========================================
  // 🔥 LÓGICA INTELIGENTE DE AUTO-SELECCIÓN Y LÍMITES
  // ==========================================
  
  onTipoChange() {
    this.transaccionForm.bodegaOrigenId = null;
    this.transaccionForm.bodegaDestinoId = null;
    this.transaccionForm.cantidad = 1;
    this.evaluarDisponibilidad();
  }

  onProductoChange() {
    this.transaccionForm.bodegaOrigenId = null;
    this.transaccionForm.cantidad = 1;
    this.evaluarDisponibilidad();
  }

  onBodegaOrigenChange() {
    this.actualizarMaxCantidad();
  }

  evaluarDisponibilidad() {
    if (!this.transaccionForm.productoId) return;

    if (this.transaccionForm.tipo === 'EGRESO' || this.transaccionForm.tipo === 'TRANSFERENCIA') {
      // 1. Buscamos qué bodegas tienen este producto y stock > 0
      const invProducto = this.inventarioTotal.filter(i => i.productoId === this.transaccionForm.productoId && i.cantidadActual > 0);
      const idsBodegasConStock = invProducto.map(i => i.bodegaId);
      
      // 2. Filtramos el combo para que solo salgan las bodegas que SÍ lo tienen
      this.bodegasOrigenDisponibles = this.bodegas.filter(b => idsBodegasConStock.includes(b.id));

      // 3. ¡AUTO SELECCIÓN! Si solo está en 1 bodega, la elegimos solitos
      if (this.bodegasOrigenDisponibles.length === 1) {
        this.transaccionForm.bodegaOrigenId = this.bodegasOrigenDisponibles[0].id;
        this.actualizarMaxCantidad();
      } else if (this.bodegasOrigenDisponibles.length === 0) {
        // No hay en ningún lado
        this.maxCantidad = 0;
        this.transaccionForm.cantidad = 0;
        Swal.fire('Sin Existencias', 'Este producto no tiene stock en ninguna bodega. No puedes transferir ni egresar.', 'info');
      } else {
        // Hay en varias bodegas, esperamos que él elija
        this.maxCantidad = null; 
      }
    } else {
      // Es un Ingreso, no necesitamos evaluar límites de origen
      this.bodegasOrigenDisponibles = [...this.bodegas];
      this.maxCantidad = null;
    }
  }

  actualizarMaxCantidad() {
    if (this.transaccionForm.productoId && this.transaccionForm.bodegaOrigenId) {
      const inv = this.inventarioTotal.find(i => i.productoId === this.transaccionForm.productoId && i.bodegaId === this.transaccionForm.bodegaOrigenId);
      this.maxCantidad = inv ? inv.cantidadActual : 0;
      
      // Si la cantidad que puso es mayor al máximo, se lo bajamos de golpe
      this.validarCantidad();
    } else {
      this.maxCantidad = null;
    }
  }

  validarCantidad() {
    if (this.maxCantidad !== null && this.transaccionForm.cantidad > this.maxCantidad) {
      this.transaccionForm.cantidad = this.maxCantidad; // Le cortamos las alas 🦅
    }
  }

  // ==========================================

  registrarTransaccion() {
    if (!this.negocioId) return;

    if (!this.transaccionForm.productoId || !this.transaccionForm.cantidad || !this.transaccionForm.motivo) {
      Swal.fire('Error', 'Completa los campos obligatorios (*).', 'error');
      return;
    }

    if (this.transaccionForm.tipo === 'INGRESO' && !this.transaccionForm.bodegaDestinoId) {
      Swal.fire('Error', 'Debes seleccionar una bodega destino para el ingreso.', 'error');
      return;
    }
    if (this.transaccionForm.tipo === 'EGRESO' && !this.transaccionForm.bodegaOrigenId) {
      Swal.fire('Error', 'Debes seleccionar una bodega origen para el egreso.', 'error');
      return;
    }
    if (this.transaccionForm.tipo === 'TRANSFERENCIA') {
      if (!this.transaccionForm.bodegaOrigenId || !this.transaccionForm.bodegaDestinoId) {
        Swal.fire('Error', 'La transferencia requiere bodega de origen y de destino.', 'error');
        return;
      }
      if (this.transaccionForm.bodegaOrigenId === this.transaccionForm.bodegaDestinoId) {
        Swal.fire('Error', 'No puedes transferir a la misma bodega.', 'error');
        return;
      }
    }

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    Swal.fire({ title: 'Registrando transacción...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    this.http.post(`${this.apiUrl}/negocios/${this.negocioId}/kardex`, this.transaccionForm, { headers })
      .subscribe({
        next: () => {
          // 🔥 1. CERRAMOS EL MODAL INMEDIATAMENTE ANTES DEL MENSAJE DE ÉXITO
          this.cerrarModal(); 
          
          Swal.fire({
            title: '¡Éxito!',
            text: 'Movimiento registrado correctamente en el Kardex.',
            icon: 'success',
            confirmButtonColor: '#ed8936'
          }).then(() => {
            // 🔥 2. CUANDO EL USUARIO LE DA A "OK", RECARGAMOS LOS DATOS
            this.cargarKardex(this.negocioId!);
            this.cargarListas(this.negocioId!); 
          });
        },
        error: (err) => {
          Swal.close();
          console.error(err);
          Swal.fire('Error', err.error?.message || 'No se pudo registrar la transacción. Revisa tu stock disponible.', 'error');
        }
      });
  }
}