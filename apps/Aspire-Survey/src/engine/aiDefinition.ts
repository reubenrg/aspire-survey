/**
 * Turns the untrusted JSON an AI model returns into a survey definition the engine
 * can safely use. The model is only ever a drafting aid: whatever it returns is
 * rebuilt here from a whitelist (unknown types, unknown properties, file uploads,
 * logic it invented and anything malformed are dropped) and then goes through the
 * same structural validation as a hand-built survey before anyone can publish it.
 */
import type { Question, QuestionType, SurveyDefinition } from './types.ts';
import { defaultColumn } from './definition.ts';
import { QUESTION_TYPES } from './questionFactory.ts';

/** What a generated survey may contain. Uploads, signatures and other privacy-sensitive types are never drafted by AI. */
const ALLOWED = new Set<QuestionType>(QUESTION_TYPES.filter(t => !['file', 'signature', 'image', 'email', 'phone', 'fullname', 'multitext'].includes(t)));

const TEXT_PROPS = ['hint', 'placeholder', 'lowLabel', 'highLabel', 'yesLabel', 'noLabel', 'unit'] as const;
const NUM_PROPS = ['min', 'max', 'step', 'minLength', 'maxLength', 'minSelections', 'maxSelections', 'total'] as const;

const str = (v: unknown, max = 500): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined);
const strList = (v: unknown, max = 60): string[] => (Array.isArray(v) ? v.map(x => str(x, 200)).filter((x): x is string => !!x).slice(0, max) : []);
const snake = (s: string): string => defaultColumn(s) || 'q';

export interface Sanitized { definition: SurveyDefinition; dropped: string[] }

export function sanitizeGeneratedDefinition(raw: unknown): Sanitized | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'The AI did not return a survey.' };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.sections) || r.sections.length === 0) return { error: 'The AI returned a survey with no sections.' };

  const dropped: string[] = [];
  const usedQ = new Set<string>();
  const usedS = new Set<string>();
  const uniq = (base: string, used: Set<string>) => { let id = base; let n = 2; while (used.has(id)) id = `${base}_${n++}`; used.add(id); return id; };

  const sections = r.sections.slice(0, 12).map((rawSection, si) => {
    const s = (rawSection ?? {}) as Record<string, unknown>;
    const id = uniq(snake(str(s.id, 40) ?? `section_${si + 1}`), usedS);
    const questions: Question[] = [];
    for (const rawQ of Array.isArray(s.questions) ? s.questions.slice(0, 40) : []) {
      const q = (rawQ ?? {}) as Record<string, unknown>;
      const type = String(q.type) as QuestionType;
      const label = str(q.label, 500);
      if (!label) { dropped.push('A question without text'); continue; }
      if (!ALLOWED.has(type)) { dropped.push(`"${label}" (type "${String(q.type)}" is not drafted by AI)`); continue; }

      const qid = uniq(snake(str(q.id, 40) ?? `${id}_q${questions.length + 1}`), usedQ);
      const out: Record<string, unknown> = { id: qid, type, label };
      if (q.required === true && type !== 'heading') out.required = true;
      for (const p of TEXT_PROPS) { const v = str(q[p], 200); if (v) out[p] = v; }
      for (const p of NUM_PROPS) { if (typeof q[p] === 'number' && Number.isFinite(q[p])) out[p] = q[p]; }
      if (q.integer === true) out.integer = true;
      if (q.randomize === true) out.randomize = true;
      if (q.shape === 'star' || q.shape === 'number') out.shape = q.shape;

      if (type === 'radio' || type === 'select' || type === 'checkbox' || type === 'ranking') {
        const options = [...new Set(strList(q.options))];
        if (options.length < 2) { dropped.push(`"${label}" (needs at least two choices)`); usedQ.delete(qid); continue; }
        out.options = options;
      }
      if (type === 'matrix') {
        const rows = strList(q.rows); const scale = strList(q.scale, 10);
        if (rows.length === 0 || scale.length < 2) { dropped.push(`"${label}" (a matrix needs rows and a scale)`); usedQ.delete(qid); continue; }
        out.rows = rows; out.scale = scale; out.columnPrefix = snake(qid);
      }
      if (type === 'sum') {
        const rows = strList(q.rows);
        if (rows.length < 2) { dropped.push(`"${label}" (needs at least two items)`); usedQ.delete(qid); continue; }
        out.rows = rows; out.columnPrefix = snake(qid); out.total = typeof q.total === 'number' && q.total > 0 ? q.total : 100;
      }
      if (type === 'rating') out.max = typeof q.max === 'number' ? Math.min(10, Math.max(3, Math.round(q.max))) : 5;
      if (type === 'slider') { out.min = typeof q.min === 'number' ? q.min : 0; out.max = typeof q.max === 'number' && q.max > (out.min as number) ? q.max : 100; }
      questions.push(out as unknown as Question);
    }
    return { id, title: str(s.title, 120) ?? `Section ${si + 1}`, ...(str(s.intro, 600) ? { intro: str(s.intro, 600) } : {}), questions };
  }).filter(s => s.questions.length > 0);

  if (sections.length === 0) return { error: 'None of the questions the AI wrote could be used. Try describing the survey differently.' };

  const w = (r.welcome ?? {}) as Record<string, unknown>;
  const t = (r.thankYou ?? {}) as Record<string, unknown>;
  const title = str(r.title, 120) ?? 'Untitled survey';
  const definition: SurveyDefinition = {
    slug: snake(title).replace(/_/g, '-'),
    title,
    welcome: {
      heading: str(w.heading, 120) ?? title,
      body: strList(w.body, 6).length ? strList(w.body, 6) : ['Thank you for taking part.'],
      startLabel: 'Begin Survey',
    },
    thankYou: { heading: str(t.heading, 120) ?? 'Thank you', body: str(t.body, 400) ?? 'Your response has been recorded.' },
    sections,
  };
  return { definition, dropped };
}

/** Extracts the first top-level JSON object from model text, tolerating code fences and prose around it. */
export function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
