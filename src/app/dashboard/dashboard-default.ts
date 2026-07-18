import { Component } from '@angular/core';

@Component({
  selector: 'app-dashboard-default',
  standalone: true,
  template: `
    <div style="padding: 50px; text-align: center;">
      <h1>Dashboard Principal</h1>
      <p>Bienvenido al dashboard.</p>
    </div>
  `
})
export class DashboardDefault {}
