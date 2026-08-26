import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import Swal from 'sweetalert2';
import { environment } from "../../../environments/environment";

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
  
  private apiUrlParroquias = environment.apiUrl + '/parroquias';

  imagePreview: string | ArrayBuffer | null = null;
  showPassword = false;
  showConfirmPassword = false;

  parroquias: any[] = []; 
  registerForm!: FormGroup;
  selectedFile: File | null = null; 
  
  isLoading = false;
  isLoadingParroquias = true; 
  
  fechaMaxima: string = new Date().toISOString().split('T')[0];

  ngOnInit(): void {
    this.cargarParroquias();

    const soloLetras = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/; 
    const soloDiezNumeros = /^[0-9]{10}$/;

    this.registerForm = this.fb.group({
      dni: ['', [Validators.required, Validators.pattern(soloDiezNumeros), this.cedulaEcuatorianaValidator]],
      primerNombre: ['', [Validators.required, Validators.minLength(3), Validators.pattern(soloLetras)]],
      segundoNombre: ['', [Validators.pattern(soloLetras)]],
      apellidoPaterno: ['', [Validators.required, Validators.minLength(3), Validators.pattern(soloLetras)]],
      apellidoMaterno: ['', [Validators.pattern(soloLetras)]],
      email: ['', [Validators.required, Validators.email]],
      telefono: ['', [Validators.required, Validators.pattern(soloDiezNumeros)]],
      fechaNacimiento: ['', [Validators.required, this.ageValidator]],
      direccion: ['', [Validators.required, Validators.minLength(5)]],
      id_parroquia: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8)]], // Mínimo 8 caracteres
      confirmPassword: ['', Validators.required],
      terminos: [false, Validators.requiredTrue]
    }, { validators: this.passwordMatchValidator });
  }

  // Validador real de Cédula Ecuatoriana (Módulo 10)
  cedulaEcuatorianaValidator(control: AbstractControl): ValidationErrors | null {
    const cedula = control.value;
    if (!cedula || cedula.length !== 10 || !/^\d+$/.test(cedula)) {
      return null; // Deja que Validators.pattern maneje si no son 10 dígitos
    }

    const provincia = parseInt(cedula.substring(0, 2), 10);
    if (provincia < 1 || (provincia > 24 && provincia !== 30)) {
      return { cedulaInvalida: true };
    }

    const tercerDigito = parseInt(cedula.substring(2, 3), 10);
    if (tercerDigito >= 6) {
      return { cedulaInvalida: true };
    }

    let suma = 0;
    for (let i = 0; i < 9; i++) {
      let digito = parseInt(cedula.charAt(i), 10);
      if (i % 2 === 0) {
        digito *= 2;
        if (digito > 9) digito -= 9;
      }
      suma += digito;
    }

    const digitoVerificador = parseInt(cedula.charAt(9), 10);
    const decenaSuperior = (suma % 10 === 0) ? suma : ((Math.floor(suma / 10) + 1) * 10);
    const resultado = decenaSuperior - suma;

    return resultado === digitoVerificador ? null : { cedulaInvalida: true };
  }

  // Validador mayor de 18 años
  ageValidator(control: AbstractControl): ValidationErrors | null {
    if (!control.value) return null; 
    
    const birthDate = new Date(control.value);
    const today = new Date();
    
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    if (age < 18) {
        return { underage: true }; 
    }
    if (age > 99) {
        return { overage: true }; 
    }
    
    return null; 
  }

  cargarParroquias() {
    this.isLoadingParroquias = true;
    this.http.get<any[]>(this.apiUrlParroquias).subscribe({
      next: (data) => { 
        this.parroquias = data; 
        this.isLoadingParroquias = false; 
      },
      error: (err) => {
        console.error("Error al cargar parroquias:", err);
        this.isLoadingParroquias = false;
      }
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

  mostrarTerminos() {
    Swal.fire({
      title: 'Términos y Condiciones',
      html: `
        <div style="text-align: left; font-size: 14px; line-height: 1.6;">
          <p>Al crear una cuenta en <b>Dilo</b>, aceptas las siguientes políticas:</p>
          <ul style="margin-top: 15px; padding-left: 20px; list-style-type: disc;">
            <li style="margin-bottom: 10px;">La información ingresada debe ser veraz y te haces responsable de su autenticidad.</li>
            <li style="margin-bottom: 10px;">Tus datos serán tratados conforme a nuestra estricta política de privacidad.</li>
            <li style="margin-bottom: 10px;"><b>Cláusula para negocios:</b> Si utilizas esta cuenta en calidad de dueño de negocio para la emisión de comprobantes, aceptas que <b>se cobrará una tarifa de $0.45 USD por cada factura realizada</b> a través del sistema.</li>
            <li>Dilo se reserva el derecho de suspender cuentas por actividades fraudulentas.</li>
          </ul>
        </div>
      `,
      icon: 'info',
      confirmButtonText: 'He leído y entendido',
      confirmButtonColor: '#ed8936',
      customClass: {
        popup: 'terms-swal-popup'
      }
    });
  }

  onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched(); 
      Swal.fire({
        icon: 'warning',
        title: 'Formulario incompleto',
        text: 'Por favor, revisa los campos marcados antes de continuar.',
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
        
        Swal.fire({
          icon: 'success',
          title: '¡Registro Exitoso!',
          text: 'Tu cuenta en Dilo ha sido creada correctamente.',
          confirmButtonColor: '#ed8936',
          timer: 3000,
          timerProgressBar: true,
          showConfirmButton: false 
        }).then(() => {
          this.router.navigate(['/login']);
        });
      },
      error: (err) => {
        this.isLoading = false;
        
        // Muestra el mensaje exacto que enviamos en IllegalArgumentException o conflicto de BD
        let errorMsg = err.error?.message || 'Ocurrió un error en el servidor. Inténtalo más tarde.';
        if (err.status === 409) {
          errorMsg = 'Esta cédula o correo electrónico ya se encuentran registrados.';
        }

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