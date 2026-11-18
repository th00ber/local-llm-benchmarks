/* ==========================================================================
   Drag & Drop — native HTML5 Drag and Drop API, no library.
   Listeners are delegated to the board so they survive re-renders.
   While dragging we only touch classes and one indicator element; the state
   changes once, on drop, through the `onMove` callback.
   ========================================================================== */

export type MoveHandler = (cardId: string, toColumnId: string, beforeCardId: string | null) => void;

/**
 * Finds the card the dragged one should be inserted before: the first card
 * whose vertical midpoint is below the pointer. Null means "at the end".
 */
export function getInsertBefore(
  list: HTMLElement,
  clientY: number,
  draggingId: string | null,
): HTMLElement | null {
  const cards = list.querySelectorAll<HTMLElement>('.card');
  for (const card of cards) {
    if (card.dataset.cardId === draggingId) continue;
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return card;
  }
  return null;
}

export function setupDragAndDrop(board: HTMLElement, onMove: MoveHandler): void {
  let draggingId: string | null = null;

  // A zero-height marker that draws the insertion line between two cards.
  const indicator = document.createElement('div');
  indicator.className = 'drop-indicator';
  indicator.setAttribute('aria-hidden', 'true');

  const clearHighlights = (): void => {
    indicator.remove();
    for (const column of board.querySelectorAll('.column.drag-over')) {
      column.classList.remove('drag-over');
    }
  };

  const endDrag = (): void => {
    clearHighlights();
    board.classList.remove('is-dragging');
    board.querySelector('.card.dragging')?.classList.remove('dragging');
    draggingId = null;
  };

  const columnUnder = (event: DragEvent): HTMLElement | null =>
    event.target instanceof Element ? event.target.closest<HTMLElement>('.column') : null;

  /* ---------- dragstart: remember the card, style the source ------------- */
  board.addEventListener('dragstart', (event) => {
    const card =
      event.target instanceof Element ? event.target.closest<HTMLElement>('.card') : null;
    const cardId = card?.dataset.cardId;
    if (!card || !cardId) return;

    draggingId = cardId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', cardId);
    }
    // Defer the styling so the browser snapshots the drag image at full opacity.
    setTimeout(() => {
      if (draggingId === cardId) {
        card.classList.add('dragging');
        board.classList.add('is-dragging');
      }
    }, 0);
  });

  /* ---------- dragover: highlight the column, show the insertion line ---- */
  board.addEventListener('dragover', (event) => {
    if (!draggingId) return;
    const column = columnUnder(event);
    const list = column?.querySelector<HTMLElement>('.card-list');
    if (!column || !list) {
      clearHighlights();
      return;
    }

    event.preventDefault(); // marks the column as a valid drop target
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    if (!column.classList.contains('drag-over')) {
      clearHighlights();
      column.classList.add('drag-over');
    }

    const before = getInsertBefore(list, event.clientY, draggingId);
    // Only move the indicator when its position actually changes.
    if (before) {
      if (indicator.nextElementSibling !== before) list.insertBefore(indicator, before);
    } else if (indicator.parentElement !== list || indicator.nextElementSibling !== null) {
      list.append(indicator);
    }
  });

  /* ---------- dragleave: pointer left the board entirely ----------------- */
  board.addEventListener('dragleave', (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !board.contains(next)) clearHighlights();
  });

  /* ---------- drop: commit the move --------------------------------------- */
  board.addEventListener('drop', (event) => {
    if (!draggingId) return;
    const column = columnUnder(event);
    const list = column?.querySelector<HTMLElement>('.card-list');
    const columnId = column?.dataset.columnId;
    const cardId = draggingId;
    if (!list || !columnId) {
      endDrag();
      return;
    }

    event.preventDefault();
    const before = getInsertBefore(list, event.clientY, cardId);
    // Clean up first: the re-render detaches the source card, so `dragend`
    // may never bubble up to the board.
    endDrag();
    onMove(cardId, columnId, before?.dataset.cardId ?? null);
  });

  /* ---------- dragend: drag cancelled or finished outside a column ------- */
  board.addEventListener('dragend', endDrag);
}
