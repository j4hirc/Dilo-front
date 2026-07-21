import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, of } from 'rxjs'; 
import { catchError } from 'rxjs/operators'; 
import Swal from 'sweetalert2';

@Component({
  selector: 'app-equipo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './equipo.html',
  styleUrls: ['./equipo.css'],
})
export class Equipo implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  miembrosActivos: any[] = [];
  solicitudes: any[] = [];
  isLoading = true;
  negocioId: number | null = null;
  codigoInvitacion: string = 'Cargando...'; 

  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit(): void {
    // 🔥 BÚSQUEDA A PRUEBA DE BALAS EN LOCALSTORAGE (Igual que en configuración)
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    
    console.log("👀 Datos en localStorage (Equipo):", usuarioLogueado);

    // 🔥 Buscamos el ID en cualquier llave posible
    this.negocioId = usuarioLogueado?.negocioId || 
                     usuarioLogueado?.selectedBusinessId || 
                     usuarioLogueado?.idNegocio;

    if (this.negocioId) {
      this.cargarEquipo(this.negocioId);
    } else {
      console.error("🚨 CRÍTICO: No hay negocioId en el localStorage.");
      this.codigoInvitacion = 'ERROR: Sin Negocio';
      this.isLoading = false;
      this.cdr.detectChanges();
      
      // 🔥 ALERTA VISUAL PARA LIMPIAR LA SESIÓN ROTA
      Swal.fire({
        icon: 'warning',
        title: 'Sesión desactualizada',
        text: 'No podemos encontrar el ID de tu negocio. Por favor, cierra sesión y vuelve a ingresar para sincronizar tus datos.',
        confirmButtonColor: '#ed8936',
        confirmButtonText: 'Entendido'
      });
    }
  }

  cargarEquipo(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    const reqMiembros = this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).pipe(catchError(() => of([])));
    const reqNegocio = this.http.get<any>(`${this.apiUrl}/negocios/${id}`, { headers }).pipe(catchError(() => of(null)));

    forkJoin([reqMiembros, reqNegocio]).subscribe({
      next: ([miemData, negData]) => {
        console.log("🔥 Datos del negocio recibidos en equipo:", negData);

        const equipoCompleto = Array.isArray(miemData) ? miemData : [];
        this.solicitudes = equipoCompleto.filter(m => m.estadoInvitacion === 'PENDIENTE');
        this.miembrosActivos = equipoCompleto.filter(m => m.estadoInvitacion !== 'PENDIENTE');

        // 🔥 ATRAPAMOS EL CÓDIGO VENGA COMO VENGA
        if (negData) {
          this.codigoInvitacion = negData.codigoInvitacion || negData.codigo || 'NO-DISPONIBLE';
        } else {
          this.codigoInvitacion = 'NO-DISPONIBLE';
        }

        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar equipo:', err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  copiarCodigo() {
    if (this.codigoInvitacion && this.codigoInvitacion !== 'Cargando...' && !this.codigoInvitacion.includes('ERROR') && this.codigoInvitacion !== 'NO-DISPONIBLE') {
      navigator.clipboard.writeText(this.codigoInvitacion).then(() => {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: '¡Código copiado al portapapeles!',
          showConfirmButton: false,
          timer: 2000
        });
      });
    } else {
      Swal.fire('Error', 'No hay un código válido para copiar.', 'error');
    }
  }

  responderSolicitud(miembroId: number, aceptar: boolean) {
    if (!this.negocioId) return;

    const accion = aceptar ? 'aceptar' : 'rechazar';
    const colorBtn = aceptar ? '#22c55e' : '#ef4444';

    Swal.fire({
      title: `¿${aceptar ? 'Aceptar' : 'Rechazar'} solicitud?`,
      text: aceptar ? "El usuario tendrá acceso al sistema." : "La solicitud será eliminada.",
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: colorBtn,
      cancelButtonColor: '#64748b',
      confirmButtonText: `Sí, ${accion}`
    }).then((result) => {
      if (result.isConfirmed) {
        const rawToken = localStorage.getItem('dilo_token') || '';
        const cleanToken = rawToken.replace(/['"]+/g, '');
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/miembros/${miembroId}/responder?aceptar=${aceptar}`, null, { headers })
          .subscribe({
            next: () => {
              Swal.fire('¡Listo!', `La solicitud fue ${aceptar ? 'aceptada' : 'rechazada'}.`, 'success');
              this.cargarEquipo(this.negocioId!);
            },
            error: (err) => {
              console.error(err);
              Swal.fire('Oops...', 'Error al procesar la solicitud.', 'error');
            }
          });
      }
    });
  }

  desactivarMiembro(miembroId: number) {
    if (!this.negocioId) return;

    Swal.fire({
      title: '¿Desactivar miembro?',
      text: "El usuario perderá acceso al sistema del negocio.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, desactivar'
    }).then((result) => {
      if (result.isConfirmed) {
        const rawToken = localStorage.getItem('dilo_token') || '';
        const cleanToken = rawToken.replace(/['"]+/g, '');
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/miembros/${miembroId}/desactivar`, {}, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Desactivado!', 'El miembro ha sido desactivado.', 'success');
            this.cargarEquipo(this.negocioId!);
          },
          error: (err) => {
            console.error(err);
            Swal.fire('Oops...', 'Error al desactivar al miembro.', 'error');
          }
        });
      }
    });
  }

  cambiarRol(miembro: any) {
    if (!this.negocioId) return;

    const opcionesRoles = {
      'ADMIN': 'Administrador (Control total)',
      'VENDEDOR': 'Vendedor (Solo facturación)',
      'BODEGUERO': 'Bodeguero (Solo inventario)'
    };

    Swal.fire({
      title: 'Modificar Rol',
      text: `Selecciona el nuevo rol para ${miembro.nombreUsuario}:`,
      input: 'select',
      inputOptions: opcionesRoles,
      inputValue: miembro.rol,
      showCancelButton: true,
      confirmButtonColor: '#ed8936',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Guardar cambios',
      cancelButtonText: 'Cancelar',
      inputValidator: (value) => {
        return new Promise((resolve) => {
          if (value === miembro.rol) {
            resolve('El usuario ya tiene este rol asignado.');
          } else {
            resolve(null);
          }
        });
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const nuevoRol = result.value;
        const rawToken = localStorage.getItem('dilo_token') || '';
        const cleanToken = rawToken.replace(/['"]+/g, '');
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/miembros/${miembro.id}/rol?rol=${nuevoRol}`, null, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Actualizado!', 'El rol del colaborador ha sido modificado.', 'success');
            this.cargarEquipo(this.negocioId!);
          },
          error: (err) => {
            console.error(err);
            Swal.fire('Oops...', 'Hubo un error al cambiar el rol.', 'error');
          }
        });
      }
    });
  }
}