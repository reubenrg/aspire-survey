/**
 * Pure structural operations on a SurveyDefinition: every section/question
 * add, remove, reorder and move StructurePanel.tsx offers. Factored out so
 * they can be unit tested directly, without rendering the Builder - this is
 * the actual logic the UI calls, not a parallel reimplementation of it.
 */
import type { Question, QuestionType, Section, SurveyDefinition } from '../engine/types.ts';
import { newQuestion } from '../engine/questionFactory.ts';
import { newSectionId } from './builderValidation.ts';

export function addSection(def: SurveyDefinition): SurveyDefinition {
  const id = newSectionId(def.sections);
  return { ...def, sections: [...def.sections, { id, title: `Section ${def.sections.length + 1}`, questions: [] }] };
}

export function renameSection(def: SurveyDefinition, index: number, title: string): SurveyDefinition {
  return { ...def, sections: def.sections.map((s, n) => (n === index ? { ...s, title } : s)) };
}

/** delta is -1 or +1; out-of-range moves are a no-op rather than throwing. */
export function moveSection(def: SurveyDefinition, index: number, delta: number): SurveyDefinition {
  const target = index + delta;
  if (target < 0 || target >= def.sections.length) return def;
  const next = [...def.sections];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return { ...def, sections: next };
}

export function duplicateSection(def: SurveyDefinition, index: number): SurveyDefinition {
  const src = def.sections[index];
  const id = newSectionId(def.sections);
  const copy: Section = {
    ...src, id, title: `${src.title} (copy)`,
    // Fresh ids for every duplicated question, and conditions are dropped: a
    // condition pointing at a question in the original section would
    // otherwise point at nothing once the copy stands on its own.
    questions: src.questions.map((q, n) => ({ ...q, id: `${id}_q${n + 1}`, showIf: undefined })),
  };
  const next = [...def.sections];
  next.splice(index + 1, 0, copy);
  return { ...def, sections: next };
}

/** Only an empty section may be deleted; a non-empty index is a no-op. */
export function deleteSection(def: SurveyDefinition, index: number): SurveyDefinition {
  if (def.sections[index]?.questions.length > 0) return def;
  return { ...def, sections: def.sections.filter((_, n) => n !== index) };
}

export function addQuestion(def: SurveyDefinition, sectionIndex: number, type: QuestionType): SurveyDefinition {
  const section = def.sections[sectionIndex];
  const q = newQuestion(section, type);
  return { ...def, sections: def.sections.map((s, n) => (n === sectionIndex ? { ...s, questions: [...s.questions, q] } : s)) };
}

export function moveQuestion(def: SurveyDefinition, sectionIndex: number, qIndex: number, delta: number): SurveyDefinition {
  const section = def.sections[sectionIndex];
  const target = qIndex + delta;
  if (!section || target < 0 || target >= section.questions.length) return def;
  const next = [...section.questions];
  const [item] = next.splice(qIndex, 1);
  next.splice(target, 0, item);
  return { ...def, sections: def.sections.map((s, n) => (n === sectionIndex ? { ...s, questions: next } : s)) };
}

export function moveQuestionToSection(
  def: SurveyDefinition, fromSection: number, qIndex: number, toSection: number,
): SurveyDefinition {
  if (fromSection === toSection) return def;
  const question = def.sections[fromSection]?.questions[qIndex];
  if (!question) return def;
  const cleared: Question = { ...question, showIf: undefined };
  return {
    ...def,
    sections: def.sections.map((s, n) => {
      if (n === fromSection) return { ...s, questions: s.questions.filter((_, i) => i !== qIndex) };
      if (n === toSection) return { ...s, questions: [...s.questions, cleared] };
      return s;
    }),
  };
}

export function duplicateQuestion(def: SurveyDefinition, sectionIndex: number, qIndex: number): SurveyDefinition {
  const section = def.sections[sectionIndex];
  const src = section.questions[qIndex];
  const id = `${section.id}_q${section.questions.length + 1}_copy`;
  const copy: Question = { ...src, id, showIf: undefined };
  const next = [...section.questions];
  next.splice(qIndex + 1, 0, copy);
  return { ...def, sections: def.sections.map((s, n) => (n === sectionIndex ? { ...s, questions: next } : s)) };
}

/** Also clears any condition elsewhere in the survey that pointed at the removed question. */
export function deleteQuestion(def: SurveyDefinition, sectionIndex: number, qIndex: number): SurveyDefinition {
  const section = def.sections[sectionIndex];
  const removedId = section.questions[qIndex].id;
  return {
    ...def,
    sections: def.sections.map((s, n) => {
      const questions = (n === sectionIndex ? s.questions.filter((_, i) => i !== qIndex) : s.questions)
        .map(q => (q.showIf?.questionId === removedId ? { ...q, showIf: undefined } : q));
      return { ...s, questions };
    }),
  };
}
