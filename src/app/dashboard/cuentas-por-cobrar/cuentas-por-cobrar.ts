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
  
  cuentas: any[] = [];
  cuentasBase: any[] = [];

  terminoBusqueda: string = '';
  filtroEstado: string = 'TODAS';
  /** Fecha desde (YYYY-MM-DD) para filtrar por vencimiento */
  filtroFechaDesde: string = '';
  /** Fecha hasta (YYYY-MM-DD) para filtrar por vencimiento */
  filtroFechaHasta: string = '';
  /** Campo por el que se ordena */
  ordenCampo: string = 'fechaVencimiento';
  /** Dirección: 'asc' | 'desc' */
  ordenDireccion: 'asc' | 'desc' = 'asc';

  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  showModalPago = false;
  isSaving = false;
  cuentaSeleccionada: any = null;
  montoAbono: number | null = null;

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

  cargarCuentas(id: number) {
    this.isLoading = true;
    
    this.http.get<any[]>(`${this.apiUrl}/cuentas-por-cobrar/negocio/${id}`, { headers: this.getAuthHeaders() }).subscribe({
      next: (data) => {
        setTimeout(() => {
            this.cuentasBase = Array.isArray(data) ? data.map(c => ({ ...c, showCuotas: false })) : [];
            this.calcularEstadisticas(); // Calcula sobre las de base
            this.aplicarFiltros(); // Aplica por si había algo filtrado
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

  setFiltro(estado: string) {
      this.filtroEstado = estado;
      this.aplicarFiltros();
  }

  /** Cambia el campo de ordenación (toggle asc/desc si es el mismo campo) */
  ordenarPor(campo: string) {
      if (this.ordenCampo === campo) {
          this.ordenDireccion = this.ordenDireccion === 'asc' ? 'desc' : 'asc';
      } else {
          this.ordenCampo = campo;
          this.ordenDireccion = campo === 'fechaVencimiento' ? 'asc' : 'desc';
      }
      this.aplicarFiltros();
  }

  /** Icono visual del orden actual en cabeceras */
  iconoOrden(campo: string): string {
      if (this.ordenCampo !== campo) return '';
      return this.ordenDireccion === 'asc' ? ' ▲' : ' ▼';
  }

  limpiarFiltrosFecha() {
      this.filtroFechaDesde = '';
      this.filtroFechaHasta = '';
      this.aplicarFiltros();
  }

  aplicarFiltros() {
      let filtradas = [...this.cuentasBase];

      // Filtro por estado
      if (this.filtroEstado !== 'TODAS') {
          filtradas = filtradas.filter(c => c.estado === this.filtroEstado);
      }

      // Filtro por texto (cliente o factura)
      if (this.terminoBusqueda.trim()) {
          const term = this.terminoBusqueda.toLowerCase().trim();
          filtradas = filtradas.filter(c => 
              (c.numeroFactura && c.numeroFactura.toLowerCase().includes(term)) || 
              (c.clienteNombre && c.clienteNombre.toLowerCase().includes(term))
          );
      }

      // Filtro por rango de fechas de vencimiento
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

      // Ordenación
      filtradas.sort((a, b) => {
          let valA: any;
          let valB: any;

          switch (this.ordenCampo) {
              case 'fechaVencimiento':
                  valA = a.fechaVencimiento ? new Date(a.fechaVencimiento).getTime() : 0;
                  valB = b.fechaVencimiento ? new Date(b.fechaVencimiento).getTime() : 0;
                  break;
              case 'montoTotal':
                  valA = Number(a.montoTotal || 0);
                  valB = Number(b.montoTotal || 0);
                  break;
              case 'saldoPendiente':
                  valA = Number(a.saldoPendiente || 0);
                  valB = Number(b.saldoPendiente || 0);
                  break;
              case 'clienteNombre':
                  valA = (a.clienteNombre || '').toLowerCase();
                  valB = (b.clienteNombre || '').toLowerCase();
                  break;
              default:
                  valA = a.fechaVencimiento ? new Date(a.fechaVencimiento).getTime() : 0;
                  valB = b.fechaVencimiento ? new Date(b.fechaVencimiento).getTime() : 0;
          }

          if (valA < valB) return this.ordenDireccion === 'asc' ? -1 : 1;
          if (valA > valB) return this.ordenDireccion === 'asc' ? 1 : -1;
          return 0;
      });

      this.cuentas = filtradas;
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
      if (saldo > 0 && fechaVence < hoy) {
        this.cuentasVencidas++;
      }
    });
  }

  toggleCuotas(cuenta: any) {
    cuenta.showCuotas = !cuenta.showCuotas;
  }

  abrirModalPago(cuenta: any) {
    this.cuentaSeleccionada = cuenta;
    this.montoAbono = null;
    this.showModalPago = true;
  }

  cerrarModal() {
    this.showModalPago = false;
    this.cuentaSeleccionada = null;
    this.montoAbono = null;
  }

  registrarPago() {
    if (!this.montoAbono || this.montoAbono <= 0) {
      Swal.fire('Error', 'Ingresa un monto válido mayor a 0.', 'warning');
      return;
    }

    if (this.montoAbono > this.cuentaSeleccionada.saldoPendiente) {
      Swal.fire('Error', 'El abono no puede ser mayor al saldo pendiente.', 'warning');
      return;
    }

    this.isSaving = true;
    const payload = { montoPago: this.montoAbono }; 

    this.http.post(`${this.apiUrl}/cuentas-por-cobrar/${this.cuentaSeleccionada.id}/pagar`, payload, { 
      headers: this.getAuthHeaders(),
      responseType: 'text' 
    }).subscribe({
        next: () => {
          this.isSaving = false;
          this.cerrarModal();
          Swal.fire('¡Pago Registrado!', 'El abono se aplicó correctamente.', 'success');
          this.cargarCuentas(this.negocioId!);
        },
        error: (err) => {
          this.isSaving = false;
          console.error(err);
          Swal.fire('Error', 'No se pudo registrar el pago.', 'error');
        }
      });
  }
}