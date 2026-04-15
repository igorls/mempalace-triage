import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Badge } from '../badge/badge';
import type { TriageItem } from '../../models/triage';

@Component({
  selector: 'app-triage-table',
  imports: [Badge],
  templateUrl: './triage-table.html',
  styleUrl: './triage-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TriageTable {
  readonly items = input.required<TriageItem[]>();
  readonly emptyMessage = input('No items.');

  protected githubUrl(item: TriageItem): string {
    const base = 'https://github.com/MemPalace/mempalace';
    return `${base}/${item.kind === 'pr' ? 'pull' : 'issues'}/${item.number}`;
  }
}
