# Neon Dawn GP

A single-player, third-person 3D arcade racing game built with **Vite + TypeScript + Three.js**.
Three laps around a 1.5 km neon circuit at sunrise: five checkpoints, barriers, patrol drones,
cones, oil slicks and boost pads. Everything (models, textures, sky, sounds) is generated in code;
there are no external assets and no runtime dependency other than `three`.

## Run

```bash
npm install
npm run dev       # development server
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
npm test          # unit tests (vitest)
```

## Controls

| Key            | Action                              |
| -------------- | ----------------------------------- |
| `Z` / `Up`     | Accelerate                          |
| `S` / `Down`   | Brake, then reverse when stopped    |
| `Q` / `Left`   | Steer left                          |
| `D` / `Right`  | Steer right                         |
| `R`            | Restart the race (also a HUD button) |
| `M`            | Toggle sound                        |

`W` / `A` are accepted as aliases of `Z` / `Q`.

## Rules

- The race starts after a 3-2-1 countdown and lasts three laps.
- A lap counts only when the five checkpoints were crossed in order, in the driving direction,
  and the finish line is then crossed forwards. The next gate is highlighted on the track and on the minimap.
- Walls are solid; the shoulder between the asphalt and the walls slows the car down.
- Hazards: barriers and drones (solid, big speed loss), cones (small speed loss), oil (loss of grip).
  Boost pads give a short burst above normal top speed.

## Code layout

```
src/
  config.ts          gameplay tunables
  game.ts            main loop (fixed 120 Hz simulation, interpolated rendering), event feedback
  sim/               renderer-independent game logic (unit tested)
    track.ts           closed spline centreline, projection queries
    trackLayout.ts     circuit, checkpoints and obstacle placement data
    car.ts             arcade car physics
    obstacles.ts       hazards and their collision response
    race.ts            countdown, timer, checkpoints, laps
    world.ts           glue: walls, obstacles, events, reset
    autopilot.ts       simple driver used by the tests to prove the race is completable
  view/              Three.js scene: sky, track, scenery, car, obstacles, particles, camera, post-processing
  ui/                HUD, minimap, keyboard input
  audio/             synthesised sound effects (Web Audio)
tests/               vitest unit tests for the simulation
```

Opening the page with `?debug` exposes `window.__neonDawn` (game, world, autopilot) for automated checks.
