import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Login } from './auth/login/login';
import { Registro } from './auth/registro/registro';

export const routes: Routes = [
  { path: '', component: Home }, 
  { path: 'login', component: Login },
  { path: 'registro', component: Registro }, // ¡Aquí conectamos el botón!
  { path: '**', redirectTo: '' } 
];