import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Kardex } from './kardex';

describe('Kardex', () => {
  let component: Kardex;
  let fixture: ComponentFixture<Kardex>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Kardex],
    }).compileComponents();

    fixture = TestBed.createComponent(Kardex);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
