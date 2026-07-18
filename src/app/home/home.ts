import { Component } from '@angular/core';
import { RouterLink } from '@angular/router'; // 1. Importa esto

@Component({
  selector: 'app-home',
  standalone: true, // Esto es clave
  imports: [RouterLink], // 2. Agrégalo aquí a los imports
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home { }