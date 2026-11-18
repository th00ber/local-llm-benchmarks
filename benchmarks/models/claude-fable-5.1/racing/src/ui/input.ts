import type { CarInput } from '../sim/car';

type Action = 'accelerate' | 'brake' | 'left' | 'right';

/**
 * Keyboard bindings, matched on the typed character so they follow the keyboard layout:
 *   Z / Up    accelerate          S / Down   brake, then reverse
 *   Q / Left  steer left          D / Right  steer right
 * W and A are accepted as aliases for Z and Q (QWERTY "WASD" habit).
 */
const KEY_ACTIONS: Record<string, Action> = {
  z: 'accelerate',
  w: 'accelerate',
  arrowup: 'accelerate',
  s: 'brake',
  arrowdown: 'brake',
  q: 'left',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

const SCROLL_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);

export interface InputHandlers {
  onRestart: () => void;
  onToggleSound: () => void;
  /** Called on the first key press / click - used to unlock audio. */
  onFirstInteraction: () => void;
}

export class Input {
  private readonly held = new Set<string>();
  private readonly state: CarInput = { throttle: 0, brake: 0, steer: 0 };
  private interacted = false;

  constructor(private readonly handlers: InputHandlers) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    window.addEventListener('pointerdown', this.onPointerDown);
    document.addEventListener('visibilitychange', this.releaseAll);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('visibilitychange', this.releaseAll);
  }

  /** Current driving input. The returned object is reused between calls. */
  read(): CarInput {
    let accelerate = false;
    let brake = false;
    let left = false;
    let right = false;
    for (const key of this.held) {
      switch (KEY_ACTIONS[key]) {
        case 'accelerate':
          accelerate = true;
          break;
        case 'brake':
          brake = true;
          break;
        case 'left':
          left = true;
          break;
        case 'right':
          right = true;
          break;
      }
    }
    this.state.throttle = accelerate ? 1 : 0;
    this.state.brake = brake ? 1 : 0;
    this.state.steer = (left ? 1 : 0) - (right ? 1 : 0);
    return this.state;
  }

  private firstInteraction(): void {
    if (this.interacted) return;
    this.interacted = true;
    this.handlers.onFirstInteraction();
  }

  private readonly onPointerDown = (): void => {
    this.firstInteraction();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (SCROLL_KEYS.has(key)) event.preventDefault();
    this.firstInteraction();

    if (key in KEY_ACTIONS) {
      this.held.add(key);
      return;
    }
    if (event.repeat) return;
    if (key === 'r') this.handlers.onRestart();
    else if (key === 'm') this.handlers.onToggleSound();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.key.toLowerCase());
  };

  private readonly releaseAll = (): void => {
    this.held.clear();
  };
}
