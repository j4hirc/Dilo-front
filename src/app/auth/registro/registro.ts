import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import Swal from 'sweetalert2'; // <-- IMPORTAMOS SWEETALERT2
import { ParroquiaService } from '../../shared/parroquia.service';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, CommonModule],
  templateUrl: './registro.html',
  styleUrl: './registro.css'
})
export class Registro implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private http = inject(HttpClient);
  private parroquiaService = inject(ParroquiaService);
  
  imagePreview: string | ArrayBuffer | null = null;
  showPassword = false;
  showConfirmPassword = false;

  parroquias: any[] = []; 
  registerForm!: FormGroup;
  selectedFile: File | null = null; 
  
  // Controladores de estado
  isLoading = false;
  isLoadingParroquias = true; 
  
  // Calculamos la fecha máxima (Hoy) para que no pongan fechas del futuro
  fechaMaxima: string = new Date().toISOString().split('T')[0];

  ngOnInit(): void {
    this.cargarParroquias();

    // EXPRESIONES REGULARES PARA VALIDAR MEJOR
    const soloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/; 
    const formatoTelefono = /^\+?[0-9\s]{10,14}$/; // Acepta 09... o +593...

    this.registerForm = this.fb.group({
      dni: ['', [Validators.required, Validators.pattern('^[0-9]{10}$')]],
      primerNombre: ['', [Validators.required, Validators.minLength(3), Validators.pattern(soloLetras)]],
      segundoNombre: ['', [Validators.pattern(soloLetras)]], // Opcional, pero si escribe, que sean letras
      apellidoPaterno: ['', [Validators.required, Validators.minLength(3), Validators.pattern(soloLetras)]],
      apellidoMaterno: ['', [Validators.pattern(soloLetras)]],
      email: ['', [Validators.required, Validators.email]],
      telefono: ['', [Validators.required, Validators.pattern(formatoTelefono)]],
      fechaNacimiento: ['', Validators.required],
      direccion: ['', [Validators.required, Validators.minLength(5)]],
      id_parroquia: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
      terminos: [false, Validators.requiredTrue]
    }, { validators: this.passwordMatchValidator });
  }

  cargarParroquias() {
  this.isLoadingParroquias = true;
  this.parroquiaService.getParroquias().subscribe({
    next: data => { this.parroquias = data; this.isLoadingParroquias = false; },
    error: () => this.isLoadingParroquias = false
  });
}

trackById(_: number, p: any) {
    return p.id;
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      const reader = new FileReader();
      reader.onload = e => this.imagePreview = reader.result;
      reader.readAsDataURL(file);
    }
  }

  passwordMatchValidator(form: FormGroup) {
    return form.get('password')?.value === form.get('confirmPassword')?.value ? null : { mismatch: true };
  }

  onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched(); 
      // Alerta de formulario incompleto
      Swal.fire({
        icon: 'warning',
        title: 'Formulario incompleto',
        text: 'Por favor, revisa los campos en rojo antes de continuar.',
        confirmButtonColor: '#ed8936'
      });
      return;
    }

    this.isLoading = true;

    const formValue = this.registerForm.value;
    
    const dtoData = {
      dni: formValue.dni,
      primerNombre: formValue.primerNombre.trim(),
      segundoNombre: formValue.segundoNombre ? formValue.segundoNombre.trim() : "",
      apellidoPaterno: formValue.apellidoPaterno.trim(),
      apellidoMaterno: formValue.apellidoMaterno ? formValue.apellidoMaterno.trim() : "",
      email: formValue.email.trim(),
      password: formValue.password,
      telefono: formValue.telefono.trim(),
      direccion: formValue.direccion.trim(),
      id_parroquia: Number(formValue.id_parroquia),
      fechaNacimiento: formValue.fechaNacimiento,
      fotoPerfil: "" 
    };

    const formData = new FormData();
    formData.append('datos', new Blob([JSON.stringify(dtoData)], { type: 'application/json' }));

    if (this.selectedFile) {
      formData.append('foto', this.selectedFile);
    }

    this.authService.registrar(formData).subscribe({
      next: () => {
        this.isLoading = false; 
        
        // SWEETALERT DE ÉXITO NIVEL DIOS
        Swal.fire({
          icon: 'success',
          title: '¡Registro Exitoso!',
          text: 'Tu cuenta en Dilo ha sido creada correctamente.',
          confirmButtonColor: '#ed8936',
          timer: 3000,
          timerProgressBar: true,
          showConfirmButton: false // Se cierra solo
        }).then(() => {
          this.router.navigate(['/login']);
        });

      },
      error: (err) => {
        this.isLoading = false;
        
        let errorMsg = 'Ocurrió un error en el servidor. Inténtalo más tarde.';
        if (err.status === 409) {
          errorMsg = 'Esta cédula o correo electrónico ya se encuentran registrados.';
        }

        // SWEETALERT DE ERROR
        Swal.fire({
          icon: 'error',
          title: 'No se pudo crear la cuenta',
          text: errorMsg,
          confirmButtonColor: '#ed8936'
        });
      }
    });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }
}