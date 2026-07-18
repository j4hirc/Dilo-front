import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },
  { path: 'login', loadComponent: () => import('./auth/login/login').then(m => m.Login) },
  { path: 'registro', loadComponent: () => import('./auth/registro/registro').then(m => m.Registro) },


  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard-default').then(m => m.DashboardDefault),
    children: [
      { path: 'propietario', loadComponent: () => import('./dashboard/propietario/propietario').then(m => m.Propietario) },
      { path: 'facturas', loadComponent: () => import('./dashboard/facturas/facturas').then(m => m.Facturas) },
      { path: 'clientes', loadComponent: () => import('./dashboard/clientes/clientes').then(m => m.Clientes) },
      { path: 'productos', loadComponent: () => import('./dashboard/productos/productos').then(m => m.Productos) },
      { path: 'bodegas', loadComponent: () => import('./dashboard/bodegas/bodegas').then(m => m.Bodegas) },
      { path: 'dashboard/facturas', loadComponent: () => import('./dashboard/facturas/facturas').then(m => m.Facturas) },
      { path: 'dashboard/productos', loadComponent: () => import('./dashboard/productos/productos').then(m => m.Productos) },
      { path: 'dashboard/categorias', loadComponent: () => import('./dashboard/categorias/categorias').then(m => m.Categorias) },

      { path: '', redirectTo: 'propietario', pathMatch: 'full' }
    ]
  },

  { path: 'admin-panel', loadComponent: () => import('./admin-panel/admin-panel').then(m => m.AdminPanel) },
  { path: '**', redirectTo: '' }
];