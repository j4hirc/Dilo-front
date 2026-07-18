import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Login } from './auth/login/login';
import { Registro } from './auth/registro/registro';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },
  { path: 'login', loadComponent: () => import('./auth/login/login').then(m => m.Login) },
  { path: 'registro', loadComponent: () => import('./auth/registro/registro').then(m => m.Registro) },
  { path: 'onboarding-business', loadComponent: () => import('./auth/onboarding-business/onboarding-business').then(m => m.OnboardingBusiness) },
  { path: 'select-business', loadComponent: () => import('./auth/select-business/select-business').then(m => m.SelectBusiness) },
  { path: 'select-role', loadComponent: () => import('./auth/select-role/select-role').then(m => m.SelectRole) },
  
  // Dashboards
  { path: 'dashboard/propietario', loadComponent: () => import('./dashboard/propietario/propietario').then(m => m.Propietario) },
  { path: 'dashboard/ventas', loadComponent: () => import('./dashboard/ventas').then(m => m.Ventas) },
  { path: 'dashboard/inventario', loadComponent: () => import('./dashboard/inventario').then(m => m.Inventario) },
  { path: 'dashboard', loadComponent: () => import('./dashboard/dashboard-default').then(m => m.DashboardDefault) },
  { path: 'admin-panel', loadComponent: () => import('./admin-panel/admin-panel').then(m => m.AdminPanel) },
  
  { path: '**', redirectTo: '' }
];