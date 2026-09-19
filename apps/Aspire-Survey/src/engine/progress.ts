/**
 * Save-and-continue for respondents, plus hidden-field capture from the link.
 *
 * Progress lives ONLY in the respondent's own browser (localStorage): nothing is
 * sent to the server until they submit, so it works for anonymous surveys without
 * weakening their promise, and there is no half-finished response to leak. The
 * cost is that it is per device - someone who starts on a phone cannot finish on
 * a laptop.
 */
import type { Answers, SurveyDefinition } from './types.ts';
import { HIDDEN_FIELD_MAX } from './definition.ts';

const PREFIX = 'aspire-progress:';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SavedProgress {
  answers: Answers;
  /** Index of the page the respondent was on. */
  index: number;
  /** Pages already visited, so Back retraces their route. */
  history: number[];
  savedAt: number;
}

function store(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadProgress(key: string, now = Date.now()): SavedProgress | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedProgress;
    if (!p || typeof p.index !== 'number' || typeof p.savedAt !== 'number' || typeof p.answers !== 'object') return null;
    if (now - p.savedAt > MAX_AGE_MS) { s.removeItem(PREFIX + key); return null; }
    return p;
  } catch { return null; }
}

export function saveProgress(key: string, p: Omit<SavedProgress, 'savedAt'>, now = Date.now()): void {
  const s = store();
  if (!s) return;
  try { s.setItem(PREFIX + key, JSON.stringify({ ...p, savedAt: now })); } catch { /* storage full or blocked: progress just is not saved */ }
}

export function clearProgress(key: string): void {
  try { store()?.removeItem(PREFIX + key); } catch { /* nothing to clear */ }
}

/** Reads the survey's hidden fields out of a URL query string. Unknown parameters are ignored. */
export function hiddenFromSearch(def: SurveyDefinition, search: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!def.hiddenFields?.length) return out;
  let params: URLSearchParams;
  try { params = new URLSearchParams(search); } catch { return out; }
  for (const id of def.hiddenFields) {
    const v = params.get(id);
    if (v !== null && v.trim() !== '') out[id] = v.trim().slice(0, HIDDEN_FIELD_MAX);
  }
  return out;
}

/** Whether a saved position still makes sense for this definition (it may have been edited since). */
export function progressFits(p: SavedProgress, def: SurveyDefinition): boolean {
  return p.index >= 0 && p.index < def.sections.length && p.history.every(i => i >= 0 && i < def.sections.length);
}
