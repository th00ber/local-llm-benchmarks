const STORAGE_KEY = 'neon-dawn-gp.muted';

export type SoundEffect =
  | 'countdown'
  | 'go'
  | 'checkpoint'
  | 'lap'
  | 'finish'
  | 'crash'
  | 'wall'
  | 'cone'
  | 'boost'
  | 'oil';

/**
 * Fully synthesised audio (Web Audio oscillators and noise) - no audio files.
 * The context is only created after the first user gesture, as browsers require.
 */
export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineA: OscillatorNode | null = null;
  private engineB: OscillatorNode | null = null;
  private noise: AudioBuffer | null = null;

  constructor() {
    try {
      this.enabled = window.localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
      this.enabled = true;
    }
  }

  /** Creates / resumes the audio context. Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const AudioContextClass: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const ctx = new AudioContextClass();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 0.5 : 0;
      this.master.connect(ctx.destination);

      // One second of white noise, reused by every percussive effect.
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 2147483648 - 1) * 0.9;
      }

      // Engine: two detuned oscillators through a low-pass filter.
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 500;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineA = ctx.createOscillator();
      this.engineA.type = 'sawtooth';
      this.engineB = ctx.createOscillator();
      this.engineB.type = 'square';
      const mixB = ctx.createGain();
      mixB.gain.value = 0.5;
      this.engineA.connect(this.engineFilter);
      this.engineB.connect(mixB).connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.master);
      this.engineA.start();
      this.engineB.start();
    } catch {
      this.ctx = null;
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '0' : '1');
    } catch {
      // Storage may be unavailable (private mode); the setting then lasts for the session only.
    }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(enabled ? 0.5 : 0, this.ctx.currentTime, 0.03);
    }
  }

  /** Updates the engine tone. speedRatio is speed / top speed (may exceed 1 while boosting). */
  updateEngine(speedRatio: number, throttle: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineA || !this.engineB || !this.engineGain || !this.engineFilter) return;
    const ratio = Math.min(1.35, Math.abs(speedRatio));
    // Fake gearbox: the pitch climbs within each "gear" and drops on the shift.
    const gears = 5;
    const position = Math.min(ratio, 0.999) * gears;
    const gear = Math.floor(position);
    const inGear = position - gear;
    const frequency = 52 + gear * 9 + inGear * 62 + Math.max(0, ratio - 1) * 120;
    const now = ctx.currentTime;
    this.engineA.frequency.setTargetAtTime(frequency, now, 0.05);
    this.engineB.frequency.setTargetAtTime(frequency * 0.502, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(380 + ratio * 1500 + throttle * 500, now, 0.08);
    const volume = active ? 0.045 + throttle * 0.05 + ratio * 0.035 : 0;
    this.engineGain.gain.setTargetAtTime(volume, now, 0.08);
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
    slideTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  private burst(duration: number, gain: number, filterType: BiquadFilterType, from: number, to: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || !this.enabled) return;
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.03);
  }

  play(effect: SoundEffect, strength = 1): void {
    if (!this.ctx || !this.enabled) return;
    const s = Math.max(0.2, Math.min(1, strength));
    switch (effect) {
      case 'countdown':
        this.tone(440, 0.18, 'square', 0.16);
        break;
      case 'go':
        this.tone(880, 0.55, 'square', 0.2);
        this.tone(1320, 0.55, 'triangle', 0.12);
        break;
      case 'checkpoint':
        this.tone(880, 0.1, 'triangle', 0.22);
        this.tone(1320, 0.16, 'triangle', 0.22, 0.09);
        break;
      case 'lap':
        this.tone(660, 0.12, 'square', 0.14);
        this.tone(880, 0.12, 'square', 0.14, 0.11);
        this.tone(1320, 0.3, 'square', 0.14, 0.22);
        break;
      case 'finish':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, i === 4 ? 0.7 : 0.16, 'square', 0.15, i * 0.14));
        break;
      case 'crash':
        this.burst(0.45, 0.7 * s, 'lowpass', 2400, 180);
        this.tone(110, 0.3, 'sine', 0.5 * s, 0, 38);
        break;
      case 'wall':
        this.burst(0.25, 0.45 * s, 'lowpass', 1800, 300);
        this.tone(90, 0.16, 'sine', 0.3 * s, 0, 45);
        break;
      case 'cone':
        this.burst(0.1, 0.3, 'highpass', 1500, 3000);
        this.tone(300, 0.08, 'triangle', 0.18, 0, 140);
        break;
      case 'boost':
        this.tone(180, 0.6, 'sawtooth', 0.14, 0, 1100);
        this.burst(0.6, 0.22, 'bandpass', 500, 4200);
        break;
      case 'oil':
        this.tone(520, 0.45, 'sine', 0.2, 0, 150);
        break;
    }
  }
}
