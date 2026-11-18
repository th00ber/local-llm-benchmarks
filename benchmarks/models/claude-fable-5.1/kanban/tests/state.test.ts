import { describe, expect, it } from 'vitest';
import {
  addCard,
  addColumn,
  computeStats,
  createSeedState,
  deleteCard,
  deleteColumn,
  emptyDraft,
  filtersActive,
  findCard,
  isOverdue,
  matchesFilters,
  moveCard,
  renameColumn,
  toISODate,
} from '../src/state';
import { NOW, TODAY, cardIds, fixtureBoard, makeCard } from './helpers';

describe('toISODate', () => {
  it('formats a local date as YYYY-MM-DD with zero padding', () => {
    expect(toISODate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(toISODate(new Date(2026, 10, 30, 0, 0))).toBe('2026-11-30');
  });
});

describe('createSeedState', () => {
  const seed = createSeedState(NOW);

  it('creates the four default columns in order', () => {
    expect(seed.columns.map((column) => column.name)).toEqual([
      'Backlog',
      'To Do',
      'In Progress',
      'Done',
    ]);
  });

  it('puts example cards in every column', () => {
    for (const column of seed.columns) {
      expect(column.cards.length).toBeGreaterThan(0);
    }
  });

  it('flags only the Done column as done', () => {
    expect(seed.columns.filter((column) => column.isDone).map((column) => column.name)).toEqual([
      'Done',
    ]);
  });

  it('gives every card and column a unique id', () => {
    const ids = seed.columns.flatMap((column) => [column.id, ...column.cards.map((c) => c.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes an overdue example relative to the given date', () => {
    expect(computeStats(seed, TODAY).overdue).toBeGreaterThan(0);
  });
});

describe('columns', () => {
  it('adds a trimmed custom column at the end', () => {
    const next = addColumn(fixtureBoard(), '  Review  ', 'review');
    expect(next.columns.at(-1)).toEqual({ id: 'review', name: 'Review', isDone: false, cards: [] });
  });

  it('ignores a blank column name', () => {
    const state = fixtureBoard();
    expect(addColumn(state, '   ')).toBe(state);
  });

  it('renames a column', () => {
    const next = renameColumn(fixtureBoard(), 'todo', 'Next up');
    expect(next.columns[1]?.name).toBe('Next up');
  });

  it('keeps the old name when the new one is blank or identical', () => {
    const state = fixtureBoard();
    expect(renameColumn(state, 'todo', '  ')).toBe(state);
    expect(renameColumn(state, 'todo', 'To Do')).toBe(state);
    expect(renameColumn(state, 'missing', 'X')).toBe(state);
  });

  it('keeps the done role when the Done column is renamed', () => {
    const next = renameColumn(fixtureBoard(), 'done', 'Shipped');
    expect(next.columns[3]).toMatchObject({ name: 'Shipped', isDone: true });
    expect(computeStats(next, TODAY).done).toBe(1);
  });

  it('deletes an empty column', () => {
    const next = deleteColumn(fixtureBoard(), 'progress');
    expect(next.columns.map((column) => column.id)).toEqual(['backlog', 'todo', 'done']);
  });

  it('refuses to delete a column that still has cards', () => {
    const state = fixtureBoard();
    expect(deleteColumn(state, 'backlog')).toBe(state);
  });

  it('lets a new "Done" column take over once the original is gone', () => {
    let state = deleteCard(fixtureBoard(), 'd');
    state = deleteColumn(state, 'done');
    expect(state.columns.some((column) => column.isDone)).toBe(false);
    state = addColumn(state, 'done', 'done-2');
    expect(state.columns.at(-1)?.isDone).toBe(true);
    // A second column with the same name does not become a second done column.
    state = addColumn(state, 'Done', 'done-3');
    expect(state.columns.at(-1)?.isDone).toBe(false);
  });
});

describe('cards', () => {
  it('adds a card at the bottom of the column', () => {
    const draft = { title: '  New card ', description: ' text ', priority: 'high', dueDate: '2026-07-01' } as const;
    const next = addCard(fixtureBoard(), 'backlog', draft, 'n');
    expect(cardIds(next, 'backlog')).toEqual(['a', 'b', 'n']);
    expect(findCard(next, 'n')?.card).toEqual({
      id: 'n',
      title: 'New card',
      description: 'text',
      priority: 'high',
      dueDate: '2026-07-01',
    });
  });

  it('requires a title', () => {
    const state = fixtureBoard();
    expect(addCard(state, 'backlog', { ...emptyDraft(), title: '   ' })).toBe(state);
  });

  it('ignores an unknown column', () => {
    const state = fixtureBoard();
    expect(addCard(state, 'nope', { ...emptyDraft(), title: 'X' })).toBe(state);
  });

  it('stores a missing due date as null', () => {
    const next = addCard(fixtureBoard(), 'todo', { ...emptyDraft(), title: 'X', dueDate: '' }, 'n');
    expect(findCard(next, 'n')?.card.dueDate).toBeNull();
  });

  it('deletes a card', () => {
    const next = deleteCard(fixtureBoard(), 'a');
    expect(cardIds(next, 'backlog')).toEqual(['b']);
  });

  it('returns the same state when deleting an unknown card', () => {
    const state = fixtureBoard();
    expect(deleteCard(state, 'zzz')).toBe(state);
  });

  it('does not mutate the previous state', () => {
    const state = fixtureBoard();
    const snapshot = structuredClone(state);
    addCard(state, 'backlog', { ...emptyDraft(), title: 'X' });
    deleteCard(state, 'a');
    moveCard(state, 'a', 'done', null);
    renameColumn(state, 'todo', 'Y');
    expect(state).toEqual(snapshot);
  });
});

describe('moveCard', () => {
  it('moves a card to the end of another column', () => {
    const next = moveCard(fixtureBoard(), 'a', 'todo', null);
    expect(cardIds(next, 'backlog')).toEqual(['b']);
    expect(cardIds(next, 'todo')).toEqual(['c', 'a']);
  });

  it('moves a card before a given card in another column', () => {
    const next = moveCard(fixtureBoard(), 'a', 'todo', 'c');
    expect(cardIds(next, 'todo')).toEqual(['a', 'c']);
  });

  it('moves a card into an empty column', () => {
    const next = moveCard(fixtureBoard(), 'b', 'progress', null);
    expect(cardIds(next, 'progress')).toEqual(['b']);
  });

  it('reorders inside a column: down to the end', () => {
    const next = moveCard(fixtureBoard(), 'a', 'backlog', null);
    expect(cardIds(next, 'backlog')).toEqual(['b', 'a']);
  });

  it('reorders inside a column: up before another card', () => {
    const next = moveCard(fixtureBoard(), 'b', 'backlog', 'a');
    expect(cardIds(next, 'backlog')).toEqual(['b', 'a']);
  });

  it('reorders in the middle of a longer column', () => {
    let state = fixtureBoard();
    state = addCard(state, 'backlog', { ...emptyDraft(), title: 'E' }, 'e');
    state = addCard(state, 'backlog', { ...emptyDraft(), title: 'F' }, 'f');
    // a b e f → move f before b
    expect(cardIds(moveCard(state, 'f', 'backlog', 'b'), 'backlog')).toEqual(['a', 'f', 'b', 'e']);
    // a b e f → move a before f
    expect(cardIds(moveCard(state, 'a', 'backlog', 'f'), 'backlog')).toEqual(['b', 'e', 'a', 'f']);
  });

  it('returns the same state when the card is dropped where it already is', () => {
    const state = fixtureBoard();
    expect(moveCard(state, 'a', 'backlog', 'b')).toBe(state); // before its next sibling
    expect(moveCard(state, 'b', 'backlog', null)).toBe(state); // already last
    expect(moveCard(state, 'a', 'backlog', 'a')).toBe(state); // before itself
  });

  it('ignores unknown cards and columns', () => {
    const state = fixtureBoard();
    expect(moveCard(state, 'zzz', 'todo', null)).toBe(state);
    expect(moveCard(state, 'a', 'zzz', null)).toBe(state);
  });

  it('falls back to the end when the reference card is not in the target column', () => {
    const next = moveCard(fixtureBoard(), 'a', 'todo', 'd');
    expect(cardIds(next, 'todo')).toEqual(['c', 'a']);
  });

  it('never loses or duplicates cards', () => {
    const next = moveCard(fixtureBoard(), 'c', 'backlog', 'b');
    const all = next.columns.flatMap((column) => column.cards.map((card) => card.id)).sort();
    expect(all).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('isOverdue', () => {
  it('is true only when the due date is strictly before today', () => {
    expect(isOverdue(makeCard('x', 'X', 'low', '2026-06-14'), TODAY)).toBe(true);
    expect(isOverdue(makeCard('x', 'X', 'low', TODAY), TODAY)).toBe(false);
    expect(isOverdue(makeCard('x', 'X', 'low', '2026-06-16'), TODAY)).toBe(false);
    expect(isOverdue(makeCard('x', 'X', 'low', null), TODAY)).toBe(false);
  });

  it('compares across month and year boundaries', () => {
    expect(isOverdue(makeCard('x', 'X', 'low', '2025-12-31'), '2026-01-01')).toBe(true);
    expect(isOverdue(makeCard('x', 'X', 'low', '2026-10-01'), '2026-09-30')).toBe(false);
  });
});

describe('filters', () => {
  const card = makeCard('x', 'Write Report', 'high');

  it('matches titles case-insensitively', () => {
    expect(matchesFilters(card, { search: 'report', priority: 'all' })).toBe(true);
    expect(matchesFilters(card, { search: 'WRITE', priority: 'all' })).toBe(true);
    expect(matchesFilters(card, { search: 'budget', priority: 'all' })).toBe(false);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesFilters(card, { search: '  report ', priority: 'all' })).toBe(true);
  });

  it('searches titles only, not descriptions', () => {
    const withDescription = makeCard('y', 'Title', 'low', null, 'hidden keyword');
    expect(matchesFilters(withDescription, { search: 'keyword', priority: 'all' })).toBe(false);
  });

  it('filters by priority', () => {
    expect(matchesFilters(card, { search: '', priority: 'high' })).toBe(true);
    expect(matchesFilters(card, { search: '', priority: 'low' })).toBe(false);
  });

  it('combines search and priority', () => {
    expect(matchesFilters(card, { search: 'report', priority: 'medium' })).toBe(false);
    expect(matchesFilters(card, { search: 'report', priority: 'high' })).toBe(true);
  });

  it('knows when a filter is active', () => {
    expect(filtersActive({ search: '', priority: 'all' })).toBe(false);
    expect(filtersActive({ search: '  ', priority: 'all' })).toBe(false);
    expect(filtersActive({ search: 'a', priority: 'all' })).toBe(true);
    expect(filtersActive({ search: '', priority: 'low' })).toBe(true);
  });
});

describe('computeStats', () => {
  it('counts total, overdue, done and the completion rate', () => {
    expect(computeStats(fixtureBoard(), TODAY)).toEqual({
      total: 4,
      overdue: 1,
      done: 1,
      completionRate: 25,
    });
  });

  it('reports 0% for an empty board instead of dividing by zero', () => {
    expect(computeStats({ columns: [] }, TODAY)).toEqual({
      total: 0,
      overdue: 0,
      done: 0,
      completionRate: 0,
    });
  });

  it('rounds the completion rate to a whole percent', () => {
    let state = fixtureBoard();
    state = deleteCard(state, 'a'); // 1 done out of 3
    expect(computeStats(state, TODAY).completionRate).toBe(33);
  });

  it('reaches 100% when every card is in Done', () => {
    let state = fixtureBoard();
    for (const id of ['a', 'b', 'c']) state = moveCard(state, id, 'done', null);
    expect(computeStats(state, TODAY)).toMatchObject({ total: 4, done: 4, completionRate: 100 });
  });
});
