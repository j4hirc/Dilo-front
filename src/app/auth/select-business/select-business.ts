import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import Swal from 'sweetalert2';

interface Business {
  idNegocio: number;
  nombreComercial: string;
  ruc: string;
  // other fields can be added as needed
}

@Component({
  selector: 'app-select-business',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterLink],
  templateUrl: './select-business.html',
  styleUrls: ['./select-business.css']
})
export class SelectBusiness implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  ngOnInit(): void {
    if (this.businesses.length === 1) {
      // Auto-select the only business
      this.select(this.businesses[0].idNegocio);
    }
  }
  // Load businesses from stored user info
  private storedUser = JSON.parse(localStorage.getItem('dilo_user') || '{}');
  businesses: Business[] = this.storedUser.businesses || [];

  select(businessId: number) {
    this.authService.selectBusiness(businessId).subscribe({
      next: (response) => {
        // Update token and user info
        this.authService.saveToken(response.token);
        const usuarioInfo = {
          email: response.email,
          nombre: response.nombreCompleto,
          rol: response.rol,
          negocioId: response.selectedBusinessId,
          businesses: response.businesses,
          needsBusinessSelection: false
        };
        this.authService.saveUser(usuarioInfo);
        Swal.fire({
          icon: 'success',
          title: 'Negocio seleccionado',
          timer: 1200,
          showConfirmButton: false
        }).then(() => {
          // Redirect based on role (similar to login flow)
          const rol = response.rol;
          switch (rol) {
            case 'SUPER_ADMIN':
              this.router.navigate(['/admin-panel']);
              break;
            case 'PROPIETARIO':
              this.router.navigate(['/dashboard/propietario']);
              break;
            case 'VENDEDOR':
              this.router.navigate(['/dashboard/ventas']);
              break;
            case 'BODEGUERO':
              this.router.navigate(['/dashboard/inventario']);
              break;
            default:
              this.router.navigate(['/dashboard']);
          }
        });
      },
      error: (err) => {
        console.error(err);
        Swal.fire({
          icon: 'error',
          title: 'Error al seleccionar negocio',
          text: err?.error?.message || 'Intente de nuevo.'
        });
      }
    });
  }
}
