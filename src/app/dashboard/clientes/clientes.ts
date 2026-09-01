import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { environment } from "../../../environments/environment";

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './clientes.html',
  styleUrls: ['./clientes.css'],
})
export class Clientes implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  
  clientes: any[] = [];
  clientesFiltrados: any[] = []; 
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = environment.apiUrl;

  searchTerm: string = '';

  showModal = false;
  isEditing = false;
  currentClienteId: number | null = null;
  
  clienteForm = {
    dni: '',
    primerNombre: '',
    segundoNombre: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    email: '',
    fechaNacimiento: '',
    telefono: '',
    direccion: ''
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;
    
    if (this.negocioId) {
      this.cargarClientes(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarClientes(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/clientes`, { headers }).subscribe({
      next: (data) => {
        this.clientes = Array.isArray(data) ? data : [];
        this.filtrarClientes(); 
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error("Error al cargar clientes:", err);
        this.isLoading = false;
        this.cdr.detectChanges();
        this.manejarError(err);
      }
    });
  }

  filtrarClientes() {
    if (this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase().trim();
      this.clientesFiltrados = this.clientes.filter(c => 
        (c.nombreCompleto && c.nombreCompleto.toLowerCase().includes(term)) || 
        (c.dni && c.dni.toLowerCase().includes(term)) ||
        (c.email && c.email.toLowerCase().includes(term))
      );
    } else {
      this.clientesFiltrados = this.clientes;
    }
    this.cdr.detectChanges(); 
  }

  abrirModalNuevo() {
    this.isEditing = false;
    this.currentClienteId = null;
    this.clienteForm = { 
        dni: '', primerNombre: '', segundoNombre: '', 
        apellidoPaterno: '', apellidoMaterno: '', 
        email: '', fechaNacimiento: '', telefono: '', direccion: '' 
    };
    this.showModal = true;
  }

  abrirModalEditar(cli: any) {
    this.isEditing = true;
    this.currentClienteId = cli.id;
    this.clienteForm = {
      dni: cli.dni,
      primerNombre: cli.primerNombre,
      segundoNombre: cli.segundoNombre || '',
      apellidoPaterno: cli.apellidoPaterno,
      apellidoMaterno: cli.apellidoMaterno || '',
      email: cli.email || '',
      fechaNacimiento: cli.fechaNacimiento || '',
      telefono: cli.telefono || '',
      direccion: cli.direccion || ''
    };
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges(); 
  }

  // ==========================================
  // LÓGICA DE VALIDACIONES
  // ==========================================

  private validarCedulaEcuatoriana(identificacion: string): boolean {
    if (!identificacion) return false;
    
    // Debe tener 10 (Cédula) o 13 dígitos (RUC) y ser solo números
    if (!/^\d{10}$|^\d{13}$/.test(identificacion)) return false;

    const provincia = parseInt(identificacion.substring(0, 2), 10);
    const tercerDigito = parseInt(identificacion.substring(2, 3), 10);

    // Provincias válidas (01 a 24) y código 30 (Exterior)
    if (provincia < 1 || (provincia > 24 && provincia !== 30)) return false;

    // Validación para personas naturales (Tercer dígito menor a 6)
    if (tercerDigito < 6) {
      const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
      const digitoVerificador = parseInt(identificacion.substring(9, 10), 10);
      let suma = 0;

      for (let i = 0; i < 9; i++) {
        let valor = parseInt(identificacion.charAt(i), 10) * coeficientes[i];
        if (valor > 9) valor -= 9;
        suma += valor;
      }

      const decenaSuperior = Math.ceil(suma / 10) * 10;
      let digitoCalculado = decenaSuperior - suma;
      if (digitoCalculado === 10) digitoCalculado = 0;

      if (digitoCalculado !== digitoVerificador) return false;

      // Si es RUC de persona natural (13 dígitos), debe terminar en "001"
      if (identificacion.length === 13 && !identificacion.endsWith('001')) return false;

      return true;
    }
    
    // Si es RUC de empresa privada (Tercer dígito 9) o empresa pública (Tercer dígito 6)
    // omitimos el cálculo complejo por ahora, pero validamos que termine en 001 y tenga 13 dígitos.
    if (identificacion.length === 13 && (tercerDigito === 9 || tercerDigito === 6)) {
        return identificacion.endsWith('001');
    }

    return false;
  }

  private calcularEdad(fechaNacimiento: string): number {
    if (!fechaNacimiento) return 0;
    const hoy = new Date();
    const nacimiento = new Date(fechaNacimiento);
    let edad = hoy.getFullYear() - nacimiento.getFullYear();
    const mes = hoy.getMonth() - nacimiento.getMonth();
    
    if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) {
      edad--;
    }
    return edad;
  }

  // ==========================================
  // EJECUCIÓN DE GUARDADO
  // ==========================================
  
  guardarCliente() {
    if (!this.negocioId) return;

    // 1. Validar campos obligatorios
    if (!this.clienteForm.dni || !this.clienteForm.primerNombre || !this.clienteForm.apellidoPaterno) {
      Swal.fire('Campos Incompletos', 'El DNI, Primer Nombre y Apellido Paterno son obligatorios.', 'warning');
      return;
    }

    // 2. Validar Cédula / RUC (Módulo 10)
    if (!this.validarCedulaEcuatoriana(this.clienteForm.dni)) {
      Swal.fire('Documento Inválido', 'El DNI o RUC ingresado no cumple con el formato válido.', 'warning');
      return;
    }

    // 3. Validar Duplicados en el Frontend
    const dniDuplicado = this.clientes.some(c => c.dni === this.clienteForm.dni && c.id !== this.currentClienteId);
    if (dniDuplicado) {
      Swal.fire('DNI Duplicado', 'Ya existe un cliente registrado con este documento en tu negocio.', 'warning');
      return;
    }

    // 4. Validar Correo Electrónico (Regex)
    if (this.clienteForm.email) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
      if (!emailRegex.test(this.clienteForm.email)) {
        Swal.fire('Correo Inválido', 'Por favor, ingresa un formato de correo electrónico correcto.', 'warning');
        return;
      }
    }

    // 5. Validar Edad (Mayor de 13 años)
    if (this.clienteForm.fechaNacimiento) {
      const edad = this.calcularEdad(this.clienteForm.fechaNacimiento);
      if (edad < 13) {
        Swal.fire('Edad Mínima', 'El cliente debe tener al menos 13 años de edad para ser registrado.', 'warning');
        return;
      }
    }

    // Preparar petición
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    const requestDTO = {
      dni: this.clienteForm.dni,
      primerNombre: this.clienteForm.primerNombre,
      segundoNombre: this.clienteForm.segundoNombre,
      apellidoPaterno: this.clienteForm.apellidoPaterno,
      apellidoMaterno: this.clienteForm.apellidoMaterno,
      email: this.clienteForm.email,
      fechaNacimiento: this.clienteForm.fechaNacimiento ? this.clienteForm.fechaNacimiento : null,
      telefono: this.clienteForm.telefono,
      direccion: this.clienteForm.direccion
    };

    Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    if (this.isEditing && this.currentClienteId) {
      this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/clientes/${this.currentClienteId}`, requestDTO, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Cliente actualizado!'),
          error: (err) => this.manejarError(err)
        });
    } else {
      this.http.post(`${this.apiUrl}/negocios/${this.negocioId}/clientes`, requestDTO, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Cliente creado exitosamente!'),
          error: (err) => this.manejarError(err)
        });
    }
  }

  postGuardadoExitoso(mensaje: string) {
    this.cerrarModal(); 
    Swal.fire('Éxito', mensaje, 'success');
    if (this.negocioId) this.cargarClientes(this.negocioId);
  }

  eliminarCliente(id: number) {
    if (!this.negocioId) return;

    Swal.fire({
      title: '¿Estás seguro?',
      text: "Eliminarás este cliente de tu base de datos.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar'
    }).then((result) => {
      if (result.isConfirmed) {
        const rawToken = localStorage.getItem('dilo_token') || '';
        const cleanToken = rawToken.replace(/['"]+/g, ''); 
        const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

        this.http.delete(`${this.apiUrl}/negocios/${this.negocioId}/clientes/${id}`, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Eliminado!', 'El cliente ha sido borrado.', 'success');
            this.cargarClientes(this.negocioId!);
          },
          error: (err) => this.manejarError(err)
        });
      }
    });
  }

  manejarError(err: any) {
    Swal.close();
    console.error('Error HTTP:', err);
    if (err.status === 401) {
      Swal.fire({ icon: 'warning', title: 'Sesión expirada', text: 'Cierra sesión y vuelve a entrar.', confirmButtonColor: '#ed8936' });
    } else {
      Swal.fire('Error en el Servidor', 'Verifica los datos e inténtalo nuevamente.', 'error');
    }
  }
}