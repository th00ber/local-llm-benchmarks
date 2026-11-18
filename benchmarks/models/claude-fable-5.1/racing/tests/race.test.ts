import { describe, expect, it } from 'vitest';
import { RaceState } from '../src/sim/race';

const LENGTH = 1000;
const GATES = [0, 200, 400, 600, 800];
const DT = 0.1;

function startedRace(): RaceState {
  const race = new RaceState(GATES, LENGTH, 3, 3);
  while (race.phase === 'countdown') race.tickCountdown(DT);
  return race;
}

/** Drives from `from` to `to` (lap distance, may be negative delta) in small steps. */
function travel(race: RaceState, from: number, distance: number, events: string[] = []): number {
  const step = 5 * Math.sign(distance);
  let s = from;
  for (let moved = 0; moved < Math.abs(distance); moved += 5) {
    const next = (((s + step) % LENGTH) + LENGTH) % LENGTH;
    const update = race.advance(DT, s, next);
    if (update.type !== 'none') events.push(update.type);
    s = next;
  }
  return s;
}

describe('race rules', () => {
  it('counts down 3, 2, 1 before the race starts', () => {
    const race = new RaceState(GATES, LENGTH, 3, 3);
    const ticks: number[] = [];
    for (let i = 0; i < 400 && race.phase === 'countdown'; i++) {
      const tick = race.tickCountdown(0.01);
      if (tick >= 0) ticks.push(tick);
    }
    expect(ticks).toEqual([2, 1, 0]);
    expect(race.phase).toBe('racing');
    expect(race.time).toBe(0);
  });

  it('does not run the clock or validate gates during the countdown', () => {
    const race = new RaceState(GATES, LENGTH, 3, 3);
    expect(race.advance(DT, 190, 210).type).toBe('none');
    expect(race.time).toBe(0);
    expect(race.checkpointsPassed).toBe(0);
  });

  it('completes a lap only after all checkpoints, in order', () => {
    const race = startedRace();
    const events: string[] = [];
    const s = travel(race, 990, 1010, events);
    expect(s).toBe(0);
    expect(events).toEqual(['checkpoint', 'checkpoint', 'checkpoint', 'checkpoint', 'lap']);
    expect(race.lap).toBe(2);
    expect(race.lapTimes).toHaveLength(1);
    expect(race.checkpointsPassed).toBe(0);
  });

  it('ignores the first crossing of the start line off the grid', () => {
    const race = startedRace();
    const events: string[] = [];
    travel(race, 985, 30, events);
    expect(events).toEqual([]);
    expect(race.lap).toBe(1);
  });

  it('does not award laps for driving back and forth across the finish line', () => {
    const race = startedRace();
    let s = 990;
    for (let i = 0; i < 10; i++) {
      s = travel(race, s, 20);
      s = travel(race, s, -20);
    }
    expect(race.lap).toBe(1);
    expect(race.lapTimes).toHaveLength(0);
  });

  it('does not count a lap when a checkpoint is skipped', () => {
    const race = startedRace();
    // Pass checkpoints 1 and 2, then go back to the line the wrong way and cross it forwards.
    let s = travel(race, 990, 430);
    expect(race.checkpointsPassed).toBe(2);
    s = travel(race, s, -440);
    s = travel(race, s, 30);
    expect(race.lap).toBe(1);
    expect(race.checkpointsPassed).toBe(2);
  });

  it('does not validate checkpoints when driving the wrong way round', () => {
    const race = startedRace();
    travel(race, 990, -1500);
    expect(race.lap).toBe(1);
    expect(race.checkpointsPassed).toBe(0);
  });

  it('does not re-validate an already passed checkpoint', () => {
    const race = startedRace();
    let s = travel(race, 990, 230);
    expect(race.checkpointsPassed).toBe(1);
    s = travel(race, s, -40);
    s = travel(race, s, 40);
    expect(race.checkpointsPassed).toBe(1);
    travel(race, s, 200);
    expect(race.checkpointsPassed).toBe(2);
  });

  it('ignores teleports across a gate', () => {
    const race = startedRace();
    expect(race.advance(DT, 150, 450).type).toBe('none');
    expect(race.checkpointsPassed).toBe(0);
  });

  it('finishes after three laps, freezes the clock and keeps lap times', () => {
    const race = startedRace();
    const events: string[] = [];
    let s = travel(race, 990, 3010, events);
    expect(events.filter((e) => e === 'lap')).toHaveLength(2);
    expect(events[events.length - 1]).toBe('finish');
    expect(race.phase).toBe('finished');
    expect(race.lap).toBe(3);
    expect(race.lapTimes).toHaveLength(3);
    expect(race.lapTimes.reduce((a, b) => a + b, 0)).toBeCloseTo(race.time, 6);
    expect(race.bestLap).toBeCloseTo(Math.min(...race.lapTimes), 9);

    const finalTime = race.time;
    s = travel(race, s, 2000, events);
    expect(race.time).toBe(finalTime);
    expect(race.lap).toBe(3);
    expect(race.lapTimes).toHaveLength(3);
  });

  it('resets everything', () => {
    const race = startedRace();
    travel(race, 990, 2500);
    race.reset();
    expect(race.phase).toBe('countdown');
    expect(race.countdown).toBe(3);
    expect(race.time).toBe(0);
    expect(race.lap).toBe(1);
    expect(race.nextGate).toBe(1);
    expect(race.checkpointsPassed).toBe(0);
    expect(race.lapTimes).toHaveLength(0);
    expect(race.bestLap).toBeNull();
  });
});
