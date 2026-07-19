import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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
  solicitudes: any[] = []; // 🔥 Nueva lista solo para los pendientes
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;

    if (this.negocioId) {
      this.cargarEquipo(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarEquipo(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, '');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/miembros`, { headers }).subscribe({
      next: (data) => {
        const equipoCompleto = Array.isArray(data) ? data : [];

        // 🔥 MAGIA: Filtramos quién ya está adentro y quién está tocando la puerta
        this.solicitudes = equipoCompleto.filter(m => m.estadoInvitacion === 'PENDIENTE');
        this.miembrosActivos = equipoCompleto.filter(m => m.estadoInvitacion !== 'PENDIENTE');

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

  // 🔥 Botón para copiar el ID del negocio y pasarlo por WhatsApp
  copiarCodigo() {
    if (this.negocioId) {
      navigator.clipboard.writeText(this.negocioId.toString()).then(() => {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: '¡Código copiado al portapapeles!',
          showConfirmButton: false,
          timer: 2000
        });
      });
    }
  }

  // 🔥 NUEVO: Función para Aceptar o Rechazar a los que quieren entrar
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

        // Llamamos a tu endpoint en Java enviando el boolean
        // 🔥 Cambiamos el {} por null
        this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/miembros/${miembroId}/responder?aceptar=${aceptar}`, null, { headers })
          .subscribe({
            next: () => {
              Swal.fire('¡Listo!', `La solicitud fue ${aceptar ? 'aceptada' : 'rechazada'}.`, 'success');
              this.cargarEquipo(this.negocioId!); // Recargamos para que pase a la lista de activos
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

    // Diccionario de roles (Ajusta estos nombres exactos a como los guardes en tu BD de Java)
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
      inputValue: miembro.rol, // Para que aparezca pre-seleccionado el rol actual
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
            resolve(null); // Permite continuar
          }
        });
      }
    }).then((result) => {
      if (result.isConfirmed) {
        const nuevoRol = result.value;
        const rawToken = localStorage.getItem('dilo_token') || '';
        const cleanToken = rawToken.replace(/['"]+/g, '');
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        // 🔥 Llamada al endpoint de Java para actualizar el rol (Asumimos que usas Query Param ?rol=NUEVO_ROL)
        this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/miembros/${miembro.id}/rol?rol=${nuevoRol}`, null, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Actualizado!', 'El rol del colaborador ha sido modificado.', 'success');
            this.cargarEquipo(this.negocioId!); // Recargamos la lista
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