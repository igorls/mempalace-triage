import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/triage-dashboard/triage-dashboard').then((m) => m.TriageDashboard),
  },
  { path: '**', redirectTo: '' },
];
