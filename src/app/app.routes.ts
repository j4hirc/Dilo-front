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
      { path: 'categorias', loadComponent: () => import('./dashboard/categorias/categorias').then(m => m.Categorias) },
      { path: 'equipo', loadComponent: () => import('./dashboard/equipo/equipo').then(m => m.Equipo) },
      { path: 'configuracion', loadComponent: () => import('./dashboard/configuracion/configuracion').then(m => m.Configuracion) },
      { path: 'kardex', loadComponent: () => import('./dashboard/kardex/kardex').then(m => m.Kardex) },
      { path: 'inventario', loadComponent: () => import('./dashboard/inventario/inventario').then(m => m.Inventario) },
      { path: 'perfil', loadComponent: () => import('./dashboard/perfil/perfil').then(m => m.Perfil) },

      { path: '', redirectTo: 'propietario', pathMatch: 'full' }
    ]
  },

  { path: 'admin-panel', loadComponent: () => import('./admin-panel/admin-panel').then(m => m.AdminPanel) },
  { path: '**', redirectTo: '' }
];