/* ==========================================================================
   Rendering — turns state into DOM. The board is rebuilt from scratch on
   every change; transient UI state (open form, draft, expanded descriptions)
   lives in `UiState` so a rebuild never loses it.
   User text is always inserted as text nodes, never as HTML.
   ========================================================================== */

import { filtersActive, isOverdue, matchesFilters } from './state';
import { PRIORITIES, PRIORITY_LABELS } from './types';
import type { BoardState, Card, CardDraft, Column, Filters, Stats } from './types';

/* ---------- UI state & actions ------------------------------------------- */

export interface UiState {
  filters: Filters;
  /** Column whose "add card" form is open, if any. */
  formColumnId: string | null;
  formDraft: CardDraft;
  formError: boolean;
  /** Column whose title is being renamed, if any. */
  editingColumnId: string | null;
  /** Cards whose description is expanded. */
  expanded: Set<string>;
  /** Element to focus once the next render is done. */
  pendingFocus: 'form' | 'rename' | null;
}

export interface Actions {
  openForm(columnId: string): void;
  cancelForm(): void;
  updateDraft(patch: Partial<CardDraft>): void;
  submitForm(): void;
  deleteCard(cardId: string, element: HTMLElement): void;
  setExpanded(cardId: string, open: boolean): void;
  addColumn(): void;
  startRename(columnId: string): void;
  commitRename(columnId: string, name: string): void;
  cancelRename(): void;
  deleteColumn(columnId: string): void;
}

export interface RenderContext {
  state: BoardState;
  ui: UiState;
  actions: Actions;
  /** Today's local date as `YYYY-MM-DD`. */
  today: string;
}

/* ---------- DOM helpers -------------------------------------------------- */

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | false | undefined;

/** Tiny element factory: `h('button', { class: 'btn', type: 'button' }, 'Save')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

const ICONS = {
  trash:
    '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
} as const;

/** Static inline SVG icon (markup comes from the constant above, never from user input). */
export function icon(name: keyof typeof ICONS): HTMLElement {
  const wrapper = h('span', { class: 'icon', 'aria-hidden': 'true' });
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return wrapper;
}

/** `2026-03-09` → "Mar 9" (year added when it is not the current one). */
export function formatDueDate(dueDate: string, today: string): string {
  const [year = 1970, month = 1, day = 1] = dueDate.split('-').map(Number);
  const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(new Date(year, month - 1, day));
}

/* ---------- Board -------------------------------------------------------- */

export function renderBoard(board: HTMLElement, ctx: RenderContext): void {
  // Each column list scrolls on its own; keep those positions across rebuilds.
  const scrollTops = new Map<string, number>();
  for (const list of board.querySelectorAll<HTMLElement>('.card-list')) {
    const id = list.closest<HTMLElement>('.column')?.dataset.columnId;
    if (id) scrollTops.set(id, list.scrollTop);
  }

  const count = ctx.state.columns.length;
  const columns = ctx.state.columns.map((column, index) => renderColumn(column, index, count, ctx));

  const addColumn = h('button', { class: 'add-column-btn', type: 'button' }, '＋ Add Column');
  addColumn.addEventListener('click', () => ctx.actions.addColumn());

  board.replaceChildren(...columns, addColumn);

  for (const list of board.querySelectorAll<HTMLElement>('.card-list')) {
    const id = list.closest<HTMLElement>('.column')?.dataset.columnId;
    const top = id ? scrollTops.get(id) : undefined;
    if (top) list.scrollTop = top;
  }

  applyPendingFocus(board, ctx.ui);
}

function applyPendingFocus(board: HTMLElement, ui: UiState): void {
  const selector =
    ui.pendingFocus === 'form'
      ? '.card-form [name="title"]'
      : ui.pendingFocus === 'rename'
        ? '.column-rename'
        : null;
  ui.pendingFocus = null;
  if (!selector) return;
  const input = board.querySelector<HTMLInputElement>(selector);
  input?.focus();
  if (input?.classList.contains('column-rename')) input.select();
}

/* ---------- Columns ------------------------------------------------------ */

/**
 * Each column carries a "stage" hue that drifts from violet (start of the
 * workflow) to green (finished) so position in the flow is visible at a glance.
 */
function stageHue(column: Column, index: number, count: number): number {
  if (column.isDone) return 152;
  const progress = count > 1 ? index / (count - 1) : 0;
  return Math.round(255 - progress * 95);
}

function renderColumn(column: Column, index: number, count: number, ctx: RenderContext): HTMLElement {
  const { ui, actions } = ctx;
  const visibleCards = column.cards.filter((card) => matchesFilters(card, ui.filters));
  const filtering = filtersActive(ui.filters);

  const element = h('section', {
    class: `column${column.isDone ? ' is-done' : ''}`,
    'data-column-id': column.id,
    'aria-label': `${column.name} column`,
    style: `--stage-hue: ${stageHue(column, index, count)}`,
  });

  /* Header: title (double-click to rename), card count, delete button */
  const header = h('header', { class: 'column-header' });

  if (ui.editingColumnId === column.id) {
    header.append(renderRenameInput(column, actions));
  } else {
    const title = h(
      'h2',
      { class: 'column-title', tabindex: 0, title: 'Double-click to rename' },
      column.name,
    );
    title.addEventListener('dblclick', () => actions.startRename(column.id));
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();
        actions.startRename(column.id);
      }
    });
    header.append(title);
  }

  const countLabel = filtering
    ? `${visibleCards.length} / ${column.cards.length}`
    : String(column.cards.length);
  header.append(h('span', { class: 'column-count', title: 'Cards in this column' }, countLabel));

  const isEmpty = column.cards.length === 0;
  const deleteLabel = isEmpty
    ? `Delete column ${column.name}`
    : 'Only an empty column can be deleted';
  const deleteButton = h(
    'button',
    {
      class: 'icon-btn column-delete',
      type: 'button',
      title: deleteLabel,
      'aria-label': deleteLabel,
      'aria-disabled': isEmpty ? null : 'true',
    },
    icon('trash'),
  );
  deleteButton.addEventListener('click', () => {
    if (isEmpty) actions.deleteColumn(column.id);
  });
  header.append(deleteButton);

  /* Card list (also the drop zone) */
  const list = h('div', { class: 'card-list' });
  if (visibleCards.length === 0) {
    const hint = isEmpty ? 'Drop a card here, or add one below.' : 'No card matches the filters.';
    list.append(h('p', { class: 'empty-hint' }, hint));
  } else {
    list.append(...visibleCards.map((card) => renderCard(card, ctx)));
  }

  /* Footer: "add card" button or the inline form */
  const footer = h('footer', { class: 'column-footer' });
  if (ui.formColumnId === column.id) {
    footer.append(renderCardForm(ctx));
  } else {
    const addCard = h('button', { class: 'add-card-btn', type: 'button' }, '＋ Add card');
    addCard.addEventListener('click', () => actions.openForm(column.id));
    footer.append(addCard);
  }

  element.append(header, list, footer);
  return element;
}

function renderRenameInput(column: Column, actions: Actions): HTMLElement {
  const input = h('input', {
    class: 'column-rename',
    type: 'text',
    value: column.name,
    maxlength: 40,
    'aria-label': 'Column name',
  });
  // Enter / blur save, Escape cancels. `settled` stops blur from firing a second action.
  let settled = false;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      settled = true;
      actions.commitRename(column.id, input.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      actions.cancelRename();
    }
  });
  input.addEventListener('blur', () => {
    if (!settled) {
      settled = true;
      actions.commitRename(column.id, input.value);
    }
  });
  return input;
}

/* ---------- Cards -------------------------------------------------------- */

function renderCard(card: Card, ctx: RenderContext): HTMLElement {
  const { ui, actions, today } = ctx;

  const element = h('article', {
    class: 'card',
    draggable: 'true',
    'data-card-id': card.id,
    'data-priority': card.priority,
  });

  const deleteButton = h(
    'button',
    {
      class: 'icon-btn card-delete',
      type: 'button',
      title: 'Delete card',
      'aria-label': `Delete card ${card.title}`,
    },
    icon('close'),
  );
  deleteButton.addEventListener('click', () => actions.deleteCard(card.id, element));

  element.append(
    h('div', { class: 'card-top' }, h('h3', { class: 'card-title' }, card.title), deleteButton),
  );

  if (card.description) {
    const details = h(
      'details',
      { class: 'card-description', open: ui.expanded.has(card.id) },
      h('summary', {}, 'Description'),
      h('p', {}, card.description),
    );
    details.addEventListener('toggle', () => actions.setExpanded(card.id, details.open));
    element.append(details);
  }

  const meta = h(
    'div',
    { class: 'card-meta' },
    h('span', { class: `badge badge--${card.priority}` }, PRIORITY_LABELS[card.priority]),
  );
  if (card.dueDate) {
    const overdue = isOverdue(card, today);
    const label = formatDueDate(card.dueDate, today);
    meta.append(
      h(
        'time',
        {
          class: `due${overdue ? ' due--overdue' : ''}`,
          datetime: card.dueDate,
          title: overdue ? 'Overdue' : 'Due date',
        },
        overdue ? `⚠️ ${label}` : label,
      ),
    );
  }
  element.append(meta);

  return element;
}

/* ---------- Inline "add card" form --------------------------------------- */

function renderCardForm(ctx: RenderContext): HTMLElement {
  const { ui, actions } = ctx;
  const draft = ui.formDraft;

  const title = h('input', {
    type: 'text',
    name: 'title',
    class: 'field',
    placeholder: 'Card title',
    'aria-label': 'Card title',
    maxlength: 120,
    required: true,
    autocomplete: 'off',
    value: draft.title,
    'aria-invalid': ui.formError ? 'true' : null,
  });
  title.addEventListener('input', () => actions.updateDraft({ title: title.value }));

  const priority = h(
    'select',
    { name: 'priority', class: 'field' },
    ...PRIORITIES.map((value) =>
      h('option', { value, selected: value === draft.priority }, PRIORITY_LABELS[value]),
    ),
  );
  priority.addEventListener('change', () =>
    actions.updateDraft({ priority: priority.value as CardDraft['priority'] }),
  );

  const dueDate = h('input', {
    type: 'date',
    name: 'dueDate',
    class: 'field',
    value: draft.dueDate ?? '',
  });
  const syncDueDate = (): void => actions.updateDraft({ dueDate: dueDate.value || null });
  dueDate.addEventListener('input', syncDueDate);
  dueDate.addEventListener('change', syncDueDate);

  const description = h(
    'textarea',
    {
      name: 'description',
      class: 'field',
      rows: 2,
      placeholder: 'Description (optional)',
      'aria-label': 'Description (optional)',
    },
    draft.description,
  );
  description.addEventListener('input', () =>
    actions.updateDraft({ description: description.value }),
  );

  const cancel = h('button', { type: 'button', class: 'btn form-cancel' }, 'Cancel');
  cancel.addEventListener('click', () => actions.cancelForm());

  const form = h(
    'form',
    { class: 'card-form', novalidate: true },
    title,
    ui.formError &&
      h('p', { class: 'form-error', role: 'alert' }, 'Add a title to save the card.'),
    h(
      'div',
      { class: 'form-row' },
      h('label', { class: 'form-label' }, h('span', {}, 'Priority'), priority),
      h('label', { class: 'form-label' }, h('span', {}, 'Due date'), dueDate),
    ),
    description,
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'submit', class: 'btn btn--primary' }, 'Save'),
      cancel,
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.submitForm();
  });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      actions.cancelForm();
    }
  });
  return form;
}

/* ---------- Statistics bar ----------------------------------------------- */

export function renderStats(bar: HTMLElement, stats: Stats): void {
  const stat = (id: string, label: string, value: string, extraClass = ''): HTMLElement =>
    h(
      'div',
      { class: `stat ${extraClass}`.trim() },
      h('span', { class: 'stat-label' }, label),
      h('strong', { class: 'stat-value', 'data-stat': id }, value),
    );

  const meter = h(
    'span',
    { class: 'stat-meter', 'aria-hidden': 'true' },
    h('span', { class: 'stat-meter-fill', style: `width: ${stats.completionRate}%` }),
  );

  const completion = stat('completion', 'Completion rate', `${stats.completionRate}%`);
  completion.append(meter);

  bar.replaceChildren(
    stat('total', 'Total cards', String(stats.total)),
    stat('overdue', 'Overdue', String(stats.overdue), stats.overdue > 0 ? 'stat--alert' : ''),
    stat('done', 'Done', String(stats.done)),
    completion,
  );
}
