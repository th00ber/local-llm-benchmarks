/* ==========================================================================
   App — builds the page shell and wires state, rendering, drag & drop,
   filters, theme and persistence together.
   ========================================================================== */

import { setupDragAndDrop } from './dragdrop';
import { loadBoardOrSeed, loadTheme, saveBoard, saveTheme } from './persistence';
import { h, renderBoard, renderStats } from './render';
import type { Actions, UiState } from './render';
import {
  addCard,
  addColumn,
  computeStats,
  createId,
  deleteCard,
  deleteColumn,
  emptyDraft,
  moveCard,
  renameColumn,
  toISODate,
} from './state';
import type { BoardState, PriorityFilter, Theme } from './types';

/** Duration of the card fade-out; keep in sync with `.card.removing` in styles.css. */
export const REMOVE_ANIMATION_MS = 220;

export interface AppOptions {
  /** Defaults to `window.localStorage`. */
  storage?: Storage;
  /** Clock used for "today"; injectable for tests. */
  now?: () => Date;
}

export interface App {
  getState(): BoardState;
}

export function mountApp(root: HTMLElement, options: AppOptions = {}): App {
  const storage = options.storage ?? window.localStorage;
  const now = options.now ?? (() => new Date());

  /* ---------- State ------------------------------------------------------ */

  let state: BoardState = loadBoardOrSeed(storage, now());
  let theme: Theme = loadTheme(storage);

  const ui: UiState = {
    filters: { search: '', priority: 'all' },
    formColumnId: null,
    formDraft: emptyDraft(),
    formError: false,
    editingColumnId: null,
    expanded: new Set(),
    pendingFocus: null,
  };

  /* ---------- Page shell ------------------------------------------------- */

  const searchInput = h('input', {
    type: 'search',
    class: 'field search-input',
    placeholder: 'Search cards by title',
    'aria-label': 'Search cards by title',
    autocomplete: 'off',
  });

  const priorityFilter = h(
    'select',
    { class: 'field priority-filter', 'aria-label': 'Filter by priority' },
    h('option', { value: 'all' }, 'All priorities'),
    h('option', { value: 'low' }, 'Low'),
    h('option', { value: 'medium' }, 'Medium'),
    h('option', { value: 'high' }, 'High'),
  );

  const themeToggle = h('button', { type: 'button', class: 'btn theme-toggle' });

  const board = h('main', { class: 'board', 'aria-label': 'Kanban board' });
  const statsBar = h('footer', { class: 'stats-bar', 'aria-label': 'Board statistics' });

  root.replaceChildren(
    h(
      'header',
      { class: 'app-header' },
      h('h1', { class: 'app-title' }, 'Kanban board'),
      h('div', { class: 'toolbar' }, searchInput, priorityFilter, themeToggle),
    ),
    board,
    statsBar,
  );

  /* ---------- Rendering & persistence ------------------------------------ */

  let rendering = false;
  let renderAgain = false;

  function render(): void {
    // Replacing the DOM can fire `blur` on a focused rename input, which asks
    // for another render mid-flight: queue it instead of nesting.
    if (rendering) {
      renderAgain = true;
      return;
    }
    rendering = true;
    try {
      const today = toISODate(now());
      renderBoard(board, { state, ui, actions, today });
      renderStats(statsBar, computeStats(state, today));
    } finally {
      rendering = false;
    }
    if (renderAgain) {
      renderAgain = false;
      render();
    }
  }

  /** Applies a state update: saves to localStorage and re-renders, but only if something changed. */
  function commit(next: BoardState): void {
    if (next === state) return;
    state = next;
    saveBoard(storage, state);
    render();
  }

  function closeForm(): void {
    ui.formColumnId = null;
    ui.formDraft = emptyDraft();
    ui.formError = false;
  }

  /* ---------- Actions (called by the rendered elements) ------------------ */

  const actions: Actions = {
    openForm(columnId) {
      closeForm();
      ui.formColumnId = columnId;
      ui.pendingFocus = 'form';
      render();
    },
    cancelForm() {
      closeForm();
      render();
    },
    updateDraft(patch) {
      ui.formDraft = { ...ui.formDraft, ...patch };
    },
    submitForm() {
      const columnId = ui.formColumnId;
      if (!columnId) return;
      if (!ui.formDraft.title.trim()) {
        ui.formError = true;
        ui.pendingFocus = 'form';
        render();
        return;
      }
      const next = addCard(state, columnId, ui.formDraft);
      closeForm();
      if (next === state) render();
      else commit(next);
    },
    deleteCard(cardId, element) {
      if (element.classList.contains('removing')) return;
      // Fade out and collapse first, then remove the card from the state.
      element.style.height = `${element.offsetHeight}px`;
      void element.offsetHeight; // flush styles so the collapse transition runs
      element.classList.add('removing');
      window.setTimeout(() => {
        ui.expanded.delete(cardId);
        commit(deleteCard(state, cardId));
      }, REMOVE_ANIMATION_MS);
    },
    setExpanded(cardId, open) {
      if (open) ui.expanded.add(cardId);
      else ui.expanded.delete(cardId);
    },
    addColumn() {
      // Create the column and go straight into renaming it.
      const id = createId();
      ui.editingColumnId = id;
      ui.pendingFocus = 'rename';
      commit(addColumn(state, 'New column', id));
      board.scrollTo?.({ left: board.scrollWidth, behavior: 'smooth' });
    },
    startRename(columnId) {
      ui.editingColumnId = columnId;
      ui.pendingFocus = 'rename';
      render();
    },
    commitRename(columnId, name) {
      ui.editingColumnId = null;
      const next = renameColumn(state, columnId, name);
      if (next === state) render();
      else commit(next);
    },
    cancelRename() {
      ui.editingColumnId = null;
      render();
    },
    deleteColumn(columnId) {
      if (ui.formColumnId === columnId) closeForm();
      commit(deleteColumn(state, columnId));
    },
  };

  /* ---------- Filtering & search ----------------------------------------- */

  searchInput.addEventListener('input', () => {
    ui.filters.search = searchInput.value;
    render();
  });

  priorityFilter.addEventListener('change', () => {
    ui.filters.priority = priorityFilter.value as PriorityFilter;
    render();
  });

  /* ---------- Theme ------------------------------------------------------ */

  function applyTheme(): void {
    document.documentElement.dataset.theme = theme;
    const target = theme === 'dark' ? 'light' : 'dark';
    themeToggle.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    themeToggle.setAttribute('aria-label', `Switch to ${target} theme`);
    themeToggle.title = `Switch to ${target} theme`;
  }

  themeToggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    saveTheme(storage, theme);
    applyTheme();
  });

  /* ---------- Drag & Drop ------------------------------------------------ */

  setupDragAndDrop(board, (cardId, toColumnId, beforeCardId) => {
    commit(moveCard(state, cardId, toColumnId, beforeCardId));
  });

  /* ---------- First paint ------------------------------------------------ */

  applyTheme();
  saveBoard(storage, state); // persists the example board on first visit
  render();

  return { getState: () => state };
}
