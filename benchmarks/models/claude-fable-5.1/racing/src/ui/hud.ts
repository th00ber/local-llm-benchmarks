import { CAR_CFG } from '../config';
import { formatTime, toKmh } from '../sim/format';
import type { World } from '../sim/world';

export type MessageTone = 'info' | 'good' | 'bad' | 'boost';

export interface HudHandlers {
  onRestart: () => void;
  onToggleSound: () => void;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing HUD element #${id}`);
  return found as T;
}

/** Writes text only when it changed, to keep DOM work per frame minimal. */
class TextField {
  private last = '';
  constructor(private readonly node: HTMLElement) {
    this.last = node.textContent ?? '';
  }
  set(value: string): void {
    if (value === this.last) return;
    this.last = value;
    this.node.textContent = value;
  }
}

/** DOM overlay: title, lap, timer, speed, checkpoint progress, messages and the finish panel. */
export class Hud {
  private readonly lap = new TextField(element('hud-lap'));
  private readonly time = new TextField(element('hud-time'));
  private readonly checkpoint = new TextField(element('hud-checkpoint'));
  private readonly best = new TextField(element('hud-best'));
  private readonly speed = new TextField(element('hud-speed'));
  private readonly status = new TextField(element('hud-status'));
  private readonly statusNode = element('hud-status');
  private readonly speedBar = element('hud-speed-bar');
  private readonly message = element('hud-message');
  private readonly countdown = element('hud-countdown');
  private readonly warning = element('hud-warning');
  private readonly flashNode = element('hud-flash');
  private readonly finishPanel = element('finish-panel');
  private readonly finishTime = element('finish-time');
  private readonly finishLaps = element('finish-laps');
  private readonly finishRecord = element('finish-record');
  private readonly soundButton = element<HTMLButtonElement>('btn-sound');

  private messageTimer = 0;
  private messagePriority = 0;
  private countdownTimer = 0;
  private flashTimer = 0;
  private lastBar = -1;
  private lastStatusClass = '';

  constructor(handlers: HudHandlers) {
    const restart = (event: Event) => {
      // Drop focus so a later Space / Enter key press cannot re-trigger the button.
      (event.currentTarget as HTMLElement).blur();
      handlers.onRestart();
    };
    element('btn-restart').addEventListener('click', restart);
    element('btn-finish-restart').addEventListener('click', restart);
    this.soundButton.addEventListener('click', (event) => {
      (event.currentTarget as HTMLElement).blur();
      handlers.onToggleSound();
    });
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundButton.textContent = enabled ? 'Sound: on' : 'Sound: off';
    this.soundButton.setAttribute('aria-pressed', String(enabled));
  }

  /** Shows a short toast. Higher priority messages are not replaced by lower ones. */
  showMessage(text: string, tone: MessageTone = 'info', duration = 1.6, priority = 1): void {
    if (this.messageTimer > 0 && priority < this.messagePriority) return;
    this.message.textContent = text;
    this.message.className = `hud-message is-visible tone-${tone}`;
    // Restart the pop animation.
    void this.message.offsetWidth;
    this.message.classList.add('pop');
    this.messageTimer = duration;
    this.messagePriority = priority;
  }

  showCountdown(text: string, go = false): void {
    this.countdown.textContent = text;
    this.countdown.className = `hud-countdown is-visible${go ? ' is-go' : ''}`;
    void this.countdown.offsetWidth;
    this.countdown.classList.add('pop');
    this.countdownTimer = go ? 1.1 : 1.2;
  }

  setWrongWay(active: boolean): void {
    this.warning.classList.toggle('is-visible', active);
  }

  /** Brief coloured vignette (collisions, boosts). */
  flash(tone: 'bad' | 'boost' | 'good'): void {
    this.flashNode.className = `hud-flash is-visible tone-${tone}`;
    this.flashTimer = 0.28;
  }

  showFinish(world: World, previousRecord: number | null, isRecord: boolean): void {
    const { race } = world;
    this.finishTime.textContent = formatTime(race.time);
    this.finishLaps.replaceChildren(
      ...race.lapTimes.map((lapTime, index) => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `Lap ${index + 1}`;
        const value = document.createElement('span');
        value.textContent = formatTime(lapTime);
        row.append(label, value);
        if (race.bestLap !== null && lapTime === race.bestLap) row.classList.add('is-best');
        return row;
      }),
    );
    if (isRecord) {
      this.finishRecord.textContent = previousRecord === null ? 'First record set!' : 'New record!';
    } else if (previousRecord !== null) {
      this.finishRecord.textContent = `Record to beat: ${formatTime(previousRecord)}`;
    } else {
      this.finishRecord.textContent = '';
    }
    this.finishRecord.classList.toggle('is-record', isRecord);
    this.finishPanel.hidden = false;
  }

  /** Clears every transient element (race restart). */
  reset(): void {
    this.finishPanel.hidden = true;
    this.message.className = 'hud-message';
    this.messageTimer = 0;
    this.messagePriority = 0;
    this.countdown.className = 'hud-countdown';
    this.countdownTimer = 0;
    this.flashNode.className = 'hud-flash';
    this.flashTimer = 0;
    this.setWrongWay(false);
  }

  update(world: World, dt: number): void {
    const { race, car } = world;
    this.lap.set(`Lap ${race.lap} / ${race.totalLaps}`);
    this.time.set(formatTime(race.time));
    this.checkpoint.set(`${race.checkpointsPassed} / ${race.checkpointCount}`);
    this.best.set(race.bestLap === null ? '-:--.---' : formatTime(race.bestLap));

    const kmh = Math.round(toKmh(car.speed));
    this.speed.set(String(kmh));
    const bar = Math.round(Math.min(1, Math.abs(car.speed) / CAR_CFG.boostMaxSpeed) * 100);
    if (bar !== this.lastBar) {
      this.lastBar = bar;
      this.speedBar.style.transform = `scaleX(${bar / 100})`;
    }

    let status = '';
    let statusClass = '';
    if (race.phase === 'finished') {
      status = 'FINISHED';
      statusClass = 'tone-good';
    } else if (car.boostTimer > 0) {
      status = 'BOOST';
      statusClass = 'tone-boost';
    } else if (car.slipTimer > 0) {
      status = 'SLIPPING';
      statusClass = 'tone-bad';
    } else if (car.offroad) {
      status = 'OFF TRACK';
      statusClass = 'tone-bad';
    } else if (car.speed < -0.5) {
      status = 'REVERSE';
      statusClass = 'tone-info';
    }
    this.status.set(status);
    if (statusClass !== this.lastStatusClass) {
      this.lastStatusClass = statusClass;
      this.statusNode.className = `speedo-status ${statusClass}`;
    }

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) {
        this.message.className = 'hud-message';
        this.messagePriority = 0;
      }
    }
    if (this.countdownTimer > 0) {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) this.countdown.className = 'hud-countdown';
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashNode.className = 'hud-flash';
    }
  }
}
