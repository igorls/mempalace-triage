import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type StatTone =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'orange'
  | 'purple'
  | 'cyan';

@Component({
  selector: 'app-stat-card',
  templateUrl: './stat-card.html',
  styleUrl: './stat-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'card flex flex-col justify-between min-h-[104px] px-5 py-4 transition-colors hover:border-border-strong',
  },
})
export class StatCard {
  readonly value = input<string | number | null>(null);
  readonly label = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly tone = input<StatTone>('blue');

  protected readonly valueClass = computed(() => `text-accent-${this.tone()}`);
}
