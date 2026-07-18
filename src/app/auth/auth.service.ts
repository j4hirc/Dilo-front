import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Tu URL de producción en Render
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1/auth';

  constructor(private http: HttpClient) {}

  login(credentials: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/login`, credentials);
  }

  // Guardamos el token que nos devuelve el backend
  saveToken(token: string): void {
    localStorage.setItem('dilo_token', token);
  }

  // Guardamos los datos del usuario para usarlos en el frontend
  saveUser(user: any): void {
    localStorage.setItem('dilo_user', JSON.stringify(user));
  }

  registrar(formData: FormData): Observable<any> {
  return this.http.post(`${this.apiUrl}/registro`, formData);
}
}