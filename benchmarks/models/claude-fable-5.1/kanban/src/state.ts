/* ==========================================================================
   State — pure functions over the board. Nothing here touches the DOM or
   localStorage. Every update returns a new state, or the SAME reference when
   nothing changed (callers use that to skip saving and re-rendering).
   ========================================================================== */

import type { BoardState, Card, CardDraft, Column, Filters, Stats } from './types';

/* ---------- Helpers ------------------------------------------------------ */

/** Formats a Date as a local `YYYY-MM-DD` string (the format of `<input type="date">`). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createId(): string {
  // randomUUID only exists in secure contexts; fall back for plain-http LAN access.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDoneName(name: string): boolean {
  return name.trim().toLowerCase() === 'done';
}

function hasDoneColumn(state: BoardState): boolean {
  return state.columns.some((column) => column.isDone);
}

export function emptyDraft(): CardDraft {
  return { title: '', description: '', priority: 'medium', dueDate: null };
}

/* ---------- Initial / example data --------------------------------------- */

/** Example board shown on first visit: a few cards across the four default columns. */
export function createSeedState(now: Date = new Date()): BoardState {
  const inDays = (days: number): string => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    return toISODate(date);
  };
  const card = (
    title: string,
    priority: Card['priority'],
    dueDate: string | null,
    description = '',
  ): Card => ({ id: createId(), title, description, priority, dueDate });

  return {
    columns: [
      {
        id: createId(),
        name: 'Backlog',
        isDone: false,
        cards: [
          card('Plan the summer trip', 'low', inDays(30), 'Compare train and flight prices, shortlist three places to stay.'),
          card('Sort out the photo library', 'low', null),
        ],
      },
      {
        id: createId(),
        name: 'To Do',
        isDone: false,
        cards: [
          card('Renew passport', 'high', inDays(-2), 'Bring two photos and the old passport to the town hall.'),
          card('Book dentist appointment', 'medium', inDays(5)),
          card('Buy a birthday gift for Léa', 'medium', inDays(9)),
        ],
      },
      {
        id: createId(),
        name: 'In Progress',
        isDone: false,
        cards: [
          card('Write the monthly budget', 'high', inDays(1), 'Review subscriptions and update the savings goal.'),
          card('Read “Deep Work”', 'low', null, 'Currently at chapter 4.'),
        ],
      },
      {
        id: createId(),
        name: 'Done',
        isDone: true,
        cards: [
          card('Set up this board', 'medium', null),
          card('Cancel the unused gym membership', 'low', null),
        ],
      },
    ],
  };
}

/* ---------- Columns ------------------------------------------------------ */

export function addColumn(state: BoardState, name: string, id: string = createId()): BoardState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  const column: Column = {
    id,
    name: trimmed,
    // If the Done column was deleted, a new column called "Done" takes over its role.
    isDone: isDoneName(trimmed) && !hasDoneColumn(state),
    cards: [],
  };
  return { columns: [...state.columns, column] };
}

export function renameColumn(state: BoardState, columnId: string, name: string): BoardState {
  const trimmed = name.trim();
  const target = state.columns.find((column) => column.id === columnId);
  if (!target || !trimmed || trimmed === target.name) return state;
  const becomesDone = isDoneName(trimmed) && !hasDoneColumn(state);
  return {
    columns: state.columns.map((column) =>
      column.id === columnId
        ? { ...column, name: trimmed, isDone: column.isDone || becomesDone }
        : column,
    ),
  };
}

/** Deletes a column, but only when it holds no cards. */
export function deleteColumn(state: BoardState, columnId: string): BoardState {
  const target = state.columns.find((column) => column.id === columnId);
  if (!target || target.cards.length > 0) return state;
  return { columns: state.columns.filter((column) => column.id !== columnId) };
}

/* ---------- Cards -------------------------------------------------------- */

/** Appends a card to the bottom of a column. A title is required. */
export function addCard(
  state: BoardState,
  columnId: string,
  draft: CardDraft,
  id: string = createId(),
): BoardState {
  const title = draft.title.trim();
  if (!title || !state.columns.some((column) => column.id === columnId)) return state;
  const card: Card = {
    id,
    title,
    description: draft.description.trim(),
    priority: draft.priority,
    dueDate: draft.dueDate || null,
  };
  return {
    columns: state.columns.map((column) =>
      column.id === columnId ? { ...column, cards: [...column.cards, card] } : column,
    ),
  };
}

export function deleteCard(state: BoardState, cardId: string): BoardState {
  if (!findCard(state, cardId)) return state;
  return {
    columns: state.columns.map((column) =>
      column.cards.some((card) => card.id === cardId)
        ? { ...column, cards: column.cards.filter((card) => card.id !== cardId) }
        : column,
    ),
  };
}

export function findCard(
  state: BoardState,
  cardId: string,
): { card: Card; column: Column; index: number } | null {
  for (const column of state.columns) {
    const index = column.cards.findIndex((card) => card.id === cardId);
    const card = column.cards[index];
    if (card) return { card, column, index };
  }
  return null;
}

/**
 * Moves a card into `toColumnId`, placing it just before `beforeCardId`
 * (or at the end of the column when `beforeCardId` is null or unknown).
 * Works both across columns and for reordering inside one column.
 */
export function moveCard(
  state: BoardState,
  cardId: string,
  toColumnId: string,
  beforeCardId: string | null,
): BoardState {
  const found = findCard(state, cardId);
  const target = state.columns.find((column) => column.id === toColumnId);
  if (!found || !target) return state;
  if (beforeCardId === cardId) return state;

  const remaining = target.cards.filter((card) => card.id !== cardId);
  const beforeIndex = beforeCardId ? remaining.findIndex((card) => card.id === beforeCardId) : -1;
  const insertAt = beforeIndex === -1 ? remaining.length : beforeIndex;

  // Dropped back exactly where it was: nothing to do.
  if (found.column.id === toColumnId && insertAt === found.index) return state;

  const nextTargetCards = [...remaining.slice(0, insertAt), found.card, ...remaining.slice(insertAt)];
  return {
    columns: state.columns.map((column) => {
      if (column.id === toColumnId) return { ...column, cards: nextTargetCards };
      if (column.id === found.column.id) {
        return { ...column, cards: column.cards.filter((card) => card.id !== cardId) };
      }
      return column;
    }),
  };
}

/* ---------- Derived data: overdue, filters, statistics ------------------- */

/** A card is overdue when its due date is strictly before today (both `YYYY-MM-DD`). */
export function isOverdue(card: Card, today: string): boolean {
  return card.dueDate !== null && card.dueDate < today;
}

export function matchesFilters(card: Card, filters: Filters): boolean {
  const query = filters.search.trim().toLowerCase();
  if (query && !card.title.toLowerCase().includes(query)) return false;
  if (filters.priority !== 'all' && card.priority !== filters.priority) return false;
  return true;
}

export function filtersActive(filters: Filters): boolean {
  return filters.search.trim() !== '' || filters.priority !== 'all';
}

export function computeStats(state: BoardState, today: string): Stats {
  let total = 0;
  let overdue = 0;
  let done = 0;
  for (const column of state.columns) {
    total += column.cards.length;
    if (column.isDone) done += column.cards.length;
    overdue += column.cards.filter((card) => isOverdue(card, today)).length;
  }
  const completionRate = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, overdue, done, completionRate };
}
