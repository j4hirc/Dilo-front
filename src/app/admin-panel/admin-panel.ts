import { Component } from '@angular/core';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  template: `
    <div style="padding: 50px; text-align: center;">
      <h1>Panel de Administración</h1>
      <p>Bienvenido, Super Administrador.</p>
    </div>
  `
})
export class AdminPanel {}
