// src/app/shared/parroquia.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay, tap, of } from 'rxjs';

const CACHE_KEY = 'parroquias_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

@Injectable({ providedIn: 'root' })
export class ParroquiaService {
  private http = inject(HttpClient);
  private cache$?: Observable<any[]>;

  getParroquias(): Observable<any[]> {
    // 1. ¿Hay algo válido en localStorage?
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_MS) {
        return of(data);
      }
    }

    // 2. ¿Ya hay una petición en curso o resuelta esta sesión?
    if (!this.cache$) {
      this.cache$ = this.http
        .get<any[]>('https://dilo-backend-mxlu.onrender.com/api/v1/parroquias')
        .pipe(
          tap(data => localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))),
          shareReplay(1) // comparte la misma respuesta entre todos los que se suscriban
        );
    }
    return this.cache$;
  }
}