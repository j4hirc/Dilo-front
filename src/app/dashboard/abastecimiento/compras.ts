import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { NgSelectModule } from '@ng-select/ng-select';

@Component({
  selector: 'app-compras',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
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

  showModal = false;
  showModalDetalles = false;
  compraSeleccionada: any = null;

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
        setTimeout(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        });
      }
    });
  }

  cargarCatalogos(id: number) {
    const headers = this.getHeaders();
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/proveedores`, { headers }).subscribe(res => this.proveedores = res.filter((p: any) => p.estado));
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

  abrirModalDetalles(compra: any) {
    this.compraSeleccionada = compra;
    this.showModalDetalles = true;
  }

  customProductSearch(term: string, item: any) {
    term = term.toLowerCase();
    const nombre = item.nombre ? item.nombre.toLowerCase() : '';
    const codigo = item.codigoPrincipal ? String(item.codigoPrincipal).toLowerCase() : '';

    return nombre.includes(term) || codigo.includes(term);
  }

  cerrarModalDetalles() {
    this.showModalDetalles = false;
    this.compraSeleccionada = null;
  }

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

 crearBodegaRapida() {
    Swal.fire({
      title: 'Nueva Bodega',
      html: `
        <div style="display:flex; flex-direction:column; gap:15px; text-align:left;">
            <input id="swal-bod-nombre" class="swal2-input" placeholder="Nombre de la bodega *" style="margin:0; width:100%; box-sizing:border-box;">
            <input id="swal-bod-dir" class="swal2-input" placeholder="Dirección (Opcional)" style="margin:0; width:100%; box-sizing:border-box;">
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#ea580c',
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-bod-nombre') as HTMLInputElement).value.trim();
        const direccion = (document.getElementById('swal-bod-dir') as HTMLInputElement).value.trim();
        if (!nombre) {
          Swal.showValidationMessage('El nombre es obligatorio');
          return false;
        }
        return { nombre, direccion: direccion || 'S/D' };
      }
    }).then((result) => {
      if (result.isConfirmed && this.negocioId) {
        const headers = this.getHeaders();
        Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });
        this.http.post<any>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, result.value, { headers }).subscribe({
          next: (nuevaBodega) => {
            Swal.close();
            this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, { headers }).subscribe(res => {
              this.bodegas = res;
              this.compraForm.bodegaIngresoId = nuevaBodega?.id || res[res.length - 1]?.id;
              this.cdr.detectChanges();
            });
          },
          error: (err) => {
            const msg = err.error?.message || err.error || 'Error desconocido';
            Swal.fire('No se pudo crear', msg, 'error');
          }
        });
      }
    });
  }

  crearProveedorRapido() {
    Swal.fire({
      title: 'Nuevo Proveedor',
      html: 
        '<div style="display:flex; flex-direction:column; gap:10px; text-align:left;">' +
            '<input id="swal-prov-nombre" class="swal2-input" placeholder="Nombre / Razón Social *" style="margin:0; width:100%; box-sizing:border-box;">' +
            '<input id="swal-prov-dni" class="swal2-input" placeholder="RUC / DNI *" style="margin:0; width:100%; box-sizing:border-box;">' +
            '<input id="swal-prov-tel" class="swal2-input" placeholder="Teléfono" style="margin:0; width:100%; box-sizing:border-box;">' +
        '</div>',
      showCancelButton: true,
      confirmButtonColor: '#ea580c',
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-prov-nombre') as HTMLInputElement).value.trim();
        const dni = (document.getElementById('swal-prov-dni') as HTMLInputElement).value.trim();
        const telefono = (document.getElementById('swal-prov-tel') as HTMLInputElement).value.trim();
        
        if (!nombre || !dni) {
          Swal.showValidationMessage('Nombre y RUC/DNI son obligatorios');
          return false;
        }
        
        // Exactamente el payload que espera tu API de Proveedores
        return { 
          nombre: nombre, 
          dni: dni, 
          telefono: telefono || 'S/T', 
          estado: true,
          categoriasIds: [] // Enviamos el array vacío que exige el backend
        };
      }
    }).then((result) => {
      if (result.isConfirmed && this.negocioId) {
        const headers = this.getHeaders();
        Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        
        this.http.post<any>(`${this.apiUrl}/negocios/${this.negocioId}/proveedores`, result.value, { headers }).subscribe({
          next: (nuevoProv) => {
            Swal.close();
            this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/proveedores`, { headers }).subscribe(res => {
              this.proveedores = res.filter((p: any) => p.estado);
              this.compraForm.proveedorId = nuevoProv?.id || this.proveedores[this.proveedores.length - 1]?.id;
              this.cdr.detectChanges();
            });
          },
          error: (err) => {
            console.error('Error 400 al crear proveedor:', err);
            const msg = err.error?.message || err.error || 'El DNI ya existe o los datos son inválidos.';
            Swal.fire('No se pudo crear', msg, 'error');
          }
        });
      }
    });
  }

  crearProductoRapido() {
    let opcionesCategorias = '<option value="">-- Selecciona una categoría --</option>';
    
    const headers = this.getHeaders();
    Swal.fire({ title: 'Preparando...', didOpen: () => Swal.showLoading() });
    
    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/categorias`, { headers }).subscribe({
      next: (categorias) => {
        // 1. GENERAMOS EL CÓDIGO AQUÍ
        const siguienteCodigo = this.generarSiguienteCodigo();

        categorias.forEach(cat => {
            opcionesCategorias += `<option value="${cat.id}">${cat.nombre}</option>`;
        });

        Swal.fire({
          title: 'Producto Express',
          html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left; font-size: 0.9rem;">
                <!-- 2. INYECTAMOS EL CÓDIGO EN EL ATRIBUTO value="..." DEL INPUT -->
                <input id="swal-prod-cod" class="swal2-input" value="${siguienteCodigo}" placeholder="Código (Dejar vacío para S/C)" style="margin:0; width:100%; box-sizing:border-box;">
                <input id="swal-prod-nom" class="swal2-input" placeholder="Nombre del Producto *" style="margin:0; width:100%; box-sizing:border-box;">
                <select id="swal-prod-cat" class="swal2-select" style="margin:0; width:100%; box-sizing:border-box;">
                    ${opcionesCategorias}
                </select>
                <div style="display:flex; justify-content:space-between; margin-top:10px;">
                    <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="swal-prod-iva"> Graba IVA</label>
                    <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" id="swal-prod-cad"> Tiene Caducidad</label>
                </div>
            </div>
          `,
          showCancelButton: true,
          confirmButtonColor: '#ea580c',
          confirmButtonText: 'Crear y Seleccionar',
          cancelButtonText: 'Cancelar',
          preConfirm: () => {
            const codigoRaw = (document.getElementById('swal-prod-cod') as HTMLInputElement).value.trim();
            const nombre = (document.getElementById('swal-prod-nom') as HTMLInputElement).value.trim();
            const categoriaVal = (document.getElementById('swal-prod-cat') as HTMLSelectElement).value;
            const grabaIva = (document.getElementById('swal-prod-iva') as HTMLInputElement).checked;
            const tieneCaducidad = (document.getElementById('swal-prod-cad') as HTMLInputElement).checked;
            
            if (!nombre || !categoriaVal) {
              Swal.showValidationMessage('Nombre y Categoría son obligatorios');
              return false;
            }

            const codigoFinal = codigoRaw || 'S/C';

            return {
              codigo: codigoFinal, 
              codigoPrincipal: codigoFinal, 
              nombre: nombre, 
              marca: 'Sin marca', 
              precio: 0, 
              precioUnitario: 0, 
              categoriaId: Number(categoriaVal),
              grabaIva: grabaIva, 
              unidadMedida: 'UNIDADES', 
              tieneCaducidad: tieneCaducidad
            };
          }
        }).then((result) => {
          if (result.isConfirmed && this.negocioId) {
            Swal.fire({ title: 'Creando producto...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const formData = new FormData();
            formData.append('datos', new Blob([JSON.stringify(result.value)], { type: 'application/json' }));
            
            this.http.post<any>(`${this.apiUrl}/negocios/${this.negocioId}/productos`, formData, { headers }).subscribe({
              next: () => {
                Swal.close();
                this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/productos`, { headers }).subscribe(res => {
                  this.productos = res;
                  if(res.length > 0) {
                      const recienCreado = res[res.length - 1];
                      this.detalleTemp.productoId = recienCreado.id;
                      this.onProductoChange();
                  }
                  this.cdr.detectChanges();
                });
              },
              error: (err) => {
                console.error('Detalle del error 400:', err);
                const msg = err.error?.message || err.error || 'Revisa los datos ingresados.';
                Swal.fire('No se pudo crear', msg, 'error');
              }
            });
          }
        });
      },
      error: () => {
        Swal.fire('Error', 'No se pudieron cargar las categorías', 'error');
      }
    });
  }



  generarSiguienteCodigo(): string {
    if (!this.productos || this.productos.length === 0) {
      return 'PROD-001';
    }

    let maxNumber = 0;
    let prefix = 'PROD-';

    this.productos.forEach(prod => {
      const codigo = prod.codigoPrincipal;
      if (codigo && codigo !== 'S/C') {
        const match = codigo.match(/^(.*?)(\d+)$/);
        if (match) {
          const currentPrefix = match[1];
          const currentNumber = parseInt(match[2], 10);
          if (currentNumber > maxNumber) {
            maxNumber = currentNumber;
            prefix = currentPrefix;
          }
        }
      }
    });

    const nextNumber = maxNumber + 1;
    const padLength = Math.max(3, String(maxNumber).length);
    const paddedNumber = nextNumber.toString().padStart(padLength, '0');

    return `${prefix}${paddedNumber}`;
  }


}