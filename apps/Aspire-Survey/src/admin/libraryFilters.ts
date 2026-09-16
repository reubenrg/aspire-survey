/**
 * Pure client-side filtering for the Question Library and Templates screens
 * (Part 3), factored out of libraryStore.ts/Templates.tsx so the actual
 * matching logic can be unit tested without a Supabase connection.
 */
import type { Question } from '../engine/types';

export interface FilterableLibraryRow {
  definition: Question;
  category: string | null;
  tags: string[];
  language: string;
}

export interface LibrarySearchFilters {
  search?: string;
  type?: string;
}

export function matchesLibrarySearch<T extends FilterableLibraryRow>(row: T, filters: LibrarySearchFilters): boolean {
  if (filters.type && row.definition.type !== filters.type) return false;
  if (filters.search?.trim()) {
    const term = filters.search.trim().toLowerCase();
    const hit =
      row.definition.label.toLowerCase().includes(term) ||
      row.tags.some(t => t.toLowerCase().includes(term)) ||
      (row.category ?? '').toLowerCase().includes(term);
    if (!hit) return false;
  }
  return true;
}

export interface FilterableTemplate {
  name: string;
  category: string | null;
}

export function matchesTemplateSearch<T extends FilterableTemplate>(row: T, filters: { search?: string; category?: string }): boolean {
  if (filters.category && row.category !== filters.category) return false;
  if (filters.search?.trim() && !row.name.toLowerCase().includes(filters.search.trim().toLowerCase())) return false;
  return true;
}
