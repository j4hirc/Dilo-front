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
    const userStr = localStorage.getItem('usuario') || localStorage.getItem('dilo_user');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    
    this.negocioId = usuarioLogueado?.negocioId || 
                     usuarioLogueado?.selectedBusinessId || 
                     usuarioLogueado?.idNegocio;

    if (this.negocioId) {
      this.cargarEquipo(this.negocioId);
    } else {
      this.codigoInvitacion = 'ERROR: Sin Negocio';
      this.isLoading = false;
      this.cdr.detectChanges();
      
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
        const equipoCompleto = Array.isArray(miemData) ? miemData : [];
        
        // Separa las solicitudes pendientes
        this.solicitudes = equipoCompleto.filter(m => m.estadoInvitacion === 'PENDIENTE');
        
        // 🔥 AHORA TODOS LOS DEMÁS SON ACTIVOS (porque los inactivos/rechazados se borran)
        this.miembrosActivos = equipoCompleto.filter(m => m.estadoInvitacion !== 'PENDIENTE');

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
    if (this.codigoInvitacion && !this.codigoInvitacion.includes('ERROR') && this.codigoInvitacion !== 'NO-DISPONIBLE') {
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

  // 🔥 ESTE BOTÓN AHORA ELIMINA AL USUARIO DE LA BASE DE DATOS
  desactivarMiembro(miembroId: number) {
    if (!this.negocioId) return;

    Swal.fire({
      title: '¿Expulsar miembro?',
      text: "El usuario perderá acceso al sistema y será eliminado del negocio permanentemente.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, expulsar'
    }).then((result) => {
      if (result.isConfirmed) {
        const rawToken = localStorage.getItem('dilo_token') || '';
        const cleanToken = rawToken.replace(/['"]+/g, '');
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/miembros/${miembroId}/desactivar`, null, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Expulsado!', 'El miembro ha sido eliminado del negocio.', 'success');
            this.cargarEquipo(this.negocioId!);
          },
          error: (err) => {
            console.error(err);
            Swal.fire('Oops...', 'Error al expulsar al miembro.', 'error');
          }
        });
      }
    });
  }

  cambiarRol(miembro: any) {
    if (!this.negocioId) return;
    
    // 🔥 Ya no necesitamos validar si está inactivo porque todos los de la lista están activos
    const opcionesRoles = {
      'PROPIETARIO': 'Propietario / Administrador (Control total)',
      'VENDEDOR': 'Vendedor (Solo facturación)',
      'BODEGUERO': 'Bodeguero (Solo inventario)'
    };

    Swal.fire({
      title: 'Modificar Rol',
      text: `Selecciona el nuevo rol para ${miembro.nombreUsuario || 'este usuario'}:`,
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