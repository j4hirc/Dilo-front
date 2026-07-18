import { Routes } from '@angular/router';
// Importamos tu componente Home (asegúrate de que el nombre de la clase sea el correcto)
import { Home } from './home/home'; 

export const routes: Routes = [
  { path: '', component: Home }, // Esta es la ruta raíz (tu Landing Page)
  
  // Estas las descomentaremos cuando crees los componentes
  // { path: 'login', component: LoginComponent }, 
  // { path: 'registro', component: RegistroComponent },
  
  { path: '**', redirectTo: '' } // Si alguien pone una URL rara, lo regresa al inicio
];