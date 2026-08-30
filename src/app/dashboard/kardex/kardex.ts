import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import Swal from 'sweetalert2';
import { NgSelectModule } from '@ng-select/ng-select';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-kardex',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NgSelectModule],
  templateUrl: './kardex.html',
  styleUrls: ['./kardex.css'],
})
export class Kardex implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  searchSubject = new Subject<string>();
  paginaActual: number = 1;
elementosPorPagina: number = 50;
kardexPaginado: any[] = [];

  kardex: any[] = [];
  kardexFiltrado: any[] = [];

  productos: any[] = [];
  bodegas: any[] = [];
  inventarioTotal: any[] = [];
  bodegasOrigenDisponibles: any[] = [];
  maxCantidad: number | null = null;

  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = environment.apiUrl;

  searchTerm: string = '';
  filtroTipo: string = '';
  bodegaFiltro: string | number = '';
  fechaInicio: string = '';
  fechaFin: string = '';

  showModal = false;

  transaccionForm = {
    tipo: 'INGRESO',
    productoId: null as number | null,
    bodegaOrigenId: null as number | null,
    bodegaDestinoId: null as number | null,
    cantidad: 1,
    costoUnitario: null as number | null,
    documentoReferencia: '',
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
      setTimeout(() => {
        this.isLoading = false;
        this.cdr.detectChanges();
      });
    }

    this.searchSubject.pipe(
      debounceTime(400), // Espera 400ms después de la última tecla
      distinctUntilChanged() // Solo ejecuta si el texto realmente cambió
    ).subscribe(term => {
      this.searchTerm = term;
      this.aplicarFiltros();
    });
  }

  onSearchInput(event: any) {
    this.searchSubject.next(event.target.value);
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }


  formatCosto(valor: any): string {
    const n = Number(valor);
    if (!isFinite(n)) return '0.00';
    return n.toFixed(2);
  }

  cargarKardex(id: number) {
    this.isLoading = true;
    const headers = this.getAuthHeaders();

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/kardex`, { headers }).subscribe({
      next: (data) => {
        this.kardex = data || [];
        this.aplicarFiltros();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar Kardex:', err);
        setTimeout(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        });
      }
    });
  }

  cargarListas(id: number) {
    const headers = this.getAuthHeaders();
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, { headers }).subscribe(res => this.productos = res || []);
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/bodegas`, { headers }).subscribe(res => {
      this.bodegas = res || [];
      this.bodegasOrigenDisponibles = [...this.bodegas];
    });
    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/inventario`, { headers }).subscribe(res => this.inventarioTotal = res || []);
  }

  limpiarFiltros() {
    this.searchTerm = '';
    this.filtroTipo = '';
    this.bodegaFiltro = '';
    this.fechaInicio = '';
    this.fechaFin = '';
    this.aplicarFiltros();
  }

  aplicarFiltros() {
  // 1. Partimos de la lista original completa
  let result = this.kardex;

  // 2. Filtro por Tipo
  if (this.filtroTipo) {
    result = result.filter(k => k.tipo === this.filtroTipo);
  }

  // 3. Filtro por Bodega
  if (this.bodegaFiltro && this.bodegaFiltro !== '') {
    const idBodegaBuscada = Number(this.bodegaFiltro);
    const bodegaEncontrada = this.bodegas.find(b => b.id === idBodegaBuscada);
    
    if (bodegaEncontrada) {
      const nombreBodega = bodegaEncontrada.nombre;
      result = result.filter(k => {
        const esOrigen = k.bodegaOrigenNombre === nombreBodega;
        const esDestino = k.bodegaDestinoNombre === nombreBodega;
        return esOrigen || esDestino;
      });
    }
  }

  // 4. Filtro por Fecha de Inicio
  if (this.fechaInicio) {
    const inicioTimeStamp = new Date(this.fechaInicio + 'T00:00:00').getTime();
    result = result.filter(k => new Date(k.fechaTransaccion).getTime() >= inicioTimeStamp);
  }

  // 5. Filtro por Fecha de Fin
  if (this.fechaFin) {
    const finDate = new Date(this.fechaFin + 'T23:59:59').getTime();
    result = result.filter(k => new Date(k.fechaTransaccion).getTime() <= finDate);
  }

  // 6. Filtro por Término de Búsqueda (Buscador general)
  if (this.searchTerm && this.searchTerm.trim() !== '') {
    const term = this.searchTerm.toLowerCase().trim();
    result = result.filter(k =>
      (k.productoNombre && k.productoNombre.toLowerCase().includes(term)) ||
      (k.numeroLote && k.numeroLote.toLowerCase().includes(term)) ||
      (k.documentoReferencia && k.documentoReferencia.toLowerCase().includes(term)) ||
      (k.motivo && k.motivo.toLowerCase().includes(term)) ||
      (k.usuarioResponsableNombre && k.usuarioResponsableNombre.toLowerCase().includes(term))
    );
  }

  // 7. Guardar el resultado final YA FILTRADO
  this.kardexFiltrado = result;

  // 8. AHORA SÍ actualizamos la paginación basada en los resultados finales
  this.paginaActual = 1; 
  this.actualizarPaginacion();
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
      motivo: ''
    };
    this.maxCantidad = null;
    this.bodegasOrigenDisponibles = [...this.bodegas];
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges();
  }

  actualizarPaginacion() {
  const inicio = (this.paginaActual - 1) * this.elementosPorPagina;
  const fin = inicio + this.elementosPorPagina;
  this.kardexPaginado = this.kardexFiltrado.slice(inicio, fin);
}

cambiarPagina(incremento: number) {
  this.paginaActual += incremento;
  this.actualizarPaginacion();
}

get totalPaginas(): number {
  return Math.ceil(this.kardexFiltrado.length / this.elementosPorPagina);
}

  onTipoChange() {
    this.transaccionForm.bodegaOrigenId = null;
    this.transaccionForm.bodegaDestinoId = null;
    this.transaccionForm.cantidad = 1;
    this.transaccionForm.costoUnitario = null;
    this.transaccionForm.documentoReferencia = '';
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
      const invProducto = this.inventarioTotal.filter(
        i => i.productoId === this.transaccionForm.productoId && i.cantidadActual > 0
      );
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
      const inv = this.inventarioTotal.find(
        i => i.productoId === this.transaccionForm.productoId && i.bodegaId === this.transaccionForm.bodegaOrigenId
      );
      this.maxCantidad = inv ? inv.cantidadActual : 0;
      this.validarCantidad();
    } else {
      this.maxCantidad = null;
    }
  }

  customProductSearch(term: string, item: any) {
    term = term.toLowerCase();
    const nombre = item.nombre ? item.nombre.toLowerCase() : '';
    const codigo = item.codigoPrincipal ? String(item.codigoPrincipal).toLowerCase() : '';

    return nombre.includes(term) || codigo.includes(term);
  }

  validarCantidad() {
  }

  registrarTransaccion() {
    if (!this.negocioId) return;

    if (this.maxCantidad !== null && this.transaccionForm.cantidad > this.maxCantidad) {
      Swal.fire('Stock Insuficiente', `No puedes mover ${this.transaccionForm.cantidad} unidades. El stock máximo disponible en la bodega de origen es ${this.maxCantidad}.`, 'error');
      return;
    }

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

    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    const emailUsuario = encodeURIComponent(usuarioLogueado?.email || '');
    const headers = this.getAuthHeaders();

    Swal.fire({ title: 'Registrando ajuste...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const payload = {
      tipo: this.transaccionForm.tipo,
      productoId: this.transaccionForm.productoId,
      bodegaOrigenId: this.transaccionForm.bodegaOrigenId,
      bodegaDestinoId: this.transaccionForm.bodegaDestinoId,
      cantidad: this.transaccionForm.cantidad,
      motivo: this.transaccionForm.motivo,
      costoUnitario: this.transaccionForm.costoUnitario,
      documentoReferencia: this.transaccionForm.documentoReferencia
    };

    this.http.post(
      `${this.apiUrl}/negocios/${this.negocioId}/kardex?emailUsuario=${emailUsuario}`,
      payload,
      { headers }
    ).subscribe({
      next: () => {
        Swal.close();

        this.cerrarModal();

        Swal.fire({
          title: '¡Éxito!',
          text: 'Ajuste manual registrado correctamente en el Kardex.',
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
        Swal.fire('Error', err.error?.message || 'No se pudo registrar la transacción.', 'error');
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

  crearBodegaRapida(tipo: 'origen' | 'destino') {
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
        const headers = this.getAuthHeaders();
        Swal.fire({ title: 'Guardando...', didOpen: () => Swal.showLoading() });

        this.http.post<any>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, result.value, { headers }).subscribe({
          next: (nuevaBodega) => {
            Swal.close();
            this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/bodegas`, { headers }).subscribe(res => {
              this.bodegas = res || [];
              this.bodegasOrigenDisponibles = [...this.bodegas]; // Actualizamos lista visual

              const idBodegaCreada = nuevaBodega?.id || res[res.length - 1]?.id;

              // Asignamos según qué botón presionó
              if (tipo === 'origen') {
                this.transaccionForm.bodegaOrigenId = idBodegaCreada;
                this.onBodegaOrigenChange();
              } else {
                this.transaccionForm.bodegaDestinoId = idBodegaCreada;
              }
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

  crearProductoRapido() {
    let opcionesCategorias = '<option value="">-- Selecciona una categoría --</option>';
    const headers = this.getAuthHeaders();

    Swal.fire({ title: 'Preparando...', didOpen: () => Swal.showLoading() });

    this.http.get<any[]>(`${this.apiUrl}/negocios/${this.negocioId}/categorias`, { headers }).subscribe({
      next: (categorias) => {
        const siguienteCodigo = this.generarSiguienteCodigo();

        categorias.forEach(cat => {
          opcionesCategorias += `<option value="${cat.id}">${cat.nombre}</option>`;
        });

        Swal.fire({
          title: 'Producto Express',
          html: `
            <div style="display:flex; flex-direction:column; gap:10px; text-align:left; font-size: 0.9rem;">
                
                <!-- CONTENEDOR DEL CÓDIGO BLOQUEADO CON MENSAJE -->
                <div>
                    <input id="swal-prod-cod" class="swal2-input" value="${siguienteCodigo}" 
                        readonly 
                        style="margin:0; width:100%; box-sizing:border-box; background-color: #f1f5f9; color: #475569; font-weight: 700; cursor: not-allowed; border: 1px solid #cbd5e1;" 
                        title="El código es autogenerado por el sistema">
                        
                    <div style="margin-top: 6px; margin-bottom: 4px; font-size: 0.75rem; color: #2563eb; display: flex; align-items: flex-start; gap: 5px; line-height: 1.25;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        <span>Se genera de forma correlativa automáticamente para mantener el orden.</span>
                    </div>
                </div>

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
                  this.productos = res || [];
                  if (this.productos.length > 0) {
                    const recienCreado = this.productos[this.productos.length - 1];
                    // IMPORTANTE: En el Kardex se asigna a transaccionForm
                    this.transaccionForm.productoId = recienCreado.id;
                    this.onProductoChange();
                  }
                  this.cdr.detectChanges();
                });
              },
              error: (err) => {
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

  trackByFn(index: number, item: any): any {
  return item.id || index; // Si tu kardex tiene un 'id' único, úsalo, sino usa el index
}

}
