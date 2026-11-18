/* ==========================================================================
   Persistence — save / restore the board and the theme in localStorage.
   Storage can be unavailable (private mode, quota), so every access is
   guarded and loaded data is validated before use.
   ========================================================================== */

import { createSeedState } from './state';
import { PRIORITIES } from './types';
import type { BoardState, Card, Column, Priority, Theme } from './types';

export const BOARD_STORAGE_KEY = 'kanban.board.v1';
export const THEME_STORAGE_KEY = 'kanban.theme';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Board -------------------------------------------------------- */

export function saveBoard(storage: Storage, state: BoardState): void {
  try {
    storage.setItem(BOARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the board keeps working for this session.
  }
}

/** Returns the saved board, or null when nothing valid is stored. */
export function loadBoard(storage: Storage): BoardState | null {
  try {
    const raw = storage.getItem(BOARD_STORAGE_KEY);
    if (raw === null) return null;
    return parseBoard(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Saved board if there is one, otherwise the example board. */
export function loadBoardOrSeed(storage: Storage, now: Date = new Date()): BoardState {
  return loadBoard(storage) ?? createSeedState(now);
}

/* ---------- Validation of stored data ------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseCard(value: unknown): Card | null {
  if (!isRecord(value)) return null;
  const { id, title, description, priority, dueDate } = value;
  if (typeof id !== 'string' || typeof title !== 'string' || !title.trim()) return null;
  return {
    id,
    title,
    description: typeof description === 'string' ? description : '',
    priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : 'medium',
    dueDate: typeof dueDate === 'string' && ISO_DATE.test(dueDate) ? dueDate : null,
  };
}

function parseColumn(value: unknown): Column | null {
  if (!isRecord(value)) return null;
  const { id, name, isDone, cards } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(cards)) return null;
  return {
    id,
    name,
    isDone: isDone === true,
    cards: cards.map(parseCard).filter((card): card is Card => card !== null),
  };
}

export function parseBoard(value: unknown): BoardState | null {
  if (!isRecord(value) || !Array.isArray(value.columns)) return null;
  const columns = value.columns.map(parseColumn);
  if (columns.some((column) => column === null)) return null;
  return { columns: columns as Column[] };
}

/* ---------- Theme -------------------------------------------------------- */

export function loadTheme(storage: Storage): Theme {
  try {
    return storage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveTheme(storage: Storage, theme: Theme): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore: the theme still applies for this session.
  }
}
