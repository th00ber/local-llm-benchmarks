import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOVE_ANIMATION_MS, mountApp } from '../src/app';
import { BOARD_STORAGE_KEY, THEME_STORAGE_KEY } from '../src/persistence';
import type { BoardState } from '../src/types';
import { MemoryStorage, NOW, cardIds, fixtureBoard } from './helpers';

/* ---------- Test harness -------------------------------------------------- */

function setup(initial: BoardState | null = fixtureBoard(), storage = new MemoryStorage()) {
  if (initial) storage.setItem(BOARD_STORAGE_KEY, JSON.stringify(initial));
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.querySelector<HTMLElement>('#app')!;
  const app = mountApp(root, { storage, now: () => NOW });
  return { app, storage, root };
}

function saved(storage: Storage): BoardState {
  return JSON.parse(storage.getItem(BOARD_STORAGE_KEY) ?? 'null') as BoardState;
}

function column(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.column[data-column-id="${id}"]`)!;
}

function card(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.card[data-card-id="${id}"]`)!;
}

function visibleCardIds(columnId?: string): string[] {
  const scope = columnId ? column(columnId) : document;
  return [...scope.querySelectorAll<HTMLElement>('.card')].map((el) => el.dataset.cardId!);
}

function stat(id: string): string {
  return document.querySelector(`[data-stat="${id}"]`)!.textContent ?? '';
}

function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function press(element: Element, key: string) {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function field<T extends HTMLElement = HTMLInputElement>(columnId: string, name: string): T {
  return column(columnId).querySelector<T>(`.card-form [name="${name}"]`)!;
}

function openForm(columnId: string) {
  column(columnId).querySelector<HTMLButtonElement>('.add-card-btn')!.click();
}

function submitForm(columnId: string) {
  column(columnId)
    .querySelector('.card-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/** jsdom does no layout: give the cards of every column a 100px-tall slot each. */
function layoutCards() {
  for (const list of document.querySelectorAll('.card-list')) {
    list.querySelectorAll<HTMLElement>('.card').forEach((el, index) => {
      const top = index * 100;
      el.getBoundingClientRect = () =>
        ({ top, bottom: top + 80, height: 80, left: 0, right: 280, width: 280, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    });
  }
}

function fireDrag(target: Element, eventType: string, clientY = 0): MouseEvent {
  const event = new MouseEvent(eventType, { bubbles: true, cancelable: true, clientY });
  const data = new Map<string, string>();
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (format: string, value: string) => data.set(format, value),
      getData: (format: string) => data.get(format) ?? '',
    },
  });
  target.dispatchEvent(event);
  return event;
}

/** Drags a card over `targetColumnId` at height `clientY` and drops it there. */
function dragAndDrop(cardId: string, targetColumnId: string, clientY: number) {
  layoutCards();
  fireDrag(card(cardId), 'dragstart');
  const list = column(targetColumnId).querySelector('.card-list')!;
  fireDrag(list, 'dragover', clientY);
  fireDrag(list, 'drop', clientY);
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
});

/* ---------- First load & persistence -------------------------------------- */

describe('first load', () => {
  it('shows the four default columns with example cards when nothing is saved', () => {
    const { storage } = setup(null);
    const titles = [...document.querySelectorAll('.column-title')].map((el) => el.textContent);
    expect(titles).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
    for (const col of document.querySelectorAll('.column')) {
      expect(col.querySelectorAll('.card').length).toBeGreaterThan(0);
    }
    expect(saved(storage).columns).toHaveLength(4);
  });

  it('restores the saved board instead of the examples', () => {
    setup();
    expect(visibleCardIds('backlog')).toEqual(['a', 'b']);
    expect(visibleCardIds('todo')).toEqual(['c']);
    expect(visibleCardIds('progress')).toEqual([]);
    expect(visibleCardIds('done')).toEqual(['d']);
  });

  it('keeps the board across a reload', () => {
    const { storage } = setup();
    openForm('progress');
    type(field('progress', 'title'), 'Survives reload');
    submitForm('progress');

    setup(null, storage); // remount on the same storage
    expect(column('progress').querySelector('.card-title')?.textContent).toBe('Survives reload');
  });

  it('offers an "Add Column" button after the last column', () => {
    setup();
    const board = document.querySelector('.board')!;
    expect(board.lastElementChild?.textContent).toBe('＋ Add Column');
  });
});

/* ---------- Cards --------------------------------------------------------- */

describe('cards', () => {
  it('renders title, priority badge, due date and a collapsed description', () => {
    setup();
    const el = card('c');
    expect(el.querySelector('.card-title')?.textContent).toBe('Gamma chore');
    expect(el.querySelector('.badge')?.textContent).toBe('Medium');
    expect(el.querySelector('.badge')?.classList.contains('badge--medium')).toBe(true);
    expect(el.querySelector('time')?.getAttribute('datetime')).toBe('2026-06-20');

    const details = el.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('p')?.textContent).toBe('Some details');
  });

  it('gives each priority its own badge style', () => {
    setup();
    expect(card('a').querySelector('.badge--low')).not.toBeNull();
    expect(card('b').querySelector('.badge--high')).not.toBeNull();
  });

  it('omits the description block when a card has none', () => {
    setup();
    expect(card('a').querySelector('details')).toBeNull();
  });

  it('flags a past due date in red with a warning icon', () => {
    setup();
    const overdue = card('b').querySelector('time')!;
    expect(overdue.classList.contains('due--overdue')).toBe(true);
    expect(overdue.textContent).toContain('⚠️');

    const upcoming = card('c').querySelector('time')!;
    expect(upcoming.classList.contains('due--overdue')).toBe(false);
    expect(upcoming.textContent).not.toContain('⚠️');
  });

  it('treats user text as text, never as HTML', () => {
    setup();
    openForm('todo');
    type(field('todo', 'title'), '<img src=x onerror=alert(1)>');
    submitForm('todo');
    const title = column('todo').querySelectorAll('.card-title')[1]!;
    expect(title.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(title.querySelector('img')).toBeNull();
  });

  it('keeps a description expanded across re-renders', () => {
    setup();
    const details = card('c').querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));

    type(document.querySelector<HTMLInputElement>('.search-input')!, 'gamma');
    expect(card('c').querySelector('details')!.open).toBe(true);
  });
});

describe('adding a card', () => {
  it('opens an inline form with title, priority, due date, description, Save and Cancel', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    setup();
    openForm('todo');

    const form = column('todo').querySelector('.card-form')!;
    expect(form.querySelector('input[name="title"]')).not.toBeNull();
    expect([...form.querySelectorAll('select[name="priority"] option')].map((o) => o.textContent)).toEqual(
      ['Low', 'Medium', 'High'],
    );
    expect(form.querySelector('input[type="date"][name="dueDate"]')).not.toBeNull();
    expect(form.querySelector('textarea[name="description"]')).not.toBeNull();
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Save');
    expect(form.querySelector('.form-cancel')?.textContent).toBe('Cancel');
    expect(document.activeElement).toBe(form.querySelector('input[name="title"]'));
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('saves the card at the bottom of the column and persists it', () => {
    const { app, storage } = setup();
    openForm('todo');
    type(field('todo', 'title'), 'Pay the rent');
    type(field<HTMLSelectElement>('todo', 'priority'), 'high');
    type(field('todo', 'dueDate'), '2026-07-01');
    type(field<HTMLTextAreaElement>('todo', 'description'), 'Before the 5th');
    submitForm('todo');

    const added = column('todo').querySelectorAll<HTMLElement>('.card')[1]!;
    expect(added.querySelector('.card-title')?.textContent).toBe('Pay the rent');
    expect(added.querySelector('.badge--high')?.textContent).toBe('High');
    expect(added.querySelector('time')?.getAttribute('datetime')).toBe('2026-07-01');
    expect(added.querySelector('details p')?.textContent).toBe('Before the 5th');

    expect(column('todo').querySelector('.card-form')).toBeNull(); // form closes
    expect(saved(storage)).toEqual(app.getState());
    expect(saved(storage).columns[1]?.cards.at(-1)).toMatchObject({
      title: 'Pay the rent',
      priority: 'high',
      dueDate: '2026-07-01',
      description: 'Before the 5th',
    });
  });

  it('defaults to medium priority, no due date and no description', () => {
    const { app } = setup();
    openForm('progress');
    type(field('progress', 'title'), 'Bare card');
    submitForm('progress');
    expect(app.getState().columns[2]?.cards[0]).toMatchObject({
      title: 'Bare card',
      priority: 'medium',
      dueDate: null,
      description: '',
    });
  });

  it('refuses an empty title and says why', () => {
    const { app } = setup();
    openForm('todo');
    type(field('todo', 'title'), '   ');
    submitForm('todo');

    expect(column('todo').querySelector('.form-error')?.textContent).toMatch(/title/i);
    expect(field('todo', 'title').getAttribute('aria-invalid')).toBe('true');
    expect(cardIds(app.getState(), 'todo')).toEqual(['c']);
  });

  it('cancels without adding anything', () => {
    const { app } = setup();
    openForm('todo');
    type(field('todo', 'title'), 'Never mind');
    column('todo').querySelector<HTMLButtonElement>('.form-cancel')!.click();

    expect(column('todo').querySelector('.card-form')).toBeNull();
    expect(cardIds(app.getState(), 'todo')).toEqual(['c']);

    openForm('todo'); // the abandoned draft is gone
    expect(field('todo', 'title').value).toBe('');
  });

  it('closes the form on Escape', () => {
    setup();
    openForm('todo');
    press(field('todo', 'title'), 'Escape');
    expect(column('todo').querySelector('.card-form')).toBeNull();
  });

  it('keeps what was typed when the board re-renders', () => {
    setup();
    openForm('todo');
    type(field('todo', 'title'), 'Half-typed');
    type(document.querySelector<HTMLInputElement>('.search-input')!, 'x');
    expect(field('todo', 'title').value).toBe('Half-typed');
  });
});

describe('deleting a card', () => {
  it('fades the card out, then removes it and saves', () => {
    vi.useFakeTimers();
    const { app, storage } = setup();
    card('a').querySelector<HTMLButtonElement>('.card-delete')!.click();

    expect(card('a').classList.contains('removing')).toBe(true); // still there, animating
    expect(cardIds(app.getState(), 'backlog')).toEqual(['a', 'b']);

    vi.advanceTimersByTime(REMOVE_ANIMATION_MS);
    expect(card('a')).toBeNull();
    expect(cardIds(app.getState(), 'backlog')).toEqual(['b']);
    expect(cardIds(saved(storage), 'backlog')).toEqual(['b']);
  });

  it('ignores a second click while the card is fading', () => {
    vi.useFakeTimers();
    const { app } = setup();
    const button = card('a').querySelector<HTMLButtonElement>('.card-delete')!;
    button.click();
    button.click();
    vi.advanceTimersByTime(REMOVE_ANIMATION_MS * 2);
    expect(cardIds(app.getState(), 'backlog')).toEqual(['b']);
  });
});

/* ---------- Columns ------------------------------------------------------- */

describe('columns', () => {
  it('adds a column and lets the user name it right away', () => {
    const { app, storage } = setup();
    document.querySelector<HTMLButtonElement>('.add-column-btn')!.click();

    expect(document.querySelectorAll('.column')).toHaveLength(5);
    const input = document.querySelector<HTMLInputElement>('.column-rename')!;
    expect(document.activeElement).toBe(input);

    input.value = 'Review';
    press(input, 'Enter');

    expect(app.getState().columns.at(-1)?.name).toBe('Review');
    expect(saved(storage).columns.at(-1)?.name).toBe('Review');
    expect(document.querySelector('.column-rename')).toBeNull();
    // The button stays at the end of the board.
    expect(document.querySelector('.board')!.lastElementChild?.classList.contains('add-column-btn')).toBe(true);
  });

  it('renames a column on double-click, saving with Enter', () => {
    const { app, storage } = setup();
    column('todo').querySelector('.column-title')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const input = column('todo').querySelector<HTMLInputElement>('.column-rename')!;
    expect(input.value).toBe('To Do');
    input.value = 'Next up';
    press(input, 'Enter');

    expect(column('todo').querySelector('.column-title')?.textContent).toBe('Next up');
    expect(app.getState().columns[1]?.name).toBe('Next up');
    expect(saved(storage).columns[1]?.name).toBe('Next up');
  });

  it('saves the new name when the field loses focus', () => {
    const { app } = setup();
    column('todo').querySelector('.column-title')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = column('todo').querySelector<HTMLInputElement>('.column-rename')!;
    input.value = 'Soon';
    input.dispatchEvent(new FocusEvent('blur'));
    expect(app.getState().columns[1]?.name).toBe('Soon');
  });

  it('keeps the old name on Escape or when the field is left blank', () => {
    const { app } = setup();
    const title = () => column('todo').querySelector('.column-title')!;

    title().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let input = column('todo').querySelector<HTMLInputElement>('.column-rename')!;
    input.value = 'Discarded';
    press(input, 'Escape');
    expect(title().textContent).toBe('To Do');

    title().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    input = column('todo').querySelector<HTMLInputElement>('.column-rename')!;
    input.value = '   ';
    press(input, 'Enter');
    expect(title().textContent).toBe('To Do');
    expect(app.getState().columns[1]?.name).toBe('To Do');
  });

  it('deletes an empty column with its trash button', () => {
    const { app, storage } = setup();
    column('progress').querySelector<HTMLButtonElement>('.column-delete')!.click();
    expect(column('progress')).toBeNull();
    expect(app.getState().columns.map((c) => c.id)).toEqual(['backlog', 'todo', 'done']);
    expect(saved(storage).columns).toHaveLength(3);
  });

  it('does not delete a column that still holds cards', () => {
    const { app } = setup();
    const button = column('backlog').querySelector<HTMLButtonElement>('.column-delete')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    expect(column('backlog')).not.toBeNull();
    expect(app.getState().columns).toHaveLength(4);
  });

  it('shows how many cards each column holds', () => {
    setup();
    expect(column('backlog').querySelector('.column-count')?.textContent).toBe('2');
    expect(column('progress').querySelector('.column-count')?.textContent).toBe('0');
  });
});

/* ---------- Filtering & search -------------------------------------------- */

describe('filtering', () => {
  const search = () => document.querySelector<HTMLInputElement>('.search-input')!;
  const priority = () => document.querySelector<HTMLSelectElement>('.priority-filter')!;

  it('filters by title as the user types, ignoring case', () => {
    setup();
    type(search(), 'ALPHA');
    expect(visibleCardIds()).toEqual(['a']);
    type(search(), 'ta'); // "Alpha task", "Beta task", "Delta done"
    expect(visibleCardIds()).toEqual(['a', 'b', 'd']);
    type(search(), '');
    expect(visibleCardIds()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('offers All / Low / Medium / High in the priority filter', () => {
    setup();
    expect([...priority().options].map((option) => option.value)).toEqual([
      'all',
      'low',
      'medium',
      'high',
    ]);
  });

  it('hides cards of other priorities without leaving placeholders', () => {
    setup();
    type(priority(), 'low');
    expect(visibleCardIds()).toEqual(['a', 'd']);
    // Hidden cards are not in the DOM at all, so they cannot leave a gap.
    expect(column('backlog').querySelector('.card-list')!.children).toHaveLength(1);

    type(priority(), 'all');
    expect(visibleCardIds()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('combines the search and the priority filter', () => {
    setup();
    type(search(), 'task');
    type(priority(), 'high');
    expect(visibleCardIds()).toEqual(['b']);
  });

  it('does not change the saved board or the statistics', () => {
    const { storage } = setup();
    type(search(), 'alpha');
    expect(saved(storage)).toEqual(fixtureBoard());
    expect(stat('total')).toBe('4');
  });

  it('shows visible / total counts while a filter is active', () => {
    setup();
    type(priority(), 'high');
    expect(column('backlog').querySelector('.column-count')?.textContent).toBe('1 / 2');
  });
});

/* ---------- Statistics bar ------------------------------------------------- */

describe('statistics bar', () => {
  it('shows total, overdue, done and completion rate', () => {
    setup();
    expect(stat('total')).toBe('4');
    expect(stat('overdue')).toBe('1');
    expect(stat('done')).toBe('1');
    expect(stat('completion')).toBe('25%');
  });

  it('updates live when cards are added, moved and deleted', () => {
    vi.useFakeTimers();
    setup();

    openForm('progress');
    type(field('progress', 'title'), 'Late one');
    type(field('progress', 'dueDate'), '2026-01-01');
    submitForm('progress');
    expect(stat('total')).toBe('5');
    expect(stat('overdue')).toBe('2');
    expect(stat('completion')).toBe('20%');

    dragAndDrop('a', 'done', 999);
    vi.runOnlyPendingTimers();
    expect(stat('done')).toBe('2');
    expect(stat('completion')).toBe('40%');

    card('b').querySelector<HTMLButtonElement>('.card-delete')!.click();
    vi.advanceTimersByTime(REMOVE_ANIMATION_MS);
    expect(stat('total')).toBe('4');
    expect(stat('overdue')).toBe('1');
    expect(stat('completion')).toBe('50%');
  });

  it('shows 0% on an empty board', () => {
    setup({ columns: [] });
    expect(stat('total')).toBe('0');
    expect(stat('completion')).toBe('0%');
  });
});

/* ---------- Drag & Drop ---------------------------------------------------- */

describe('drag and drop', () => {
  it('makes every card draggable', () => {
    setup();
    for (const el of document.querySelectorAll('.card')) {
      expect(el.getAttribute('draggable')).toBe('true');
    }
  });

  it('moves a card to another column and saves the new order', () => {
    const { app, storage } = setup();
    dragAndDrop('a', 'todo', 999); // below every card → end of the column
    expect(visibleCardIds('backlog')).toEqual(['b']);
    expect(visibleCardIds('todo')).toEqual(['c', 'a']);
    expect(cardIds(saved(storage), 'todo')).toEqual(['c', 'a']);
    expect(saved(storage)).toEqual(app.getState());
  });

  it('inserts the card at the pointer position in the target column', () => {
    setup();
    dragAndDrop('a', 'todo', 10); // above the middle of the first card
    expect(visibleCardIds('todo')).toEqual(['a', 'c']);
  });

  it('drops into an empty column', () => {
    setup();
    dragAndDrop('c', 'progress', 30);
    expect(visibleCardIds('progress')).toEqual(['c']);
    expect(visibleCardIds('todo')).toEqual([]);
  });

  it('reorders cards inside the same column', () => {
    const { storage } = setup();
    dragAndDrop('a', 'backlog', 999); // first card to the bottom
    expect(visibleCardIds('backlog')).toEqual(['b', 'a']);
    expect(cardIds(saved(storage), 'backlog')).toEqual(['b', 'a']);

    dragAndDrop('a', 'backlog', 10); // and back to the top
    expect(visibleCardIds('backlog')).toEqual(['a', 'b']);
  });

  it('highlights the target column and shows where the card will land', () => {
    setup();
    layoutCards();
    fireDrag(card('a'), 'dragstart');

    const todoList = column('todo').querySelector('.card-list')!;
    const over = fireDrag(todoList, 'dragover', 10);
    expect(over.defaultPrevented).toBe(true); // accepted as a drop target
    expect(column('todo').classList.contains('drag-over')).toBe(true);
    expect(todoList.firstElementChild?.classList.contains('drop-indicator')).toBe(true);

    fireDrag(todoList, 'dragover', 999); // pointer below the last card
    expect(todoList.lastElementChild?.classList.contains('drop-indicator')).toBe(true);

    // Moving on to another column moves the highlight with it.
    fireDrag(column('progress'), 'dragover', 10);
    expect(column('todo').classList.contains('drag-over')).toBe(false);
    expect(column('progress').classList.contains('drag-over')).toBe(true);
    expect(document.querySelectorAll('.drop-indicator')).toHaveLength(1);
  });

  it('dims the dragged card while it is in the air', () => {
    vi.useFakeTimers();
    setup();
    fireDrag(card('a'), 'dragstart');
    vi.runOnlyPendingTimers();
    expect(card('a').classList.contains('dragging')).toBe(true);
    expect(document.querySelector('.board')!.classList.contains('is-dragging')).toBe(true);
  });

  it('clears every indicator when the drag is cancelled', () => {
    vi.useFakeTimers();
    const { app } = setup();
    layoutCards();
    fireDrag(card('a'), 'dragstart');
    vi.runOnlyPendingTimers();
    fireDrag(column('todo').querySelector('.card-list')!, 'dragover', 10);
    fireDrag(card('a'), 'dragend');

    expect(document.querySelector('.drop-indicator')).toBeNull();
    expect(document.querySelector('.drag-over')).toBeNull();
    expect(document.querySelector('.dragging')).toBeNull();
    expect(document.querySelector('.is-dragging')).toBeNull();
    expect(app.getState()).toEqual(fixtureBoard());
  });

  it('clears indicators after a drop', () => {
    setup();
    dragAndDrop('a', 'todo', 10);
    expect(document.querySelector('.drop-indicator')).toBeNull();
    expect(document.querySelector('.drag-over')).toBeNull();
  });

  it('does not accept drags that did not start on a card', () => {
    const { app } = setup();
    const list = column('todo').querySelector('.card-list')!;
    const over = fireDrag(list, 'dragover', 10);
    expect(over.defaultPrevented).toBe(false);
    fireDrag(list, 'drop', 10);
    expect(app.getState()).toEqual(fixtureBoard());
  });

  it('gives cards the Done look as soon as they land in the Done column', () => {
    setup();
    expect(card('a').closest('.column')!.classList.contains('is-done')).toBe(false);
    dragAndDrop('a', 'done', 999);
    expect(card('a').closest('.column')!.classList.contains('is-done')).toBe(true);

    // …and they lose it again when moved back out.
    dragAndDrop('a', 'todo', 999);
    expect(card('a').closest('.column')!.classList.contains('is-done')).toBe(false);
  });

  it('drops relative to the visible cards when a filter is active', () => {
    const { app } = setup();
    type(document.querySelector<HTMLSelectElement>('.priority-filter')!, 'low');
    dragAndDrop('d', 'backlog', 10); // before "a", the only visible backlog card
    expect(cardIds(app.getState(), 'backlog')).toEqual(['d', 'a', 'b']);
  });
});

/* ---------- Theme ----------------------------------------------------------- */

describe('theme', () => {
  const toggle = () => document.querySelector<HTMLButtonElement>('.theme-toggle')!;

  it('starts in dark mode', () => {
    setup();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('switches between dark and light and remembers the choice', () => {
    const { storage } = setup();
    toggle().click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(toggle().getAttribute('aria-label')).toBe('Switch to dark theme');

    toggle().click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('restores the saved theme on load', () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, 'light');
    setup(fixtureBoard(), storage);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('does not touch the board when toggled', () => {
    const { app } = setup();
    toggle().click();
    expect(app.getState()).toEqual(fixtureBoard());
  });
});
