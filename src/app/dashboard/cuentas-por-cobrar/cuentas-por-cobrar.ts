import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-cuentas-por-cobrar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cuentas-por-cobrar.html',
  styleUrls: ['./cuentas-por-cobrar.css'],
})
export class CuentasPorCobrar implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  tabPrincipal: 'general' | 'clientes' = 'general';

  cuentas: any[] = [];
  cuentasBase: any[] = [];
  
  clientesAgrupados: any[] = [];
  clientesFiltrados: any[] = [];
  terminoCliente: string = '';
  showModalCliente = false;
  clienteActivo: any = null;

  metodoPagoAbono: string = 'EFECTIVO';
  referenciaAbono: string = '';

  terminoBusqueda: string = '';
  filtroEstado: string = 'TODAS';
  filtroFechaDesde: string = '';
  filtroFechaHasta: string = '';
  ordenCampo: string = 'fechaVencimiento';
  ordenDireccion: 'asc' | 'desc' = 'asc';

  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  showModalPago = false;
  isSaving = false;
  cuentaSeleccionada: any = null;
  montoAbono: number | null = null;
  
  modalTab: 'abonar' | 'historial' | 'factura' = 'abonar';
  detalleFacturaCargando = false;
  facturaCompleta: any = null; 
  pagoRecienRealizado = false; 

  cuentaDestacadaId: number | null = null;
  mensajeExitoTop: string | null = null;
  private animacionTimeout: any; 

  totalPorCobrar = 0;
  totalAbonado = 0;
  cuentasVencidas = 0;

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;

    if (this.negocioId) {
      this.cargarCuentas(this.negocioId);
    } else {
      this.isLoading = false;
    }
  }

  private getAuthHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  cambiarTabPrincipal(tab: 'general' | 'clientes') {
    this.tabPrincipal = tab;
    this.cuentaDestacadaId = null; 
  }

  cargarCuentas(id: number, backgroundRefresh: boolean = false) {
    if (!backgroundRefresh) {
      this.isLoading = true;
    }

    this.http.get<any[]>(`${this.apiUrl}/cuentas-por-cobrar/negocio/${id}`, {
      headers: this.getAuthHeaders()
    }).subscribe({
      next: (data) => {
        setTimeout(() => {
          let mapeadas = Array.isArray(data)
            ? data.map(c => {
              const nombre = this.obtenerNombreCliente(c);
              const identificacion = c.clienteIdentificacion || c.cliente?.dni || c.dni || '';
              return {
                ...c,
                showCuotas: false,
                clienteNombre: nombre || 'Sin nombre',
                identificacionFinal: identificacion
              };
            })
            : [];
            
          // 🔥 MAGIA: Filtramos y ELIMINAMOS a los "Consumidor Final" para siempre
          this.cuentasBase = mapeadas.filter(c => 
            c.clienteNombre.toLowerCase().indexOf('consumidor final') === -1
          );

          this.calcularEstadisticas();
          this.agruparClientes(); 
          this.aplicarFiltros();
          
          if (this.cuentaSeleccionada) {
            const cuentaActualizada = this.cuentasBase.find(c => c.id === this.cuentaSeleccionada.id);
            if (cuentaActualizada) {
              this.cuentaSeleccionada = cuentaActualizada;
              this.ordenarHistorial(); 
            } else {
              this.cerrarModal(); 
            }
          }

          this.isLoading = false;
          this.cdr.detectChanges();
        }, 0);
      },
      error: (err) => {
        console.error('Error al cargar cuentas:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  agruparClientes() {
    const map = new Map<string, any>();
    this.cuentasBase.forEach(c => {
      const nombre = c.clienteNombre;
      const ident = c.identificacionFinal;
      const key = this.limpiarTexto(nombre) + '-' + this.limpiarTexto(ident);

      if (!map.has(key)) {
        map.set(key, {
          nombre,
          identificacion: ident,
          totalDeuda: 0,
          cuentasPendientes: 0,
          cuentas: []
        });
      }
      const cli = map.get(key);
      cli.cuentas.push(c);
      
      if (c.saldoPendiente > 0) {
        cli.totalDeuda += Number(c.saldoPendiente);
        cli.cuentasPendientes++;
      }
    });

    this.clientesAgrupados = Array.from(map.values()).sort((a, b) => b.totalDeuda - a.totalDeuda);
    
    this.clientesAgrupados.forEach(cli => {
        cli.cuentas.sort((a: any, b: any) => {
            const aPagada = a.estado === 'PAGADA' ? 1 : 0;
            const bPagada = b.estado === 'PAGADA' ? 1 : 0;
            if (aPagada !== bPagada) return aPagada - bPagada;
            const dateA = a.fechaVencimiento ? new Date(a.fechaVencimiento).getTime() : 0;
            const dateB = b.fechaVencimiento ? new Date(b.fechaVencimiento).getTime() : 0;
            return dateA - dateB;
        });
    });

    this.filtrarClientes();

    if (this.clienteActivo) {
        const clienteActualizado = this.clientesAgrupados.find(c => c.identificacion === this.clienteActivo.identificacion && c.nombre === this.clienteActivo.nombre);
        if (clienteActualizado) {
            this.clienteActivo = clienteActualizado;
        } else {
            this.cerrarModalCliente();
        }
    }
  }

  filtrarClientes() {
    const term = this.limpiarTexto(this.terminoCliente);
    if (!term) {
      this.clientesFiltrados = [...this.clientesAgrupados];
    } else {
      this.clientesFiltrados = this.clientesAgrupados.filter(c =>
        this.limpiarTexto(c.nombre).includes(term) ||
        this.limpiarTexto(c.identificacion).includes(term)
      );
    }
  }

  abrirModalCliente(cliente: any) {
    this.clienteActivo = cliente;
    this.showModalCliente = true;
  }

  cerrarModalCliente() {
    this.showModalCliente = false;
    this.clienteActivo = null;
  }

  esClienteDestacado(cli: any): boolean {
    if (!this.cuentaDestacadaId) return false;
    return cli.cuentas.some((c: any) => c.id === this.cuentaDestacadaId);
  }

  setFiltro(estado: string) {
    this.filtroEstado = estado;
    this.aplicarFiltros();
  }

  ordenarPor(campo: string) {
    if (this.ordenCampo === campo) {
      this.ordenDireccion = this.ordenDireccion === 'asc' ? 'desc' : 'asc';
    } else {
      this.ordenCampo = campo;
      this.ordenDireccion = campo === 'fechaVencimiento' ? 'asc' : 'desc';
    }
    this.aplicarFiltros();
  }

  iconoOrden(campo: string): string {
    if (this.ordenCampo !== campo) return '';
    return this.ordenDireccion === 'asc' ? ' ▲' : ' ▼';
  }

  limpiarFiltrosFecha() {
    this.filtroFechaDesde = '';
    this.filtroFechaHasta = '';
    this.aplicarFiltros();
  }

  private limpiarTexto(texto: any): string {
    if (texto === null || texto === undefined) return '';
    return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  private obtenerNombreCliente(c: any): string {
    if (!c) return '';
    const nombre = c.nombreCliente || c.clienteNombre || c.cliente?.nombreCompleto || c.cliente?.nombre || c.cliente?.razonSocial || (c.cliente?.primerNombre ? `${c.cliente.primerNombre || ''} ${c.cliente.apellidoPaterno || ''}`.trim() : '');
    return (nombre && String(nombre).trim()) || '';
  }

  aplicarFiltros() {
    let filtradas = [...this.cuentasBase];

    if (this.filtroEstado !== 'TODAS') {
      filtradas = filtradas.filter(c => c.estado === this.filtroEstado);
    }

    if (this.terminoBusqueda.trim()) {
      const term = this.limpiarTexto(this.terminoBusqueda);
      filtradas = filtradas.filter(c => {
        const nombre = this.limpiarTexto(c.clienteNombre);
        const factura = this.limpiarTexto(c.numeroFactura ?? '');
        return nombre.includes(term) || factura.includes(term);
      });
    }

    if (this.filtroFechaDesde) {
      const desde = new Date(this.filtroFechaDesde);
      desde.setHours(0, 0, 0, 0);
      filtradas = filtradas.filter(c => {
        if (!c.fechaVencimiento) return false;
        const fv = new Date(c.fechaVencimiento);
        fv.setHours(0, 0, 0, 0);
        return fv >= desde;
      });
    }
    if (this.filtroFechaHasta) {
      const hasta = new Date(this.filtroFechaHasta);
      hasta.setHours(23, 59, 59, 999);
      filtradas = filtradas.filter(c => {
        if (!c.fechaVencimiento) return false;
        const fv = new Date(c.fechaVencimiento);
        return fv <= hasta;
      });
    }

    filtradas.sort((a, b) => {
      const aPagada = a.estado === 'PAGADA' ? 1 : 0;
      const bPagada = b.estado === 'PAGADA' ? 1 : 0;
      if (aPagada !== bPagada) {
          return aPagada - bPagada; 
      }

      let valA: any, valB: any;
      switch (this.ordenCampo) {
        case 'montoTotal': valA = Number(a.montoTotal || 0); valB = Number(b.montoTotal || 0); break;
        case 'saldoPendiente': valA = Number(a.saldoPendiente || 0); valB = Number(b.saldoPendiente || 0); break;
        case 'clienteNombre': valA = this.limpiarTexto(a.clienteNombre); valB = this.limpiarTexto(b.clienteNombre); break;
        default: valA = a.fechaVencimiento ? new Date(a.fechaVencimiento).getTime() : 0; valB = b.fechaVencimiento ? new Date(b.fechaVencimiento).getTime() : 0;
      }
      if (valA < valB) return this.ordenDireccion === 'asc' ? -1 : 1;
      if (valA > valB) return this.ordenDireccion === 'asc' ? 1 : -1;
      return 0;
    });

    this.cuentas = filtradas;
    this.cdr.detectChanges();
  }

  calcularEstadisticas() {
    this.totalPorCobrar = 0;
    this.totalAbonado = 0;
    this.cuentasVencidas = 0;
    const hoy = new Date().getTime();

    this.cuentasBase.forEach(c => {
      const monto = Number(c.montoTotal || 0);
      const saldo = Number(c.saldoPendiente || 0);
      this.totalPorCobrar += saldo;
      this.totalAbonado += (monto - saldo);
      const fechaVence = new Date(c.fechaVencimiento).getTime();
      if (saldo > 0 && fechaVence < hoy) this.cuentasVencidas++;
    });
  }

  toggleCuotas(cuenta: any) {
    cuenta.showCuotas = !cuenta.showCuotas;
  }

  ordenarHistorial() {
    if (this.cuentaSeleccionada && this.cuentaSeleccionada.historialAbonos) {
      this.cuentaSeleccionada.historialAbonos.sort((a: any, b: any) => {
        return new Date(b.fechaAbono).getTime() - new Date(a.fechaAbono).getTime();
      });
    }
  }

  getCuotasPendientes() {
    if (!this.cuentaSeleccionada || !this.cuentaSeleccionada.cuotas) return [];
    
    return this.cuentaSeleccionada.cuotas
        .filter((c: any) => c.saldoPendienteCuota > 0)
        .sort((a: any, b: any) => {
            const dateA = a.fechaVencimiento ? new Date(a.fechaVencimiento).getTime() : 0;
            const dateB = b.fechaVencimiento ? new Date(b.fechaVencimiento).getTime() : 0;
            return dateA - dateB; 
        });
  }

  abrirModalPago(cuenta: any, montoSugerido?: number) {
    this.cuentaSeleccionada = cuenta;
    this.montoAbono = montoSugerido !== undefined ? montoSugerido : null;
    this.modalTab = 'abonar'; 
    this.facturaCompleta = null; 
    this.pagoRecienRealizado = false; 
    this.ordenarHistorial(); 
    this.showModalPago = true;
  }

  cerrarModal() {
    this.showModalPago = false;
    this.montoAbono = null;
    this.metodoPagoAbono = 'EFECTIVO'; 
    this.referenciaAbono = ''; 
    this.cuentaSeleccionada = null;
    this.facturaCompleta = null;
    this.pagoRecienRealizado = false;
  }

  cambiarTabModal(tab: 'abonar' | 'historial' | 'factura') {
    this.modalTab = tab;
    if (tab === 'factura' && !this.facturaCompleta && this.negocioId) {
      this.cargarDetalleFactura();
    }
  }

  cargarDetalleFactura() {
    if (!this.cuentaSeleccionada?.facturaId) {
      Swal.fire('Atención', 'No hay ID de factura asociada a esta cuenta.', 'info');
      return;
    }

    this.detalleFacturaCargando = true;
    
    this.http.get<any>(`${this.apiUrl}/negocios/${this.negocioId}/facturas/${this.cuentaSeleccionada.facturaId}`, { headers: this.getAuthHeaders() })
      .subscribe({
        next: (factura) => {
          this.detalleFacturaCargando = false;
          this.facturaCompleta = factura;
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.detalleFacturaCargando = false;
          console.error('Error al cargar detalle de factura:', err);
          Swal.fire('Error', 'No se pudo cargar el detalle de la factura.', 'error');
          this.cdr.detectChanges();
        }
      });
  }

  registrarPago() {
    if (!this.montoAbono || this.montoAbono <= 0) {
      Swal.fire('Error', 'Ingresa un monto válido.', 'warning');
      return;
    }
    if (this.montoAbono > this.cuentaSeleccionada.saldoPendiente) {
      Swal.fire('Error', 'El abono es mayor a la deuda.', 'warning');
      return;
    }
    if (this.metodoPagoAbono === 'TRANSFERENCIA' && !this.referenciaAbono.trim()) {
      Swal.fire('Atención', 'Debes ingresar el número de referencia para transferencias.', 'warning');
      return;
    }

    this.isSaving = true;
    
    const idPagado = this.cuentaSeleccionada.id;
    const numFacturaPagada = this.cuentaSeleccionada.numeroFactura;
    const clientePagado = this.obtenerNombreCliente(this.cuentaSeleccionada);
    const montoPagado = this.montoAbono;

    const payload = { 
      montoPago: this.montoAbono,
      metodoPago: this.metodoPagoAbono,
      referencia: this.referenciaAbono
    };

    this.http.post(`${this.apiUrl}/cuentas-por-cobrar/${this.cuentaSeleccionada.id}/pagar`, payload, {
      headers: this.getAuthHeaders(), responseType: 'text'
    }).subscribe({
      next: () => {
        this.isSaving = false;
        
        this.cerrarModal();
        if (this.showModalCliente) this.cerrarModalCliente(); 

        this.cuentaDestacadaId = idPagado;

        this.mensajeExitoTop = `¡Se registró un abono de $${montoPagado.toFixed(2)} a la Factura #${numFacturaPagada} de ${clientePagado}!`;

        this.cargarCuentas(this.negocioId!, true);

        if (this.animacionTimeout) {
            clearTimeout(this.animacionTimeout);
        }
        
        this.animacionTimeout = setTimeout(() => {
            this.mensajeExitoTop = null;
            this.cdr.detectChanges();
        }, 10000); 
      },
      error: (err) => {
        this.isSaving = false;
        Swal.fire('Error', 'No se pudo registrar el pago.', 'error');
      }
    });
  }
}