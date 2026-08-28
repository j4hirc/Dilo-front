import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DiaCalor {
  fecha: string;
  label: string;
  diaSemana: string;
  total: number;
  cantidad: number;
  intensidad: number;
}

interface ProductoDemanda {
  nombre: string;
  unidades: number;
  ingresos: number;
  porcentaje: number;
}

interface Comparativa {
  label: string;
  actual: number;
  anterior: number;
  variacion: number;
}

interface DetalleFacturaResumen {
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  subtotalItem: number;
}

interface FacturaClienteResumen {
  id: any;
  numero: string;
  fecha: string;
  tipo: string;
  monto: number;
  estado: string;
  subtotalIva0: number;
  subtotalIvaAplicado: number;
  totalIva: number;
  totalDescuento: number;
  detalles: DetalleFacturaResumen[];
  showDetalles?: boolean; 
}

interface CreditoClienteResumen {
  id: any;
  factura: string;
  montoTotal: number;
  saldoPendiente: number;
  fechaVencimiento: string;
  estado: string;
  subtotalIva0?: number;
  subtotalIvaAplicado?: number;
  totalIva?: number;
  totalDescuento?: number;
  detalles?: DetalleFacturaResumen[];
  showDetalles?: boolean; 
}

interface ClienteReporte {
  key: string;
  clienteId: any;
  identificacion: string | null; 
  nombre: string;
  totalFacturado: number;
  numFacturas: number;
  totalCredito: number;
  saldoPendiente: number;
  numCuentasCredito: number;
  facturas: FacturaClienteResumen[];
  creditos: CreditoClienteResumen[];
}

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reportes.html',
  styleUrls: ['./reportes.css'],
})
export class Reportes implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  isLoading = true;
  exportandoPdf = false;
  negocioId: number | null = null;
  negocioNombre = 'Mi Negocio';
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  periodoDias: number = 30;

  tabPrincipal: 'general' | 'clientes' = 'general'; 

  ventasPeriodo = 0;
  facturasPeriodo = 0;
  diasConVenta = 0;

  rachaActual = 0;
  mejorRacha = 0;
  ultimoDiaVenta: string | null = null;
  rachaActivaHoy = false;

  comparativas: Comparativa[] = [];

  heatmapDias: DiaCalor[] = [];
  maxCalorDia = 0;
  calorPorDiaSemana: { nombre: string; total: number; intensidad: number }[] = [];
  calorPorHora: { hora: string; total: number; intensidad: number }[] = [];

  topProductos: ProductoDemanda[] = [];
  topClientes: { nombre: string; total: number; facturas: number; porcentaje: number; key?: string }[] = [];
  porFormaPago: { nombre: string; total: number; porcentaje: number }[] = [];

  serieDiaria: { label: string; total: number; altura: number }[] = [];

  reporteClientes: ClienteReporte[] = [];
  reporteClientesFiltrado: ClienteReporte[] = [];
  busquedaClienteReporte = '';
  filtroSoloDeuda = false;
  totalCreditoClientes = 0;
  clientesConDeuda = 0;

  showDetalleCliente = false;
  clienteDetalle: ClienteReporte | null = null;
  modalTabCliente: 'facturas' | 'credito' = 'facturas';

  private facturasRaw: any[] = [];
  private cuentasRaw: any[] = [];

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    const usuario = userStr ? JSON.parse(userStr) : null;
    this.negocioId =
      usuario?.negocioId ||
      usuario?.selectedBusinessId ||
      usuario?.idNegocio ||
      null;

    if (this.negocioId) {
      this.cargarDatos();
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }
cambiarPeriodo(dias: number) {
  this.periodoDias = dias;
  this.procesarMetricas();
  this.procesarReporteClientes();
  this.cdr.detectChanges();   
}

  private getHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
  }

  // ==========================================
  // HELPERS DE LIMPIEZA DE DATOS (EVITAN BUGS)
  // ==========================================
  private cleanNumber(val: any): number {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    const parsed = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }

  private obtenerTotalFactura(f: any): number {
    return this.cleanNumber(f.importeTotal ?? f.valorTotal ?? f.totalFactura ?? f.total ?? f.montoTotal ?? f.monto ?? 0);
  }

  private parseFecha(val: any): Date | null {
    if (val == null || val === '') return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    
    // Si viene en formato array desde Spring Boot: [año, mes, día...]
    if (Array.isArray(val) && val.length >= 3) {
      const d = new Date(Number(val[0]), Number(val[1]) - 1, Number(val[2]), 12, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    }
    
    const s = String(val).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) {
      const d = new Date(+m[3], +m[2] - 1, +m[1], 12, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    }

    // Filtro ISO exacto para evitar el desfase de 5 horas a Ecuador
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
       const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12, 0, 0);
       return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  cargarDatos() {
    if (!this.negocioId) return;
    this.isLoading = true;
    const headers = this.getHeaders();
    const id = this.negocioId;

    const reqFacturas = this.http
      .get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers })
      .pipe(catchError(() => of([])));

    const reqNegocio = this.http
      .get<any>(`${this.apiUrl}/negocios/${id}`, { headers })
      .pipe(catchError(() => of(null)));

    const reqCuentas = this.http
      .get<any[]>(`${this.apiUrl}/cuentas-por-cobrar/negocio/${id}`, { headers })
      .pipe(catchError(() => of([])));

    forkJoin([reqFacturas, reqNegocio, reqCuentas]).subscribe(([facData, negData, cxcData]) => {
      const rawF = Array.isArray(facData) ? facData : [];
      
      // 🔥 FILTRO GLOBAL: Quitamos anuladas de raíz para que no inflen los gráficos ni el total.
      this.facturasRaw = rawF.filter(f => 
         f && (!f.estado || String(f.estado).toUpperCase() !== 'ANULADA') && 
              (!f.estadoSri || String(f.estadoSri).toUpperCase() !== 'ANULADA')
      );

      this.cuentasRaw = Array.isArray(cxcData) ? cxcData : [];
      if (negData) {
        this.negocioNombre =
          negData.nombreComercial || negData.razonSocial || 'Mi Negocio';
      }
      this.procesarMetricas();
      this.procesarReporteClientes();
      this.isLoading = false;
      this.cdr.detectChanges();
    });
  }

 private procesarMetricas() {
  const ahora = new Date();
  const inicioPeriodo = this.inicioDia(this.restarDias(ahora, this.periodoDias - 1));
  const inicioAnterior = this.inicioDia(this.restarDias(inicioPeriodo, this.periodoDias));
  const finAnterior = this.inicioDia(this.restarDias(inicioPeriodo, 1));

  // ── Clave: comparamos solo la fecha (YYYY-MM-DD) ──
  const hoyKey = this.keyFecha(ahora);
  const inicioKey = this.keyFecha(inicioPeriodo);
  const inicioAntKey = this.keyFecha(inicioAnterior);
  const finAntKey = this.keyFecha(finAnterior);

  const facturasPeriodo = this.facturasRaw.filter((f) => {
    const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt);
    if (!d) return false;
    const key = this.keyFecha(d);
    return key >= inicioKey && key <= hoyKey;
  });

  const facturasAnterior = this.facturasRaw.filter((f) => {
    const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt);
    if (!d) return false;
    const key = this.keyFecha(d);
    return key >= inicioAntKey && key <= finAntKey;
  });

  this.ventasPeriodo = facturasPeriodo.reduce((acc, f) => acc + this.obtenerTotalFactura(f), 0);
  this.facturasPeriodo = facturasPeriodo.length;

  const mapaDia = new Map<string, { total: number; cantidad: number }>();
  for (let i = 0; i < this.periodoDias; i++) {
    const d = this.restarDias(ahora, this.periodoDias - 1 - i);
    mapaDia.set(this.keyFecha(d), { total: 0, cantidad: 0 });
  }

  facturasPeriodo.forEach((f) => {
    const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt);
    if (!d) return;
    const key = this.keyFecha(d);
    const entry = mapaDia.get(key) || { total: 0, cantidad: 0 };
    entry.total += this.obtenerTotalFactura(f);
    entry.cantidad += 1;
    mapaDia.set(key, entry);
  });

  this.diasConVenta = [...mapaDia.values()].filter((v) => v.cantidad > 0).length;

  const maxTotal = Math.max(...[...mapaDia.values()].map((v) => v.total), 1);
  this.maxCalorDia = maxTotal;
  this.heatmapDias = [...mapaDia.entries()].map(([fecha, v]) => {
    const d = new Date(fecha + 'T12:00:00');
    return {
      fecha,
      label: this.fmtDiaMes(d),
      diaSemana: this.nombreDiaCorto(d),
      total: v.total,
      cantidad: v.cantidad,
      intensidad: v.total / maxTotal,
    };
  });

  const ultimos = this.heatmapDias.slice(-Math.min(14, this.periodoDias));
  const maxBarra = Math.max(...ultimos.map((d) => d.total), 1);
  this.serieDiaria = ultimos.map((d) => ({
    label: d.label,
    total: d.total,
    altura: Math.max(4, Math.round((d.total / maxBarra) * 100)),
  }));

  this.calcularRachas(mapaDia, ahora);

  const diasSem = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const acumDia = new Array(7).fill(0);
  facturasPeriodo.forEach((f) => {
    const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt);
    if (d) acumDia[d.getDay()] += this.obtenerTotalFactura(f);
  });
  const maxDiaSem = Math.max(...acumDia, 1);
  this.calorPorDiaSemana = diasSem.map((nombre, i) => ({
    nombre,
    total: acumDia[i],
    intensidad: acumDia[i] / maxDiaSem,
  }));

  const acumHora = new Array(24).fill(0);
  facturasPeriodo.forEach((f) => {
    const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt);
    if (d) acumHora[d.getHours()] += this.obtenerTotalFactura(f);
  });
  const maxHora = Math.max(...acumHora, 1);
  this.calorPorHora = acumHora.map((total, h) => ({
    hora: `${h.toString().padStart(2, '0')}:00`,
    total,
    intensidad: total / maxHora,
  }));

  const ventasAnt = facturasAnterior.reduce((acc, f) => acc + this.obtenerTotalFactura(f), 0);
  const facturasAnt = facturasAnterior.length;
  const diasAntSet = new Set(
    facturasAnterior
      .map((f) => this.parseFecha(f.fechaEmision || f.fecha || f.createdAt))
      .filter(Boolean)
      .map((d) => this.keyFecha(d!))
  );

  this.comparativas = [
    {
      label: 'Ventas totales',
      actual: this.ventasPeriodo,
      anterior: ventasAnt,
      variacion: this.variacionPct(this.ventasPeriodo, ventasAnt),
    },
    {
      label: 'Facturas emitidas',
      actual: this.facturasPeriodo,
      anterior: facturasAnt,
      variacion: this.variacionPct(this.facturasPeriodo, facturasAnt),
    },
    {
      label: 'Días con venta',
      actual: this.diasConVenta,
      anterior: diasAntSet.size,
      variacion: this.variacionPct(this.diasConVenta, diasAntSet.size),
    },
  ];

    const mapProd = new Map<string, { unidades: number; ingresos: number }>();
    facturasPeriodo.forEach((f) => {
      const dets = Array.isArray(f.detalles) ? f.detalles : [];
      dets.forEach((d: any) => {
        const nombre = d.productoNombre || d.nombre || 'Producto';
        const entry = mapProd.get(nombre) || { unidades: 0, ingresos: 0 };
        entry.unidades += Number(d.cantidad || 0);
        entry.ingresos += this.cleanNumber(d.subtotalItem || (Number(d.cantidad || 0) * Number(d.precioUnitario || 0)));
        mapProd.set(nombre, entry);
      });
    });
    const listaProd = [...mapProd.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.ingresos - a.ingresos)
      .slice(0, 8);
    const maxIng = listaProd[0]?.ingresos || 1;
    this.topProductos = listaProd.map((p) => ({
      ...p,
      porcentaje: Math.round((p.ingresos / maxIng) * 100),
    }));

    const mapCli = new Map<string, { total: number; facturas: number }>();
    facturasPeriodo.forEach((f) => {
      const nombre = f.clienteNombre || f.cliente?.nombre || f.nombreCliente || 'Consumidor Final';
      const entry = mapCli.get(nombre) || { total: 0, facturas: 0 };
      entry.total += this.obtenerTotalFactura(f);
      entry.facturas += 1;
      mapCli.set(nombre, entry);
    });
    const listaCli = [...mapCli.entries()]
      .map(([nombre, v]) => ({ nombre, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
    const maxCli = listaCli[0]?.total || 1;
    this.topClientes = listaCli.map((c) => ({
      ...c,
      key: this.normalizarNombreCliente(c.nombre),
      porcentaje: Math.round((c.total / maxCli) * 100),
    }));

    const mapPago = new Map<string, number>();
    facturasPeriodo.forEach((f) => {
      const fp = (f.formaPago || f.metodoPago || 'Otro').toString();
      mapPago.set(fp, (mapPago.get(fp) || 0) + this.obtenerTotalFactura(f));
    });
    const totalPago = [...mapPago.values()].reduce((a, b) => a + b, 0) || 1;
    this.porFormaPago = [...mapPago.entries()]
      .map(([nombre, total]) => ({
        nombre,
        total,
        porcentaje: Math.round((total / totalPago) * 100),
      }))
      .sort((a, b) => b.total - a.total);

    this.cdr.detectChanges();
  }

  exportarPdf() {
    if (this.exportandoPdf || this.isLoading) return;
    this.exportandoPdf = true;
    this.cdr.detectChanges();

    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 14;
      let y = 16;

      doc.setFillColor(23, 42, 70);
      doc.rect(0, 0, pageW, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Dilo · Rendimiento Comercial', margin, 12);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(this.negocioNombre, margin, 20);
      doc.text(`Periodo: últimos ${this.periodoDias} días`, pageW - margin, 12, { align: 'right' });
      doc.text(`Generado: ${new Date().toLocaleString('es-EC')}`, pageW - margin, 20, { align: 'right' });

      y = 36;
      doc.setTextColor(15, 23, 42);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumen del periodo', margin, y);
      y += 6;

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Métrica', 'Valor']],
        body: [
          ['Ventas del periodo', `$${this.fmtMoney(this.ventasPeriodo)}`],
          ['Facturas emitidas', String(this.facturasPeriodo)],
          ['Días con venta', String(this.diasConVenta)],
          [
            'Racha actual',
            this.rachaActual > 0
              ? `${this.rachaActual} día(s)${this.rachaActivaHoy ? ' (activa hoy)' : ''}`
              : 'Sin racha activa',
          ],
          ['Mejor racha del periodo', `${this.mejorRacha} día(s)`],
        ],
        theme: 'grid',
        headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: 'bold', fontSize: 10 },
        bodyStyles: { fontSize: 9, textColor: [15, 23, 42] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 'auto', halign: 'right' } },
      });

      y = (doc as any).lastAutoTable.finalY + 10;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Comparativa vs periodo anterior', margin, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Indicador', 'Actual', 'Anterior', 'Variación']],
        body: this.comparativas.map((c) => [
          c.label,
          c.label.includes('Ventas') ? `$${this.fmtMoney(c.actual)}` : String(Math.round(c.actual)),
          c.label.includes('Ventas') ? `$${this.fmtMoney(c.anterior)}` : String(Math.round(c.anterior)),
          `${c.variacion > 0 ? '+' : ''}${c.variacion}%`,
        ]),
        theme: 'grid',
        headStyles: { fillColor: [23, 42, 70], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });

      y = (doc as any).lastAutoTable.finalY + 10;

      this.ensureSpace(doc, y, 40);
      y = (doc as any)._rendimientoY ?? y;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Demanda por día de la semana', margin, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Día', 'Ventas']],
        body: this.calorPorDiaSemana.map((d) => [d.nombre, `$${this.fmtMoney(d.total)}`]),
        theme: 'striped',
        headStyles: { fillColor: [234, 88, 12], textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 9 },
      });

      y = (doc as any).lastAutoTable.finalY + 10;

      this.ensureSpace(doc, y, 50);
      y = (doc as any)._rendimientoY ?? y;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Productos con mayor demanda', margin, y);
      y += 4;

      if (this.topProductos.length === 0) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Sin detalle de productos en el periodo.', margin, y + 4);
        y += 12;
      } else {
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [['#', 'Producto', 'Unidades', 'Ingresos']],
          body: this.topProductos.map((p, i) => [
            String(i + 1),
            p.nombre,
            String(p.unidades),
            `$${this.fmtMoney(p.ingresos)}`,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [23, 42, 70], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      this.ensureSpace(doc, y, 45);
      y = (doc as any)._rendimientoY ?? y;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Clientes top', margin, y);
      y += 4;

      if (this.topClientes.length === 0) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Sin clientes con compras en el periodo.', margin, y + 4);
        y += 12;
      } else {
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [['#', 'Cliente', 'Facturas', 'Total']],
          body: this.topClientes.map((c, i) => [
            String(i + 1),
            c.nombre,
            String(c.facturas),
            `$${this.fmtMoney(c.total)}`,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [23, 42, 70], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      this.ensureSpace(doc, y, 40);
      y = (doc as any)._rendimientoY ?? y;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Formas de pago', margin, y);
      y += 4;

      if (this.porFormaPago.length === 0) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Sin datos de formas de pago.', margin, y + 4);
      } else {
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [['Forma de pago', 'Monto', '%']],
          body: this.porFormaPago.map((p) => [
            p.nombre,
            `$${this.fmtMoney(p.total)}`,
            `${p.porcentaje}%`,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [234, 88, 12], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 9 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      this.ensureSpace(doc, y, 50);
      y = (doc as any)._rendimientoY ?? y;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('Ventas diarias (días con movimiento)', margin, y);
      y += 4;

      const diasTabla = this.heatmapDias.filter((d) => d.cantidad > 0).slice(-20);
      if (diasTabla.length === 0) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('No hubo ventas en el periodo seleccionado.', margin, y + 4);
      } else {
        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [['Fecha', 'Día', 'Facturas', 'Total']],
          body: diasTabla.map((d) => [
            d.label,
            d.diaSemana,
            String(d.cantidad),
            `$${this.fmtMoney(d.total)}`,
          ]),
          theme: 'striped',
          headStyles: { fillColor: [23, 42, 70], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
        });
      }

      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Dilo · Página ${i} de ${totalPages}`,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 8,
          { align: 'center' }
        );
      }

      const nombreArchivo = `rendimiento_${this.negocioNombre
        .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .substring(0, 30)}_${this.periodoDias}d.pdf`;

      doc.save(nombreArchivo);
    } catch (err) {
      console.error('Error al generar PDF:', err);
      alert(
        'No se pudo generar el PDF. Instala las dependencias:\nnpm install jspdf jspdf-autotable'
      );
    } finally {
      this.exportandoPdf = false;
      this.cdr.detectChanges();
    }
  }

  private ensureSpace(doc: jsPDF, y: number, needed: number) {
    const pageH = doc.internal.pageSize.getHeight();
    if (y + needed > pageH - 16) {
      doc.addPage();
      (doc as any)._rendimientoY = 16;
    } else {
      (doc as any)._rendimientoY = y;
    }
  }

  private fmtMoney(n: number): string {
    return n.toLocaleString('es-EC', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private calcularRachas(
    mapaDia: Map<string, { total: number; cantidad: number }>,
    ahora: Date
  ) {
    let mejor = 0;
    let actual = 0;
    const keys = [...mapaDia.keys()].sort();
    for (const k of keys) {
      if ((mapaDia.get(k)?.cantidad || 0) > 0) {
        actual++;
        mejor = Math.max(mejor, actual);
      } else {
        actual = 0;
      }
    }
    this.mejorRacha = mejor;

    const hoyKey = this.keyFecha(ahora);
    const hoyTiene = (mapaDia.get(hoyKey)?.cantidad || 0) > 0;
    this.rachaActivaHoy = hoyTiene;

    let cursor = hoyTiene ? ahora : this.restarDias(ahora, 1);
    let racha = 0;
    for (let i = 0; i < 365; i++) {
      const key = this.keyFecha(cursor);
      let cantidad = 0;
      if (mapaDia.has(key)) {
        cantidad = mapaDia.get(key)!.cantidad;
      } else {
        cantidad = this.facturasRaw.filter((f) => {
          const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt);
          return d && this.keyFecha(d) === key;
        }).length;
      }
      if (cantidad > 0) {
        racha++;
        cursor = this.restarDias(cursor, 1);
      } else {
        break;
      }
    }
    this.rachaActual = racha;

    const conVenta = keys.filter((k) => (mapaDia.get(k)?.cantidad || 0) > 0);
    this.ultimoDiaVenta = conVenta.length ? conVenta[conVenta.length - 1] : null;
  }

  private keyFecha(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private inicioDia(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  private restarDias(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() - n);
    return r;
  }

  private fmtDiaMes(d: Date): string {
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
  }

  private nombreDiaCorto(d: Date): string {
    return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()];
  }

  private variacionPct(actual: number, anterior: number): number {
    if (anterior === 0) return actual > 0 ? 100 : 0;
    return Math.round(((actual - anterior) / anterior) * 1000) / 10;
  }

  private extraerIdentificacionDeTexto(texto: any): string | null {
    const s = String(texto || '');
    const m = s.match(/\((\d{7,13})\)/) || s.match(/\b(\d{10,13})\b/);
    return m ? m[1] : null;
  }

  private normalizarNombreCliente(nombre: any): string {
    return String(nombre || 'Consumidor Final')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\(\s*\d{7,13}\s*\)/g, ' ')
      .replace(/\b\d{10,13}\b/g, ' ')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  private nombreDisplay(nombre: any): string {
    return String(nombre || 'Cliente')
      .replace(/\(\s*\d{7,13}\s*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Cliente';
  }

  private armarNombrePersona(obj: any): string {
    if (!obj) return '';
    if (obj.nombreCompleto) return String(obj.nombreCompleto).trim();
    if (obj.razonSocial) return String(obj.razonSocial).trim();
    if (obj.nombre) return String(obj.nombre).trim();
    const parts = [obj.primerNombre, obj.segundoNombre, obj.apellidoPaterno, obj.apellidoMaterno]
      .filter(Boolean)
      .map((x: any) => String(x).trim());
    return parts.join(' ').trim();
  }

  private nombreClienteDeFactura(f: any): string {
    const n =
      f.clienteNombre ||
      f.nombreCliente ||
      this.armarNombrePersona(f.cliente) ||
      this.armarNombrePersona(f);
    if (n) return n;
    return f.clienteId == null && f.cliente?.id == null ? 'Consumidor Final' : 'Cliente';
  }

  private nombreClienteDeCuenta(c: any): string {
    return (
      c.clienteNombre ||
      c.nombreCliente ||
      this.armarNombrePersona(c.cliente) ||
      this.armarNombrePersona(c) ||
      'Sin nombre'
    );
  }

  private clienteIdDe(f: any): any {
    return f.clienteId ?? f.cliente?.id ?? f.idCliente ?? null;
  }

  private procesarReporteClientes() {
    const ahora = new Date();
    const inicioPeriodo = this.inicioDia(this.restarDias(ahora, this.periodoDias - 1));

    const byId = new Map<string, ClienteReporte>();
    const byName = new Map<string, ClienteReporte>();
    const byDni = new Map<string, ClienteReporte>();

    const registrarIndices = (row: ClienteReporte, idKey: string | null, nameKey: string, dni: string | null) => {
      byName.set(nameKey, row);
      if (idKey) byId.set(idKey, row);
      if (dni) byDni.set(dni, row);
    };

    const ensure = (nombreRaw: string, clienteId: any = null, identificacion: any = null): ClienteReporte => {
      const display = this.nombreDisplay(nombreRaw);
      const nameKey = this.normalizarNombreCliente(nombreRaw || display || 'Cliente');
      const idKey = clienteId != null && clienteId !== '' ? String(clienteId) : null;
      const dni =
        (identificacion != null && String(identificacion).trim() !== ''
          ? String(identificacion).replace(/\D/g, '')
          : null) ||
        this.extraerIdentificacionDeTexto(nombreRaw);

      let row: ClienteReporte | undefined;

      if (idKey && byId.has(idKey)) {
        row = byId.get(idKey)!;
      } else if (dni && byDni.has(dni)) {
        row = byDni.get(dni)!;
      } else if (byName.has(nameKey)) {
        row = byName.get(nameKey)!;
      }

      if (!row) {
        row = {
          key: nameKey,
          clienteId: clienteId ?? null,
          identificacion: dni,
          nombre: display,
          totalFacturado: 0,
          numFacturas: 0,
          totalCredito: 0,
          saldoPendiente: 0,
          numCuentasCredito: 0,
          facturas: [],
          creditos: [],
        };
      } else {
        if (!row.identificacion && dni) row.identificacion = dni;
        const actualLimpio = this.nombreDisplay(row.nombre);
        if (display && (!actualLimpio || display.length <= actualLimpio.length || /\d{7,}/.test(row.nombre))) {
          if (!/\d{7,}/.test(display)) {
            row.nombre = display;
          }
        }
        if (clienteId != null && row.clienteId == null) row.clienteId = clienteId;
      }

      registrarIndices(row, idKey, nameKey, dni);
      return row;
    };

    this.facturasRaw.forEach((f) => {
      const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt || f.fechaCreacion);
      const nombre = this.nombreClienteDeFactura(f);
      const cid = this.clienteIdDe(f);
      const ident = f.clienteIdentificacion || f.cliente?.dni || f.dni || null;
      const row = ensure(nombre, cid, ident);
      const monto = this.obtenerTotalFactura(f);

      const num = f.numeroFactura || f.numero || String(f.id || '');
      if (row.facturas.some((x) => x.id === f.id || (num && x.numero === num))) return;

      const dets: DetalleFacturaResumen[] = (f.detalles || []).map((det: any) => ({
        productoNombre: det.productoNombre || det.nombre || 'Producto',
        cantidad: Number(det.cantidad || 0),
        precioUnitario: Number(det.precioUnitario || 0),
        descuento: Number(det.descuento || 0),
        subtotalItem: this.cleanNumber(det.subtotalItem || (Number(det.cantidad || 0) * Number(det.precioUnitario || 0)))
      }));

      row.facturas.push({
        id: f.id,
        numero: f.numeroFactura || f.numero || 'S/N',
        fecha: d ? d.toLocaleDateString('es-EC') : '—',
        tipo: String(f.formaPago || f.metodoPago || f.tipo || '—'),
        monto,
        estado: String(f.estadoSri || f.estado || 'Emitida'),
        subtotalIva0: Number(f.subtotalIva0 || 0),
        subtotalIvaAplicado: Number(f.subtotalIvaAplicado || 0),
        totalIva: Number(f.totalIva || 0),
        totalDescuento: Number(f.totalDescuento || 0),
        detalles: dets,
        showDetalles: false
      });
    });

    const recalcularFacturas = (row: ClienteReporte) => {
      row.facturas.sort((a, b) => {
        const da = this.parseFecha(a.fecha)?.getTime() || 0;
        const db = this.parseFecha(b.fecha)?.getTime() || 0;
        return db - da;
      });
      row.totalFacturado = row.facturas.reduce((s, x) => s + Number(x.monto || 0), 0);
      row.numFacturas = row.facturas.length;
    };

    this.cuentasRaw.forEach((c) => {
      const nombre = this.nombreClienteDeCuenta(c);
      const cid = c.clienteId ?? c.cliente?.id ?? null;
      const ident = c.clienteIdentificacion || c.clienteDni || c.dni || c.cliente?.dni || this.extraerIdentificacionDeTexto(nombre);
      const row = ensure(nombre, cid, ident);
      
      const saldo = this.cleanNumber(c.saldoPendiente ?? 0);
      const monto = this.cleanNumber(c.montoTotal ?? c.monto ?? 0);
      
      if (c.id != null && row.creditos.some((x) => x.id === c.id)) return;
      row.totalCredito += monto;
      row.saldoPendiente += saldo;
      if (saldo > 0) row.numCuentasCredito += 1;
      const fv = this.parseFecha(c.fechaVencimiento);

      const numFacturaCredito = c.numeroFactura || c.facturaNumero || c.referencia || c.numero;
      const facturaOriginal = row.facturas.find(f => f.numero === numFacturaCredito);
      
      let detallesClonados: DetalleFacturaResumen[] = [];
      let sb0 = 0, sbAplicado = 0, tIva = 0, tDesc = 0;

      if (facturaOriginal) {
          detallesClonados = facturaOriginal.detalles || [];
          sb0 = facturaOriginal.subtotalIva0;
          sbAplicado = facturaOriginal.subtotalIvaAplicado;
          tIva = facturaOriginal.totalIva;
          tDesc = facturaOriginal.totalDescuento;
      }

      row.creditos.push({
        id: c.id,
        factura: numFacturaCredito || '—',
        montoTotal: monto,
        saldoPendiente: saldo,
        fechaVencimiento: fv ? fv.toLocaleDateString('es-EC') : '—',
        estado: saldo <= 0 ? 'Pagada' : (c.estado || 'Pendiente'),
        detalles: detallesClonados,
        subtotalIva0: sb0,
        subtotalIvaAplicado: sbAplicado,
        totalIva: tIva,
        totalDescuento: tDesc,
        showDetalles: false
      });
    });

    const seen = new Set<ClienteReporte>();
    const lista: ClienteReporte[] = [];
    const pushUnique = (row: ClienteReporte) => {
      if (seen.has(row)) return;
      seen.add(row);
      recalcularFacturas(row);
      lista.push(row);
    };
    byId.forEach(pushUnique);
    byDni.forEach(pushUnique);
    byName.forEach(pushUnique);

    const merged = new Map<string, ClienteReporte>();
    for (const row of lista) {
      const nk = this.normalizarNombreCliente(row.nombre);
      if (merged.has(nk)) {
        const base = merged.get(nk)!;
        row.facturas.forEach((f) => {
          if (!base.facturas.some((x) => x.id === f.id || x.numero === f.numero)) base.facturas.push(f);
        });
        row.creditos.forEach((cr) => {
          if (!base.creditos.some((x) => x.id === cr.id)) {
            base.creditos.push(cr);
            base.totalCredito += cr.montoTotal;
            base.saldoPendiente += cr.saldoPendiente;
            if (cr.saldoPendiente > 0) base.numCuentasCredito += 1;
          }
        });
        if (row.clienteId != null && base.clienteId == null) base.clienteId = row.clienteId;
        if (row.identificacion && !base.identificacion) base.identificacion = row.identificacion;
        if (!/\d{7,}/.test(row.nombre) && /\d{7,}/.test(base.nombre)) base.nombre = this.nombreDisplay(row.nombre);
        recalcularFacturas(base);
      } else {
        merged.set(nk, row);
      }
    }

    const finalLista = [...merged.values()].filter((c) => {
      const n = this.normalizarNombreCliente(c.nombre);
      return n !== 'consumidor final' && n !== 'consumidorfinal';
    });

    this.reporteClientes = finalLista.sort((a, b) => {
      if (b.saldoPendiente !== a.saldoPendiente) return b.saldoPendiente - a.saldoPendiente;
      return b.totalFacturado - a.totalFacturado;
    });

    this.totalCreditoClientes = this.reporteClientes.reduce((s, c) => s + c.saldoPendiente, 0);
    this.clientesConDeuda = this.reporteClientes.filter((c) => c.saldoPendiente > 0).length;
    this.aplicarFiltroClientes();
  }

  aplicarFiltroClientes() {
    const term = this.busquedaClienteReporte.trim().toLowerCase();
    this.reporteClientesFiltrado = this.reporteClientes.filter((c) => {
      if (this.filtroSoloDeuda && !(c.saldoPendiente > 0)) return false;
      if (!term) return true;
      return c.nombre.toLowerCase().includes(term) || (c.identificacion && c.identificacion.toLowerCase().includes(term));
    });
  }

  abrirDetalleCliente(cli: ClienteReporte | { nombre: string; key?: string; total?: number; facturas?: number }) {
    const key = (cli as any).key || this.normalizarNombreCliente(cli.nombre);
    const found =
      this.reporteClientes.find((c) => c.key === key) ||
      this.reporteClientes.find((c) => this.normalizarNombreCliente(c.nombre) === key) ||
      null;

    const base: ClienteReporte = found
      ? { ...found, facturas: [...found.facturas], creditos: [...found.creditos] }
      : {
          key,
          clienteId: (cli as any).clienteId ?? null,
          identificacion: (cli as any).identificacion ?? null,
          nombre: cli.nombre,
          totalFacturado: (cli as any).total || 0,
          numFacturas: (cli as any).facturas || 0,
          totalCredito: 0,
          saldoPendiente: 0,
          numCuentasCredito: 0,
          facturas: [],
          creditos: [],
        };

    const cid = base.clienteId;
    const nKey = this.normalizarNombreCliente(base.nombre);
    const facturas: FacturaClienteResumen[] = [];
    
    this.facturasRaw.forEach((f) => {
      const fid = this.clienteIdDe(f);
      const fname = this.normalizarNombreCliente(this.nombreClienteDeFactura(f));
      const match =
        (cid != null && fid != null && String(cid) === String(fid)) ||
        fname === nKey;
      if (!match) return;
      const d = this.parseFecha(f.fechaEmision || f.fecha || f.createdAt);
      
      const dets: DetalleFacturaResumen[] = (f.detalles || []).map((det: any) => ({
        productoNombre: det.productoNombre || det.nombre || 'Producto',
        cantidad: Number(det.cantidad || 0),
        precioUnitario: Number(det.precioUnitario || 0),
        descuento: Number(det.descuento || 0),
        subtotalItem: this.cleanNumber(det.subtotalItem || (Number(det.cantidad || 0) * Number(det.precioUnitario || 0)))
      }));

      facturas.push({
        id: f.id,
        numero: f.numeroFactura || f.numero || 'S/N',
        fecha: d ? d.toLocaleDateString('es-EC') : '—',
        tipo: String(f.formaPago || f.metodoPago || '—'),
        monto: this.obtenerTotalFactura(f),
        estado: String(f.estadoSri || f.estado || 'Emitida'),
        subtotalIva0: Number(f.subtotalIva0 || 0),
        subtotalIvaAplicado: Number(f.subtotalIvaAplicado || 0),
        totalIva: Number(f.totalIva || 0),
        totalDescuento: Number(f.totalDescuento || 0),
        detalles: dets,
        showDetalles: false
      });
    });
    
    facturas.sort((a, b) => {
      const da = this.parseFecha(a.fecha)?.getTime() || 0;
      const db = this.parseFecha(b.fecha)?.getTime() || 0;
      return db - da;
    });
    base.facturas = facturas;
    base.numFacturas = facturas.length;
    base.totalFacturado = facturas.reduce((s, x) => s + x.monto, 0);

    this.clienteDetalle = base;
    this.modalTabCliente = (base.saldoPendiente || 0) > 0 && !(base.facturas?.length)
      ? 'credito'
      : 'facturas';
    this.showDetalleCliente = true;
    this.cdr.detectChanges();
  }

  cerrarDetalleCliente() {
    this.showDetalleCliente = false;
    this.clienteDetalle = null;
    this.modalTabCliente = 'facturas';
  }

  toggleDetallesFactura(f: FacturaClienteResumen) {
    f.showDetalles = !f.showDetalles;
    this.cdr.detectChanges();
  }

  colorCalor(intensidad: number): string {
    if (intensidad <= 0) return '#f1f5f9';
    if (intensidad < 0.25) return '#ffedd5';
    if (intensidad < 0.5) return '#fed7aa';
    if (intensidad < 0.75) return '#fb923c';
    return '#ea580c';
  }

  colorTextoCalor(intensidad: number): string {
    return intensidad >= 0.5 ? '#ffffff' : '#475569';
  }

  exportarPdfCliente() {
    if (!this.clienteDetalle) return;

    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 14;
      let y = 16;

      doc.setFillColor(23, 42, 70);
      doc.rect(0, 0, pageW, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Reporte Individual de Cliente', margin, 12);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(this.negocioNombre, margin, 20);
      doc.text(`Generado: ${new Date().toLocaleString('es-EC')}`, pageW - margin, 16, { align: 'right' });

      y = 38;
      doc.setTextColor(15, 23, 42);

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(this.clienteDetalle.nombre, margin, y);
      y += 6;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      if (this.clienteDetalle.identificacion) {
         doc.text(`CI/RUC: ${this.clienteDetalle.identificacion}`, margin, y);
         y += 6;
      }

      y += 2;

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Facturas Emitidas', 'Total Facturado', 'Saldo Pendiente']],
        body: [
          [
            String(this.clienteDetalle.numFacturas || 0),
            `$${this.fmtMoney(this.clienteDetalle.totalFacturado || 0)}`,
            `$${this.fmtMoney(this.clienteDetalle.saldoPendiente || 0)}`
          ]
        ],
        theme: 'grid',
        headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: 'bold', fontSize: 10, halign: 'center' },
        bodyStyles: { fontSize: 11, textColor: [15, 23, 42], halign: 'center', fontStyle: 'bold' }
      });

      y = (doc as any).lastAutoTable.finalY + 12;

      if (this.clienteDetalle.facturas && this.clienteDetalle.facturas.length > 0) {
        this.ensureSpace(doc, y, 30);
        y = (doc as any)._rendimientoY ?? y;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text('Historial de Facturas', margin, y);
        y += 4;

        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [['Comprobante', 'Fecha', 'Forma Pago', 'Estado', 'Total']],
          body: this.clienteDetalle.facturas.map(f => [
            `#${f.numero}`,
            f.fecha,
            f.tipo,
            f.estado,
            `$${this.fmtMoney(f.monto)}`
          ]),
          theme: 'striped',
          headStyles: { fillColor: [23, 42, 70], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 252] }
        });
        y = (doc as any).lastAutoTable.finalY + 12;
      }

      if (this.clienteDetalle.creditos && this.clienteDetalle.creditos.length > 0) {
        this.ensureSpace(doc, y, 30);
        y = (doc as any)._rendimientoY ?? y;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text('Cuentas de Crédito / Saldos Pendientes', margin, y);
        y += 4;

        autoTable(doc, {
          startY: y,
          margin: { left: margin, right: margin },
          head: [['Ref. Factura', 'Vencimiento', 'Estado', 'Monto Original', 'Deuda Actual']],
          body: this.clienteDetalle.creditos.map(c => [
            c.factura,
            c.fechaVencimiento,
            c.estado,
            `$${this.fmtMoney(c.montoTotal)}`,
            `$${this.fmtMoney(c.saldoPendiente)}`
          ]),
          theme: 'striped',
          headStyles: { fillColor: [234, 88, 12], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 252] }
        });
      }

      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Dilo · Página ${i} de ${totalPages}`,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 8,
          { align: 'center' }
        );
      }

      const nombreLimpio = this.clienteDetalle.nombre.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      doc.save(`Estado_Cuenta_${nombreLimpio}.pdf`);

    } catch (err) {
      console.error('Error al generar PDF de cliente:', err);
      alert('Hubo un error al generar el PDF del cliente.');
    }
  }
}