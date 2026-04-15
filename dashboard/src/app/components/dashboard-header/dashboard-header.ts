import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { ConnectionState } from '../../models/triage';

@Component({
  selector: 'app-dashboard-header',
  imports: [DatePipe],
  templateUrl: './dashboard-header.html',
  styleUrl: './dashboard-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeader {
  readonly connectionState = input.required<ConnectionState>();
  readonly lastUpdated = input<number | null>(null);

  protected readonly dotClass = computed(() => {
    switch (this.connectionState()) {
      case 'open':
        return 'bg-accent-green shadow-[0_0_0_3px] shadow-accent-green/20';
      case 'connecting':
        return 'bg-accent-yellow shadow-[0_0_0_3px] shadow-accent-yellow/20 animate-pulse';
      case 'closed':
        return 'bg-accent-red shadow-[0_0_0_3px] shadow-accent-red/20';
    }
  });
}
