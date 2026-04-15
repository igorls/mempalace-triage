import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Badge, type BadgeTone } from '../badge/badge';
import type { Priority, TriageItem } from '../../models/triage';

interface Column {
  label: Priority;
  tone: BadgeTone;
  items: TriageItem[];
}

@Component({
  selector: 'app-priority-queues',
  imports: [Badge],
  templateUrl: './priority-queues.html',
  styleUrl: './priority-queues.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriorityQueues {
  readonly items = input.required<TriageItem[]>();

  protected readonly columns = computed<Column[]>(() => {
    const open = this.items().filter((i) => i.state === 'OPEN');
    const pick = (p: Priority) => open.filter((i) => i.priority === p);
    return [
      { label: 'P0', tone: 'red', items: pick('P0') },
      { label: 'P1', tone: 'orange', items: pick('P1') },
      { label: 'P2', tone: 'yellow', items: pick('P2') },
    ];
  });

  protected githubUrl(item: TriageItem): string {
    const base = 'https://github.com/MemPalace/mempalace';
    return `${base}/${item.kind === 'pr' ? 'pull' : 'issues'}/${item.number}`;
  }
}
