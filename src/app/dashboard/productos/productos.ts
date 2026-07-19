import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './productos.html',
  styleUrls: ['./productos.css'],
})
export class Productos implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  
  productos: any[] = [];
  productosFiltrados: any[] = []; 
  categorias: any[] = []; 
  isLoading = true;
  negocioId: number | null = null;
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1';

  searchTerm: string = '';
  categoriaFiltro: string | number = '';

  showModal = false;
  isEditing = false;
  currentProductId: number | null = null;
  selectedFile: File | null = null;
  imagenActual: string | null = null; 
  
  productoForm = {
    nombre: '',
    codigoPrincipal: '',
    marca: '',
    precioUnitario: 0,
    categoriaId: 0,
    grabaIva: false
  };

  ngOnInit(): void {
    const userStr = localStorage.getItem('usuario');
    const usuarioLogueado = userStr ? JSON.parse(userStr) : null;
    this.negocioId = usuarioLogueado?.negocioId;
    
    if (this.negocioId) {
      this.cargarCategorias(this.negocioId);
      this.cargarTodosLosProductos(this.negocioId);
    } else {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  cargarCategorias(id: number) {
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/categorias`, { headers }).subscribe({
      next: (data) => {
        this.categorias = Array.isArray(data) ? data : [];
      },
      error: (err) => console.error("Error al cargar categorías", err)
    });
  }

  cargarTodosLosProductos(id: number) {
    this.isLoading = true;
    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    this.http.get<any[]>(`${this.apiUrl}/negocios/${id}/productos`, { headers }).subscribe({
      next: (data) => {
        try {
          const arregloSeguro = Array.isArray(data) ? data : [];
          this.productos = arregloSeguro.map(p => ({
            id: p.id, 
            codigoPrincipal: p.codigoPrincipal || 'S/C',
            nombre: p.nombre || 'Producto sin nombre',
            marca: p.marca || 'Sin marca',
            precioUnitario: Number(p.precioUnitario || 0),
            categoriaId: p.categoriaId,
            categoriaNombre: p.categoriaNombre || 'General',
            grabaIva: p.grabaIva || false,
            imagen: p.imagen || null
          }));
          
          this.filtrarProductos(); 
        } catch (error) {
          console.error("❌ Error interno al mapear:", error);
        }
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  filtrarProductos() {
    let filtrados = this.productos;
    if (this.categoriaFiltro !== '') {
      filtrados = filtrados.filter(p => p.categoriaId === Number(this.categoriaFiltro));
    }
    if (this.searchTerm.trim() !== '') {
      const term = this.searchTerm.toLowerCase().trim();
      filtrados = filtrados.filter(p => 
        p.nombre.toLowerCase().includes(term) || 
        p.codigoPrincipal.toLowerCase().includes(term) ||
        p.marca.toLowerCase().includes(term)
      );
    }
    this.productosFiltrados = filtrados;
    this.cdr.detectChanges(); 
  }

  abrirModalNuevo() {
    this.isEditing = false;
    this.currentProductId = null;
    this.selectedFile = null;
    this.imagenActual = null; 
    this.productoForm = { 
        nombre: '', codigoPrincipal: '', marca: '', precioUnitario: 0, 
        categoriaId: this.categorias.length > 0 ? this.categorias[0].id : 0, 
        grabaIva: false 
    };
    this.showModal = true;
  }

  abrirModalEditar(prod: any) {
    this.isEditing = true;
    this.currentProductId = prod.id;
    this.selectedFile = null;
    
    // 🔥 FIX IMAGEN: Nos aseguramos de que si existe, se pueda ver en el preview
    this.imagenActual = prod.imagen; 
    
    this.productoForm = {
      nombre: prod.nombre,
      codigoPrincipal: prod.codigoPrincipal === 'S/C' ? '' : prod.codigoPrincipal,
      marca: prod.marca === 'Sin marca' ? '' : prod.marca,
      precioUnitario: prod.precioUnitario,
      categoriaId: prod.categoriaId,
      grabaIva: prod.grabaIva
    };
    this.showModal = true;
  }

  cerrarModal() {
    this.showModal = false;
    this.cdr.detectChanges(); 
  }

  onFileSelected(event: any) {
    if (event.target.files.length > 0) {
      this.selectedFile = event.target.files[0];
      
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.imagenActual = e.target.result;
        this.cdr.detectChanges();
      };
      reader.readAsDataURL(this.selectedFile!); 
    }
  }
  
  guardarProducto() {
    if (!this.negocioId) return;

    const precioNumerico = Number(this.productoForm.precioUnitario);
    const categoriaNumerica = Number(this.productoForm.categoriaId);

    if (!this.productoForm.nombre || precioNumerico < 0 || categoriaNumerica === 0) {
      Swal.fire('Error', 'El nombre y la categoría son obligatorios.', 'error');
      return;
    }

    const rawToken = localStorage.getItem('dilo_token') || '';
    const cleanToken = rawToken.replace(/['"]+/g, ''); 
    const headers = new HttpHeaders().set('Authorization', `Bearer ${cleanToken}`);

    const formData = new FormData();
    const requestDTO = {
      nombre: this.productoForm.nombre,
      codigo: this.productoForm.codigoPrincipal,
      codigoPrincipal: this.productoForm.codigoPrincipal,
      marca: this.productoForm.marca,
      precio: precioNumerico,
      precioUnitario: precioNumerico,
      categoriaId: categoriaNumerica,
      grabaIva: this.productoForm.grabaIva
    };

    console.log("📤 Enviando datos a Java:", requestDTO);

    // Se empaqueta en JSON puro tal como lo pide @RequestPart
    formData.append('datos', new Blob([JSON.stringify(requestDTO)], { type: 'application/json' }));
    
    // 🔥 FIX: Si no hay foto, NO mandamos el campo para evitar que Java muera
    if (this.selectedFile) {
      formData.append('imagen', this.selectedFile);
    }

    Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    if (this.isEditing && this.currentProductId) {
      this.http.put(`${this.apiUrl}/negocios/${this.negocioId}/productos/${this.currentProductId}`, formData, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Producto actualizado!'),
          error: (err) => this.manejarError(err)
        });
    } else {
      this.http.post(`${this.apiUrl}/negocios/${this.negocioId}/productos`, formData, { headers })
        .subscribe({
          next: () => this.postGuardadoExitoso('¡Producto creado exitosamente!'),
          error: (err) => this.manejarError(err)
        });
    }
  }

  postGuardadoExitoso(mensaje: string) {
    this.cerrarModal(); 
    Swal.fire('Éxito', mensaje, 'success');
    if (this.negocioId) this.cargarTodosLosProductos(this.negocioId);
  }

  eliminarProducto(id: number) {
    if (!this.negocioId) return;

    Swal.fire({
      title: '¿Eliminar producto?',
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

        this.http.delete(`${this.apiUrl}/negocios/${this.negocioId}/productos/${id}`, { headers }).subscribe({
          next: () => {
            Swal.fire('¡Eliminado!', 'El producto ha sido borrado.', 'success');
            this.cargarTodosLosProductos(this.negocioId!);
          },
          error: (err) => this.manejarError(err)
        });
      }
    });
  }

 manejarError(err: any) {
    Swal.close();
    console.error('Error detallado de Java:', err);
    
    const mensajeBackend = err.error?.message || err.error; 

    if (err.status === 401) {
      Swal.fire({ icon: 'warning', title: 'Sesión expirada', text: 'Cierra sesión y vuelve a entrar.' });
    } 
    // 🔥 Si es un error 400 (Bad Request), es nuestra validación de código duplicado
    else if (err.status === 400 && typeof mensajeBackend === 'string') {
        Swal.fire('Atención', mensajeBackend, 'warning');
    }
    // 🔥 Fallback por si Java sigue escupiendo 500 pero logró mandar el mensaje
    else if (err.status === 500 && typeof mensajeBackend === 'string' && mensajeBackend.includes('Ya existe')) {
        Swal.fire('Atención', mensajeBackend, 'warning');
    } 
    else {
      Swal.fire('Error del Servidor', 'Ocurrió un error al guardar el producto. Revisa los logs de Java.', 'error');
    }
  }
}