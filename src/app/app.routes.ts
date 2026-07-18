import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },
  { path: 'login', loadComponent: () => import('./auth/login/login').then(m => m.Login) },
  { path: 'registro', loadComponent: () => import('./auth/registro/registro').then(m => m.Registro) },
  { path: 'onboarding-business', loadComponent: () => import('./auth/onboarding-business/onboarding-business').then(m => m.OnboardingBusiness) },
  { path: 'select-business', loadComponent: () => import('./auth/select-business/select-business').then(m => m.SelectBusiness) },
  { path: 'select-role', loadComponent: () => import('./auth/select-role/select-role').then(m => m.SelectRole) },
  
  // Dashboards
  { path: 'dashboard', loadComponent: () => import('./dashboard/dashboard-default').then(m => m.DashboardDefault) },
  { path: 'dashboard/propietario', loadComponent: () => import('./dashboard/propietario/propietario').then(m => m.Propietario) },
  { path: 'dashboard/ventas', loadComponent: () => import('./dashboard/ventas').then(m => m.Ventas) },
  
  // Rellenamos las rutas que faltaban en tu sidebar
  { path: 'dashboard/facturas', loadComponent: () => import('./dashboard/facturas/facturas').then(m => m.Facturas) },
  { path: 'dashboard/clientes', loadComponent: () => import('./dashboard/clientes/clientes').then(m => m.Clientes) },
  { path: 'dashboard/productos', loadComponent: () => import('./dashboard/productos/productos').then(m => m.Productos) },
  { path: 'dashboard/bodegas', loadComponent: () => import('./dashboard/bodegas/bodegas').then(m => m.Bodegas) },
  { path: 'dashboard/kardex', loadComponent: () => import('./dashboard/kardex/kardex').then(m => m.Kardex) },
  { path: 'dashboard/reportes', loadComponent: () => import('./dashboard/reportes/reportes').then(m => m.Reportes) },
  { path: 'dashboard/equipo', loadComponent: () => import('./dashboard/equipo/equipo').then(m => m.Equipo) },
  { path: 'dashboard/configuracion', loadComponent: () => import('./dashboard/configuracion/configuracion').then(m => m.Configuracion) },

  { path: 'admin-panel', loadComponent: () => import('./admin-panel/admin-panel').then(m => m.AdminPanel) },
  
  { path: '**', redirectTo: '' }
];