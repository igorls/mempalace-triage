import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StatCard } from '../stat-card/stat-card';
import type { Stats } from '../../models/triage';

@Component({
  selector: 'app-stats-grid',
  imports: [StatCard],
  templateUrl: './stats-grid.html',
  styleUrl: './stats-grid.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsGrid {
  readonly stats = input<Stats | undefined>(undefined);
}
