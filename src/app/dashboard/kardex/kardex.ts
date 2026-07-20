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
  
  productos: any[] = [];
  bodegas: any[] = [];
  inventarioTotal: any[] = []; 
  proveedores: any[] = []; // 🔥 NUEVA LISTA DE PROVEEDORES
  bodegasOrigenDisponibles: any[] = []; 
  maxCantidad: number | null = null; 

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
    costoUnitario: null as number | null,
    documentoReferencia: '',
    motivo: '',
    proveedorId: null as number | null // 🔥 NUEVO CAMPO
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
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).subscribe(res => this.inventarioTotal = res);
    
    // 🔥 NUEVO: Descargamos la lista de proveedores
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, { headers }).subscribe(res => this.proveedores = res);
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
        (k.numeroLote && k.numeroLote.toLowerCase().includes(term)) ||
        (k.documentoReferencia && k.documentoReferencia.toLowerCase().includes(term)) ||
        (k.motivo && k.motivo.toLowerCase().includes(term))
      );
    }
    
    this.kardexFiltrado = result;
    this.cdr.detectChanges();
  }

  abrirModalNuevo() {
    this.transaccionForm = { 
        tipo: 'INGRESO', 
        productoId: null, 
        bodegaOrigenId: null, 
        bodegaDestinoId: null, 
        cantidad: 1, 
        costoUnitario: null,
        documentoReferencia: '',
        motivo: '',
        proveedorId: null // 🔥 Reseteamos proveedor
    };
    this.maxCantidad = null;
    this.bodegasOrigenDisponibles = [...this.bodegas];
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges();
  }
  
  onTipoChange() {
    this.transaccionForm.bodegaOrigenId = null;
    this.transaccionForm.bodegaDestinoId = null;
    this.transaccionForm.cantidad = 1;
    this.transaccionForm.costoUnitario = null;
    this.transaccionForm.documentoReferencia = '';
    this.transaccionForm.proveedorId = null;
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
      const invProducto = this.inventarioTotal.filter(i => i.productoId === this.transaccionForm.productoId && i.cantidadActual > 0);
      const idsBodegasConStock = invProducto.map(i => i.bodegaId);
      
      this.bodegasOrigenDisponibles = this.bodegas.filter(b => idsBodegasConStock.includes(b.id));

      if (this.bodegasOrigenDisponibles.length === 1) {
        this.transaccionForm.bodegaOrigenId = this.bodegasOrigenDisponibles[0].id;
        this.actualizarMaxCantidad();
      } else if (this.bodegasOrigenDisponibles.length === 0) {
        this.maxCantidad = 0;
        this.transaccionForm.cantidad = 0;
        Swal.fire('Sin Existencias', 'Este producto no tiene stock en ninguna bodega. No puedes transferir ni egresar.', 'info');
      } else {
        this.maxCantidad = null; 
      }
    } else {
      this.bodegasOrigenDisponibles = [...this.bodegas];
      this.maxCantidad = null;
    }
  }

  actualizarMaxCantidad() {
    if (this.transaccionForm.productoId && this.transaccionForm.bodegaOrigenId) {
      const inv = this.inventarioTotal.find(i => i.productoId === this.transaccionForm.productoId && i.bodegaId === this.transaccionForm.bodegaOrigenId);
      this.maxCantidad = inv ? inv.cantidadActual : 0;
      this.validarCantidad();
    } else {
      this.maxCantidad = null;
    }
  }

  validarCantidad() {
    if (this.maxCantidad !== null && this.transaccionForm.cantidad > this.maxCantidad) {
      this.transaccionForm.cantidad = this.maxCantidad;
    }
  }

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

    let motivoFinal = this.transaccionForm.motivo;

    // 🔥 MAGIA AQUÍ: Si hay proveedor, lo inyectamos en el motivo para que se vea hermoso en la tabla.
    if (this.transaccionForm.tipo === 'INGRESO' && this.transaccionForm.proveedorId) {
        const prov = this.proveedores.find(p => p.id === this.transaccionForm.proveedorId);
        if (prov) {
            motivoFinal = `${this.transaccionForm.motivo} (Prov: ${prov.nombre})`;
        }
    }

    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    const emailUsuario = usuarioLogueado?.email || '';

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    Swal.fire({ title: 'Registrando transacción...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // Armar DTO final
    const payload = {
        tipo: this.transaccionForm.tipo,
        productoId: this.transaccionForm.productoId,
        bodegaOrigenId: this.transaccionForm.bodegaOrigenId,
        bodegaDestinoId: this.transaccionForm.bodegaDestinoId,
        cantidad: this.transaccionForm.cantidad,
        motivo: motivoFinal, // Enviamos el motivo enriquecido
        costoUnitario: this.transaccionForm.costoUnitario,
        documentoReferencia: this.transaccionForm.documentoReferencia
    };

    this.http.post(`${this.apiUrl}/negocios/${this.negocioId}/kardex?emailUsuario=${emailUsuario}`, payload, { headers })
      .subscribe({
        next: () => {
          this.cerrarModal(); 
          
          Swal.fire({
            title: '¡Éxito!',
            text: 'Movimiento registrado correctamente en el Kardex.',
            icon: 'success',
            confirmButtonColor: '#ed8936'
          }).then(() => {
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