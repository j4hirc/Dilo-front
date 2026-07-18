import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Bodegas } from './bodegas';

describe('Bodegas', () => {
  let component: Bodegas;
  let fixture: ComponentFixture<Bodegas>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Bodegas],
    }).compileComponents();

    fixture = TestBed.createComponent(Bodegas);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
