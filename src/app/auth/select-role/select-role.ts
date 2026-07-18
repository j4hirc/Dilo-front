import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-select-role',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterLink],
  templateUrl: './select-role.html',
  styleUrls: ['./select-role.css']
})
export class SelectRole implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);

  // Load roles from stored user info
  private storedUser = JSON.parse(localStorage.getItem('dilo_user') || '{}');
  roles: string[] = this.storedUser.roles || [];

  ngOnInit(): void {
    if (this.roles.length === 1) {
      // Should already be handled by login.ts, but fallback just in case
      this.select(this.roles[0]);
    } else if (this.roles.length === 0) {
       this.router.navigate(['/onboarding-business']);
    }
  }

  select(rol: string) {
    // Save the selected role in localStorage to persist the choice
    this.storedUser.rol = rol;
    this.storedUser.needsRoleSelection = false;
    this.authService.saveUser(this.storedUser);

    Swal.fire({
      icon: 'success',
      title: 'Rol seleccionado',
      text: `Has ingresado como ${rol}`,
      timer: 1200,
      showConfirmButton: false
    }).then(() => {
      // Redirect based on the chosen role
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
  }
}
