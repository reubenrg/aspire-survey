/**
 * Turns pasted plain text into questions, so a survey that already exists in a
 * document can be built in seconds instead of one question at a time.
 *
 * Format (one block per question, blocks separated by a blank line):
 *
 *   How likely are you to shop with us again? *      <- first line is the question; a trailing * makes it required
 *   Extremely likely                                 <- following lines are answer choices
 *   Neutral
 *   Not likely
 *   [other] Something else                           <- adds an "Other" choice that asks for details
 *   [na] Not applicable                              <- a "not applicable" choice (kept last)
 *
 *   Rate our service
 *   Product                                          <- with lines starting ">" the plain lines are ROWS
 *   Support                                             and the ">" lines are the SCALE: a matrix
 *   > Excellent
 *   > Average
 *   > Poor
 *
 * The type is inferred (Yes/No, 0-10 and 1-5 scales, "select all that apply", no
 * choices = text) and can be forced by ending the question with (dropdown),
 * (checkbox), (ranking), (long), (number), (date), (email), (phone), (nps),
 * (rating), (yesno) or (slider). A leading "1." or "Q1)" is ignored.
 */
import type { Question, QuestionType } from './types.ts';
import { defaultColumn } from './definition.ts';

export interface BulkResult {
  questions: Question[];
  /** Things worth a second look, e.g. a block that was read as text because it had one choice. */
  warnings: string[];
}

const FORCED: Record<string, QuestionType> = {
  dropdown: 'select', select: 'select', checkbox: 'checkbox', multiple: 'checkbox', ranking: 'ranking',
  long: 'textarea', text: 'text', number: 'number', date: 'date', email: 'email', nps: 'nps',
  rating: 'rating', yesno: 'yesno', slider: 'slider', radio: 'radio', single: 'radio',
};

const NUMBERING = /^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):\-]\s+/i;
const MULTI_HINT = /\b(select all|choose all|all that apply|tick all|check all|select multiple|choose multiple)\b/i;

function cleanLine(l: string): string {
  return l.replace(/\s+$/, '');
}

function isNumberRange(options: string[], from: number, to: number): boolean {
  if (options.length !== to - from + 1) return false;
  return options.every((o, i) => o.trim() === String(from + i));
}

export function parseBulkQuestions(
  text: string,
  opts: { sectionId: string; startIndex: number; existingIds?: Set<string> },
): BulkResult {
  const warnings: string[] = [];
  const questions: Question[] = [];
  const used = new Set(opts.existingIds ?? []);

  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(b => b.split('\n').map(cleanLine).filter(l => l.trim() !== '')).filter(b => b.length > 0);

  blocks.forEach((lines, blockIndex) => {
    let label = lines[0].replace(NUMBERING, '').trim();
    let required = false;
    if (/\*\s*$/.test(label)) { required = true; label = label.replace(/\*\s*$/, '').trim(); }
    if (/^\*\s*/.test(label)) { required = true; label = label.replace(/^\*\s*/, '').trim(); }

    let forced: QuestionType | undefined;
    const tag = label.match(/\s*\(([a-z]+)\)\s*$/i);
    if (tag && FORCED[tag[1].toLowerCase()]) {
      forced = FORCED[tag[1].toLowerCase()];
      label = label.slice(0, tag.index).trim();
    }
    if (label === '') { warnings.push(`Block ${blockIndex + 1} has no question text and was skipped.`); return; }

    const rows: string[] = [];
    const scale: string[] = [];
    const options: string[] = [];
    let other = false;
    let na: string | null = null;
    for (const raw of lines.slice(1)) {
      const line = raw.trim();
      if (line.startsWith('>')) { scale.push(line.replace(/^>\s*/, '')); continue; }
      const otherMatch = line.match(/^\[other\]\s*(.*)$/i);
      if (otherMatch) { other = true; continue; }
      const naMatch = line.match(/^\[na\]\s*(.*)$/i);
      if (naMatch) { na = naMatch[1].trim() || 'Not applicable'; continue; }
      options.push(line.replace(/^[-*•]\s+/, '').replace(/^\(?[a-z0-9]\)\s+/i, ''));
    }

    let id = `${opts.sectionId}_q${opts.startIndex + questions.length + 1}`;
    while (used.has(id)) id += '_b';
    used.add(id);
    const base = { id, label, required: required || undefined };

    // Matrix: rows plus an explicit scale.
    if (scale.length >= 2 && options.length >= 1) {
      questions.push({ ...base, type: 'matrix', rows: options, scale, columnPrefix: defaultColumn(id) });
      return;
    }
    if (scale.length > 0) warnings.push(`"${label}": a scale needs at least two ">" lines and one row, so it was read as plain choices.`);
    const choices = [...options, ...scale];
    if (na) choices.push(na);
    if (other) choices.push('Other');

    const withOptions = (type: 'radio' | 'checkbox' | 'select' | 'ranking'): Question => {
      if (choices.length < 2) warnings.push(`"${label}" needs at least two choices; two placeholders were added.`);
      const list = choices.length >= 2 ? choices : ['Option one', 'Option two'];
      const q = { ...base, type, options: list } as Question;
      if (other && (type === 'radio' || type === 'checkbox')) (q as { otherColumn?: string }).otherColumn = `${defaultColumn(id)}_other`;
      return q;
    };

    let type: QuestionType;
    if (forced) type = forced;
    else if (choices.length === 0) {
      type = /\b(email|e-mail)\b/i.test(label) ? 'email'
        : /\b(comments?|feedback|suggest\w*|explain|describe|why|reasons?|tell us|thoughts?)\b/i.test(label) ? 'textarea' : 'text';
    } else if (choices.length === 2 && choices.every(c => /^(yes|no)$/i.test(c)) && new Set(choices.map(c => c.toLowerCase())).size === 2) type = 'yesno';
    else if (isNumberRange(choices, 0, 10)) type = 'nps';
    else if ([3, 4, 5, 6, 7, 8, 9, 10].some(n => isNumberRange(choices, 1, n))) type = 'rating';
    else if (MULTI_HINT.test(label)) type = 'checkbox';
    else type = 'radio';

    switch (type) {
      case 'radio': case 'checkbox': case 'select': case 'ranking':
        questions.push(withOptions(type)); break;
      case 'rating':
        questions.push({ ...base, type, max: choices.length >= 3 && choices.length <= 10 ? choices.length : 5, shape: 'star' }); break;
      case 'nps':
        questions.push({ ...base, type, lowLabel: 'Not at all likely', highLabel: 'Extremely likely' }); break;
      case 'slider':
        questions.push({ ...base, type, min: 0, max: 100, step: 1 }); break;
      case 'matrix':
        questions.push({ ...base, type, rows: options.length ? options : ['First statement'], scale: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'], columnPrefix: defaultColumn(id) }); break;
      default:
        questions.push({ ...base, type } as Question);
    }
  });

  return { questions, warnings };
}
