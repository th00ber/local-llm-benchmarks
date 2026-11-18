import './style.css';
import { Game } from './game';
import { autopilot } from './sim/autopilot';

function showFatal(message: string): void {
  const fatal = document.getElementById('fatal');
  if (!fatal) return;
  fatal.textContent = message;
  fatal.hidden = false;
}

function boot(): void {
  const container = document.getElementById('app');
  const canvas = document.getElementById('scene');
  const minimap = document.getElementById('minimap');
  if (!container || !(canvas instanceof HTMLCanvasElement) || !(minimap instanceof HTMLCanvasElement)) {
    showFatal('The game page is incomplete: required elements are missing.');
    return;
  }

  let game: Game;
  try {
    game = new Game(container, canvas, minimap);
  } catch (error) {
    console.error(error);
    showFatal('Neon Dawn GP needs WebGL 2 to run. Please enable hardware acceleration or try another browser.');
    return;
  }
  game.start();

  // Optional inspection handle for automated checks: open the page with ?debug.
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__neonDawn = { game, world: game.world, autopilot };
  }
}

boot();
