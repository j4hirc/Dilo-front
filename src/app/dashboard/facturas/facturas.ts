import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-facturas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './facturas.html',
  styleUrls: ['./facturas.css'],
})
export class Facturas implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  
  facturas: any[] = [];
  isLoading = true;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    const negocioId = usuarioLogueado?.negocioId;
    
    if (negocioId) {
      this.cargarTodasLasFacturas(negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarTodasLasFacturas(id: number) {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/facturas`, { headers }).subscribe({
      next: (data) => {
        try {
          const arregloSeguro = Array.isArray(data) ? data : [];
          this.facturas = arregloSeguro.map(f => ({
            numero: f.numeroFactura || 'S/N',
            cliente: f.clienteNombre || f.cliente?.nombre || f.cliente?.razonSocial || 'Consumidor Final',
            tipo: f.formaPago || 'Manual',
            fecha: f.fechaEmision || new Date().toLocaleDateString(),
            monto: Number(f.totalFactura || f.total || 0),
            estado: f.estadoSri || 'Emitida',
            // 🔥 AQUÍ CAPTURAMOS LOS PRODUCTOS COMPRADOS:
            // Buscamos cómo se llama la lista en tu JSON de Java (detalles, items, etc)
            detalles: f.detallesFactura || f.detalles || f.items || [] 
          }));
        } catch (error) {
          console.error("Error al mapear:", error);
        }

        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        this.cdr.detectChanges();
        if (err.status === 401) {
            Swal.fire({
                icon: 'warning',
                title: 'Sesión expirada',
                text: 'Tu token caducó. Cierra sesión y vuelve a entrar.',
                confirmButtonColor: '#ed8936'
            });
        }
      }
    });
  }

  // Animación de carga y llamado al generador
  descargarPDF(fac: any) {
    Swal.fire({
      title: 'Generando Factura...',
      text: 'Preparando el diseño del documento.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    setTimeout(() => {
      Swal.close();
      this.imprimirFacturaPDF(fac);
    }, 800);
  }

  // Generador del Diseño Exacto al de tu imagen
  imprimirFacturaPDF(fac: any) {
    const total = fac.monto;
    const subtotal = total / 1.15; // Asumiendo IVA del 15%
    const iva = total - subtotal;

    // 🔥 GENERADOR DINÁMICO DE FILAS PARA LOS PRODUCTOS
    let filasProductos = '';
    
    if (fac.detalles && fac.detalles.length > 0) {
      // Si la factura tiene productos, los recorremos y armamos el HTML
      fac.detalles.forEach((item: any) => {
        const cantidad = item.cantidad || 1;
        // Buscamos el nombre del producto (depende de cómo venga de Java)
        const descripcion = item.producto?.nombre || item.productoNombre || item.descripcion || 'Producto / Servicio';
        const precioUnit = Number(item.precioUnitario || item.precio || 0);
        const subtotalItem = Number(item.subtotal || (cantidad * precioUnit));
        
        filasProductos += `
          <tr>
              <td>${cantidad}</td>
              <td>${descripcion}</td>
              <td class="text-right">${precioUnit.toFixed(2).replace('.', ',')}</td>
              <td class="text-right">${subtotalItem.toFixed(2).replace('.', ',')}</td>
          </tr>
        `;
      });
    } else {
      // Si por alguna razón la factura no trae los detalles en este endpoint, evitamos que se vea vacía
      filasProductos = `
          <tr>
              <td>1</td>
              <td>Consumo general (Resumen de Factura)</td>
              <td class="text-right">${subtotal.toFixed(2).replace('.', ',')}</td>
              <td class="text-right">${subtotal.toFixed(2).replace('.', ',')}</td>
          </tr>
      `;
    }
    
    // Abrimos ventana oculta para renderizar el PDF
    const ventana = window.open('', '', 'width=900,height=700');
    
    ventana?.document.write(`
      <html>
      <head>
          <title>Factura_${fac.numero}</title>
          <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; padding: 40px; margin: 0; }
              .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
              .logo { color: #172a46; font-size: 36px; font-weight: 900; font-style: italic; margin-bottom: 15px; letter-spacing: -1px; }
              .logo span { color: #ed8936; }
              .company-info h1 { margin: 0; font-size: 20px; font-weight: 600; color: #0f172a; margin-bottom: 5px; }
              .company-info p { margin: 5px 0; color: #1e293b; font-size: 14px; }
              
              .invoice-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 20px; width: 380px; }
              .invoice-box h2 { margin: 0 0 15px 0; font-size: 22px; display: flex; justify-content: space-between; font-weight: 500;}
              .invoice-box h2 span { color: #e11d48; font-weight: 600; }
              .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #0f172a;}
              .clave-acceso { font-size: 11px; margin-top: 5px; word-break: break-all; letter-spacing: 1px; color: #475569;}
              
              .client-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px 20px; margin-bottom: 30px; display: flex; justify-content: space-between; font-size: 14px; color: #0f172a;}
              
              table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
              th { background-color: #2c3e50; color: white; padding: 12px 15px; text-align: left; font-size: 13px; font-weight: 500;}
              td { border-bottom: 1px solid #e2e8f0; padding: 12px 15px; font-size: 14px; color: #0f172a;}
              .text-right { text-align: right; }
              
              .totals-container { display: flex; justify-content: space-between; align-items: flex-end; }
              .footer-text { font-size: 12px; color: #94a3b8; }
              .totals-box { width: 280px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px 20px; }
              .totals-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; color: #0f172a;}
              .grand-total { font-weight: 700; font-size: 18px; border-top: 1px solid #0f172a; padding-top: 12px; margin-bottom: 0;}
              
              @media print {
                  @page { margin: 1cm; }
                  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
          </style>
      </head>
      <body>
          <div class="header">
              <div class="company-info">
                  <div class="logo">Dilo<span>.</span></div>
                  <h1>Mi Negocio S.A.</h1>
                  <p>RUC: 0102030405001</p>
                  <p>Dirección Matriz: Cuenca, Azuay, Ecuador</p>
              </div>
              <div class="invoice-box">
                  <h2>FACTURA <span>No. ${fac.numero}</span></h2>
                  <div class="info-row"><span>Fecha Emisión:</span> <span>${fac.fecha}</span></div>
                  <div class="info-row" style="flex-direction: column; margin-top: 15px;">
                      <span>Clave de Acceso:</span>
                      <div class="clave-acceso">17072026010102030405001100100100000000201234567812</div>
                  </div>
              </div>
          </div>

          <div class="client-box">
              <div><span style="color: #475569; margin-right: 15px;">Razón Social:</span> ${fac.cliente}</div>
              <div><span style="color: #475569; margin-right: 15px;">RUC/DNI:</span> 9999999999</div>
          </div>

          <table>
              <thead>
                  <tr>
                      <th>Cantidad</th>
                      <th>Descripción del Producto</th>
                      <th class="text-right">Precio Unit.</th>
                      <th class="text-right">Total</th>
                  </tr>
              </thead>
              <tbody>
                  <!-- 🔥 INYECTAMOS LAS FILAS GENERADAS -->
                  ${filasProductos}
              </tbody>
          </table>

          <div class="totals-container">
              <div class="footer-text">
                  Documento generado por Dilo - Facturación Inteligente
              </div>
              <div class="totals-box">
                  <div class="totals-row"><span>SUBTOTAL:</span> <span>$ ${subtotal.toFixed(2).replace('.', ',')}</span></div>
                  <div class="totals-row"><span>IVA 15%:</span> <span>$ ${iva.toFixed(2).replace('.', ',')}</span></div>
                  <div class="totals-row grand-total"><span>TOTAL:</span> <span>$ ${total.toFixed(2).replace('.', ',')}</span></div>
              </div>
          </div>
      </body>
      </html>
    `);
    
    ventana?.document.close();
    ventana?.focus();
    
    setTimeout(() => {
      ventana?.print();
      ventana?.close();
    }, 500);
  }
}