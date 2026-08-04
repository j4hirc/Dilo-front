import { Component } from '@angular/core';
import { RouterLink } from '@angular/router'; // 1. Importa esto

@Component({
  selector: 'app-home',
  standalone: true, 
  imports: [RouterLink], 
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home { }