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
  topClientes: { nombre: string; total: number; facturas: number; porcentaje: number }[] = [];
  porFormaPago: { nombre: string; total: number; porcentaje: number }[] = [];

  serieDiaria: { label: string; total: number; altura: number }[] = [];

  private facturasRaw: any[] = [];

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
  }

  private getHeaders(): HttpHeaders {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    return new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);
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

    forkJoin([reqFacturas, reqNegocio]).subscribe(([facData, negData]) => {
      this.facturasRaw = Array.isArray(facData) ? facData : [];
      if (negData) {
        this.negocioNombre =
          negData.nombreComercial || negData.razonSocial || 'Mi Negocio';
      }
      this.procesarMetricas();
      this.isLoading = false;
      this.cdr.detectChanges();
    });
  }

  private procesarMetricas() {
    const ahora = new Date();
    const inicioPeriodo = this.inicioDia(this.restarDias(ahora, this.periodoDias - 1));
    const inicioAnterior = this.inicioDia(this.restarDias(inicioPeriodo, this.periodoDias));
    const finAnterior = this.inicioDia(this.restarDias(inicioPeriodo, 1));

    const facturasPeriodo = this.facturasRaw.filter((f) => {
      const d = this.parseFecha(f.fechaEmision);
      return d && d >= inicioPeriodo && d <= ahora;
    });

    const facturasAnterior = this.facturasRaw.filter((f) => {
      const d = this.parseFecha(f.fechaEmision);
      return d && d >= inicioAnterior && d <= finAnterior;
    });

    this.ventasPeriodo = facturasPeriodo.reduce(
      (acc, f) => acc + Number(f.totalFactura || f.total || 0),
      0
    );
    this.facturasPeriodo = facturasPeriodo.length;

    const mapaDia = new Map<string, { total: number; cantidad: number }>();
    for (let i = 0; i < this.periodoDias; i++) {
      const d = this.restarDias(ahora, this.periodoDias - 1 - i);
      mapaDia.set(this.keyFecha(d), { total: 0, cantidad: 0 });
    }

    facturasPeriodo.forEach((f) => {
      const d = this.parseFecha(f.fechaEmision);
      if (!d) return;
      const key = this.keyFecha(d);
      const entry = mapaDia.get(key) || { total: 0, cantidad: 0 };
      entry.total += Number(f.totalFactura || f.total || 0);
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
      const d = this.parseFecha(f.fechaEmision);
      if (d) acumDia[d.getDay()] += Number(f.totalFactura || f.total || 0);
    });
    const maxDiaSem = Math.max(...acumDia, 1);
    this.calorPorDiaSemana = diasSem.map((nombre, i) => ({
      nombre,
      total: acumDia[i],
      intensidad: acumDia[i] / maxDiaSem,
    }));

    const acumHora = new Array(24).fill(0);
    facturasPeriodo.forEach((f) => {
      const d = this.parseFecha(f.fechaEmision);
      if (d) acumHora[d.getHours()] += Number(f.totalFactura || f.total || 0);
    });
    const maxHora = Math.max(...acumHora, 1);
    this.calorPorHora = acumHora.map((total, h) => ({
      hora: `${h.toString().padStart(2, '0')}:00`,
      total,
      intensidad: total / maxHora,
    }));

    const ventasAnt = facturasAnterior.reduce(
      (acc, f) => acc + Number(f.totalFactura || f.total || 0),
      0
    );
    const facturasAnt = facturasAnterior.length;
    const diasAntSet = new Set(
      facturasAnterior
        .map((f) => this.parseFecha(f.fechaEmision))
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
        const nombre = d.productoNombre || 'Producto';
        const entry = mapProd.get(nombre) || { unidades: 0, ingresos: 0 };
        entry.unidades += Number(d.cantidad || 0);
        entry.ingresos += Number(
          d.subtotalItem || (d.cantidad || 0) * (d.precioUnitario || 0)
        );
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
      const nombre = f.clienteNombre || f.cliente?.nombre || 'Consumidor Final';
      const entry = mapCli.get(nombre) || { total: 0, facturas: 0 };
      entry.total += Number(f.totalFactura || f.total || 0);
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
      porcentaje: Math.round((c.total / maxCli) * 100),
    }));

    const mapPago = new Map<string, number>();
    facturasPeriodo.forEach((f) => {
      const fp = (f.formaPago || 'Otro').toString();
      mapPago.set(fp, (mapPago.get(fp) || 0) + Number(f.totalFactura || f.total || 0));
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
          const d = this.parseFecha(f.fechaEmision);
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

  private parseFecha(val: any): Date | null {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
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
}
