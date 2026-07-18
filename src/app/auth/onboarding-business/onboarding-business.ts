import { Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-onboarding-business',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './onboarding-business.html',
  styleUrls: ['./onboarding-business.css']
})
export class OnboardingBusiness {
  private router = inject(Router);
  // No additional logic needed; navigation handled via routerLink in template
}
