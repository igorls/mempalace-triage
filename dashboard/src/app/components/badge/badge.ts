import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeTone =
  | 'green'
  | 'yellow'
  | 'red'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'cyan'
  | 'neutral';

@Component({
  selector: 'app-badge',
  templateUrl: './badge.html',
  styleUrl: './badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-tone]': 'tone()',
  },
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
  readonly label = input.required<string>();

  protected readonly toneClasses = computed(() => {
    switch (this.tone()) {
      case 'green':
        return 'bg-accent-green/10 text-accent-green';
      case 'yellow':
        return 'bg-accent-yellow/10 text-accent-yellow';
      case 'red':
        return 'bg-accent-red/10 text-accent-red';
      case 'blue':
        return 'bg-accent-blue/10 text-accent-blue';
      case 'purple':
        return 'bg-accent-purple/10 text-accent-purple';
      case 'orange':
        return 'bg-accent-orange/10 text-accent-orange';
      case 'cyan':
        return 'bg-accent-cyan/10 text-accent-cyan';
      default:
        return 'bg-white/5 text-fg-muted';
    }
  });
}
