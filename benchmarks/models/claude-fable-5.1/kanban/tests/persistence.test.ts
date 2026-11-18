import { describe, expect, it } from 'vitest';
import {
  BOARD_STORAGE_KEY,
  THEME_STORAGE_KEY,
  loadBoard,
  loadBoardOrSeed,
  loadTheme,
  parseBoard,
  saveBoard,
  saveTheme,
} from '../src/persistence';
import { MemoryStorage, NOW, fixtureBoard } from './helpers';

describe('board persistence', () => {
  it('round-trips columns, cards and their order', () => {
    const storage = new MemoryStorage();
    const state = fixtureBoard();
    saveBoard(storage, state);
    expect(loadBoard(storage)).toEqual(state);
  });

  it('returns null when nothing is saved', () => {
    expect(loadBoard(new MemoryStorage())).toBeNull();
  });

  it('falls back to the example board when nothing is saved', () => {
    const state = loadBoardOrSeed(new MemoryStorage(), NOW);
    expect(state.columns.map((column) => column.name)).toEqual([
      'Backlog',
      'To Do',
      'In Progress',
      'Done',
    ]);
  });

  it('prefers the saved board over the example board', () => {
    const storage = new MemoryStorage();
    saveBoard(storage, fixtureBoard());
    expect(loadBoardOrSeed(storage, NOW)).toEqual(fixtureBoard());
  });

  it('restores a board whose columns were all deleted (not the examples)', () => {
    const storage = new MemoryStorage();
    saveBoard(storage, { columns: [] });
    expect(loadBoardOrSeed(storage, NOW)).toEqual({ columns: [] });
  });

  it('ignores corrupt JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(BOARD_STORAGE_KEY, '{not json');
    expect(loadBoard(storage)).toBeNull();
  });

  it('survives a storage that throws', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error('blocked');
    };
    broken.setItem = () => {
      throw new Error('quota');
    };
    expect(loadBoard(broken)).toBeNull();
    expect(() => saveBoard(broken, fixtureBoard())).not.toThrow();
    expect(loadTheme(broken)).toBe('dark');
    expect(() => saveTheme(broken, 'light')).not.toThrow();
  });
});

describe('parseBoard', () => {
  it('rejects values that are not a board', () => {
    expect(parseBoard(null)).toBeNull();
    expect(parseBoard('board')).toBeNull();
    expect(parseBoard({})).toBeNull();
    expect(parseBoard({ columns: 'nope' })).toBeNull();
    expect(parseBoard({ columns: [{ id: 1, name: 'X', cards: [] }] })).toBeNull();
    expect(parseBoard({ columns: [{ id: 'x', name: 'X' }] })).toBeNull();
  });

  it('repairs card fields with invalid values and drops unusable cards', () => {
    const parsed = parseBoard({
      columns: [
        {
          id: 'col',
          name: 'Column',
          cards: [
            { id: '1', title: 'Ok', priority: 'urgent', dueDate: 'tomorrow', description: 42 },
            { id: '2', title: '   ' },
            'garbage',
          ],
        },
      ],
    });
    expect(parsed).toEqual({
      columns: [
        {
          id: 'col',
          name: 'Column',
          isDone: false,
          cards: [{ id: '1', title: 'Ok', description: '', priority: 'medium', dueDate: null }],
        },
      ],
    });
  });
});

describe('theme persistence', () => {
  it('defaults to dark', () => {
    expect(loadTheme(new MemoryStorage())).toBe('dark');
  });

  it('round-trips the chosen theme', () => {
    const storage = new MemoryStorage();
    saveTheme(storage, 'light');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(loadTheme(storage)).toBe('light');
  });

  it('treats unknown values as dark', () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(loadTheme(storage)).toBe('dark');
  });
});
