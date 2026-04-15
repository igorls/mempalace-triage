import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Badge } from '../../components/badge/badge';
import { DashboardHeader } from '../../components/dashboard-header/dashboard-header';
import { PriorityQueues } from '../../components/priority-queues/priority-queues';
import { StatsGrid } from '../../components/stats-grid/stats-grid';
import { TriageTable } from '../../components/triage-table/triage-table';
import { Realtime } from '../../services/realtime';

@Component({
  selector: 'app-triage-dashboard',
  imports: [Badge, DashboardHeader, PriorityQueues, StatsGrid, TriageTable],
  templateUrl: './triage-dashboard.html',
  styleUrl: './triage-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TriageDashboard {
  protected readonly rt = inject(Realtime);

  protected readonly items = computed(() => this.rt.items() ?? []);
  protected readonly openItems = computed(() =>
    this.items().filter((i) => i.state === 'OPEN'),
  );
  protected readonly criticalItems = computed(() =>
    this.openItems().filter((i) => i.severityHeuristic === 'critical'),
  );
  protected readonly highItems = computed(() =>
    this.openItems().filter((i) => i.severityHeuristic === 'high'),
  );
  protected readonly alertItems = computed(() => [
    ...this.criticalItems(),
    ...this.highItems(),
  ]);
  protected readonly suspiciousPrs = computed(() => {
    const rank: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      none: 0,
    };
    return this.openItems()
      .filter((i) => i.kind === 'pr' && i.isSuspicious)
      .sort((a, b) => (rank[b.suspicionLevel] ?? 0) - (rank[a.suspicionLevel] ?? 0));
  });

  protected readonly suspicionCounts = computed(() => {
    const prs = this.suspiciousPrs();
    return {
      critical: prs.filter((p) => p.suspicionLevel === 'critical').length,
      high: prs.filter((p) => p.suspicionLevel === 'high').length,
      medium: prs.filter((p) => p.suspicionLevel === 'medium').length,
      low: prs.filter((p) => p.suspicionLevel === 'low').length,
    };
  });
}
