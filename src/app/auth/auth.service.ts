import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = 'https://dilo-backend-mxlu.onrender.com/api/v1/auth';

  constructor(private http: HttpClient) {}

  login(credentials: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/login`, credentials);
  }

  saveToken(token: string): void {
    localStorage.setItem('dilo_token', token);
  }

  saveUser(user: any): void {
    localStorage.setItem('dilo_user', JSON.stringify(user));
  }

  registrar(formData: FormData): Observable<any> {
    return this.http.post(`${this.apiUrl}/registro`, formData);
  }

  selectBusiness(businessId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/select-business`, { businessId });
  }
}