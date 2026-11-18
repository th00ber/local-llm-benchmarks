/* ==========================================================================
   Types — shared data shapes for the board
   ========================================================================== */

export type Priority = 'low' | 'medium' | 'high';

export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export interface Card {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  /** Local calendar date as `YYYY-MM-DD`, or null when the card has no due date. */
  dueDate: string | null;
}

export interface Column {
  id: string;
  name: string;
  /** Marks the column whose cards count as completed (the default `Done` column). */
  isDone: boolean;
  /** Cards in display order, top to bottom. */
  cards: Card[];
}

export interface BoardState {
  /** Columns in display order, left to right. */
  columns: Column[];
}

/** What the "add card" form collects. */
export interface CardDraft {
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
}

export type PriorityFilter = Priority | 'all';

export interface Filters {
  search: string;
  priority: PriorityFilter;
}

export interface Stats {
  total: number;
  overdue: number;
  done: number;
  /** Whole-number percentage, 0–100. */
  completionRate: number;
}

export type Theme = 'dark' | 'light';
