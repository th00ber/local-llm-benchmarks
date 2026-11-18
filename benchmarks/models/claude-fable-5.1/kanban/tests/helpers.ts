import type { BoardState, Card, Priority } from '../src/types';

/** In-memory stand-in for localStorage. */
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

export function makeCard(
  id: string,
  title: string,
  priority: Priority = 'medium',
  dueDate: string | null = null,
  description = '',
): Card {
  return { id, title, description, priority, dueDate };
}

/** "Today" used by the tests that need a fixed clock. */
export const TODAY = '2026-06-15';
export const NOW = new Date(2026, 5, 15, 10, 30);

/**
 * Backlog: a (low), b (high, overdue) · To Do: c (medium, with description)
 * In Progress: empty · Done: d (low)
 */
export function fixtureBoard(): BoardState {
  return {
    columns: [
      {
        id: 'backlog',
        name: 'Backlog',
        isDone: false,
        cards: [
          makeCard('a', 'Alpha task', 'low'),
          makeCard('b', 'Beta task', 'high', '2026-06-01'),
        ],
      },
      {
        id: 'todo',
        name: 'To Do',
        isDone: false,
        cards: [makeCard('c', 'Gamma chore', 'medium', '2026-06-20', 'Some details')],
      },
      { id: 'progress', name: 'In Progress', isDone: false, cards: [] },
      { id: 'done', name: 'Done', isDone: true, cards: [makeCard('d', 'Delta done', 'low')] },
    ],
  };
}

export function cardIds(state: BoardState, columnId: string): string[] {
  return state.columns.find((column) => column.id === columnId)?.cards.map((card) => card.id) ?? [];
}
