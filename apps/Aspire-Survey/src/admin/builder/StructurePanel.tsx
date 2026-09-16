import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import type { QuestionType, SurveyDefinition } from '../../engine/types';
import { QUESTION_TYPES, QUESTION_TYPE_DESCRIPTIONS, QUESTION_TYPE_LABELS } from '../../engine/questionFactory';
import * as ops from '../builderOps';

export interface Selection {
  sectionIndex: number;
  questionId: string | null; // null = the section itself is selected
}

interface Props {
  def: SurveyDefinition;
  selection: Selection | null;
  readOnly: boolean;
  issueSubjects: Set<string>;
  onSelect: (s: Selection) => void;
  onChange: (def: SurveyDefinition) => void;
}

/**
 * The survey's table of contents: sections and the questions under each,
 * with every structural operation the spec asks for (add/rename/reorder/
 * delete/duplicate a section; add/duplicate/delete/reorder/move a question)
 * as a plain button. No drag-and-drop library is part of this project yet
 * (dnd-kit is not a dependency), so these keyboard-accessible buttons are
 * the whole mechanism, not a fallback bolted onto one.
 */
export default function StructurePanel({ def, selection, readOnly, issueSubjects, onSelect, onChange }: Props) {
  const addSection = () => {
    onChange(ops.addSection(def));
    onSelect({ sectionIndex: def.sections.length, questionId: null });
  };

  const renameSection = (i: number, title: string) => onChange(ops.renameSection(def, i, title));

  const moveSection = (i: number, delta: number) => {
    onChange(ops.moveSection(def, i, delta));
    if (selection?.sectionIndex === i) onSelect({ ...selection, sectionIndex: i + delta });
  };

  const duplicateSection = (i: number) => onChange(ops.duplicateSection(def, i));

  const deleteSection = (i: number) => {
    if (def.sections[i]?.questions.length > 0) return; // guarded by disabling the button; belt and braces
    onChange(ops.deleteSection(def, i));
    if (selection?.sectionIndex === i) onSelect({ sectionIndex: 0, questionId: null });
  };

  const moveQuestion = (sectionIndex: number, qIndex: number, delta: number) =>
    onChange(ops.moveQuestion(def, sectionIndex, qIndex, delta));

  const moveToSection = (fromSection: number, qIndex: number, toSection: number) => {
    const question = def.sections[fromSection]?.questions[qIndex];
    if (!question) return;
    onChange(ops.moveQuestionToSection(def, fromSection, qIndex, toSection));
    onSelect({ sectionIndex: toSection, questionId: question.id });
  };

  const addQuestion = (sectionIndex: number, type: QuestionType) => {
    const before = new Set(def.sections[sectionIndex].questions.map(q => q.id));
    const next = ops.addQuestion(def, sectionIndex, type);
    const added = next.sections[sectionIndex].questions.find(q => !before.has(q.id));
    onChange(next);
    if (added) onSelect({ sectionIndex, questionId: added.id });
  };

  const duplicateQuestion = (sectionIndex: number, qIndex: number) => {
    const before = new Set(def.sections[sectionIndex].questions.map(q => q.id));
    const next = ops.duplicateQuestion(def, sectionIndex, qIndex);
    const added = next.sections[sectionIndex].questions.find(q => !before.has(q.id));
    onChange(next);
    if (added) onSelect({ sectionIndex, questionId: added.id });
  };

  const deleteQuestion = (sectionIndex: number, qIndex: number) => {
    const removedId = def.sections[sectionIndex]?.questions[qIndex]?.id;
    onChange(ops.deleteQuestion(def, sectionIndex, qIndex));
    if (selection?.sectionIndex === sectionIndex && selection.questionId === removedId) {
      onSelect({ sectionIndex, questionId: null });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-2.5">
        <p className="truncate text-sm font-medium text-foreground">{def.title || 'Untitled survey'}</p>
        <p className="text-[11px] text-muted-foreground">{def.sections.length} section{def.sections.length === 1 ? '' : 's'}</p>
      </div>

      <div className="flex-1 space-y-1 p-2">
        {def.sections.map((section, i) => (
          <div key={section.id} className="rounded-md">
            <div
              className={cn(
                'group flex items-start gap-1.5 rounded-md px-2 py-1.5',
                selection?.sectionIndex === i && selection.questionId === null ? 'bg-primary/10' : 'hover:bg-muted/60',
                issueSubjects.has(section.id) && 'ring-1 ring-destructive/40',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect({ sectionIndex: i, questionId: null })}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium text-foreground">
                  {i + 1}. {section.title || 'Untitled section'}
                </span>
              </button>
              {!readOnly && (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <IconBtn label="Move section up" disabled={i === 0} onClick={() => moveSection(i, -1)}>↑</IconBtn>
                  <IconBtn label="Move section down" disabled={i === def.sections.length - 1} onClick={() => moveSection(i, 1)}>↓</IconBtn>
                  <IconBtn label="Duplicate section" onClick={() => duplicateSection(i)}>⧉</IconBtn>
                  <IconBtn
                    label={section.questions.length > 0 ? 'Move or delete its questions first' : 'Delete empty section'}
                    disabled={section.questions.length > 0}
                    onClick={() => deleteSection(i)}
                  >
                    ✕
                  </IconBtn>
                </div>
              )}
            </div>

            {selection?.sectionIndex === i && selection.questionId === null && !readOnly && (
              <div className="ml-6 mt-1 mb-1">
                <input
                  value={section.title}
                  onChange={e => renameSection(i, e.target.value)}
                  placeholder="Section title"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/60"
                />
              </div>
            )}

            <ul className="ml-3 space-y-0.5 border-l border-border/70 pl-2">
              {section.questions.map((q, qi) => (
                <li
                  key={q.id}
                  className={cn(
                    'group rounded px-1.5 py-1',
                    selection?.sectionIndex === i && selection.questionId === q.id ? 'bg-primary/10' : 'hover:bg-muted/60',
                    issueSubjects.has(q.id) && 'ring-1 ring-destructive/40',
                  )}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSelect({ sectionIndex: i, questionId: q.id })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-xs text-foreground">
                        Q{qi + 1} {q.label || <em className="text-muted-foreground">Untitled</em>}
                      </span>
                    </button>
                    {!readOnly && (
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <IconBtn label="Move up" disabled={qi === 0} onClick={() => moveQuestion(i, qi, -1)}>↑</IconBtn>
                        <IconBtn label="Move down" disabled={qi === section.questions.length - 1} onClick={() => moveQuestion(i, qi, 1)}>↓</IconBtn>
                        <IconBtn label="Duplicate" onClick={() => duplicateQuestion(i, qi)}>⧉</IconBtn>
                        <IconBtn label="Delete" onClick={() => deleteQuestion(i, qi)}>✕</IconBtn>
                      </div>
                    )}
                  </div>
                  {!readOnly && selection?.sectionIndex === i && selection.questionId === q.id && def.sections.length > 1 && (
                    <div className="mt-1 flex items-center gap-1.5 pl-0.5">
                      <span className="text-[10px] text-muted-foreground">Move to</span>
                      <select
                        value={i}
                        onChange={e => moveToSection(i, qi, Number(e.target.value))}
                        className="rounded border border-border bg-background px-1 py-0.5 text-[10px] outline-none focus:border-primary/60"
                      >
                        {def.sections.map((s, n) => <option key={s.id} value={n}>{s.title || `Section ${n + 1}`}</option>)}
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {!readOnly && (
              <div className="ml-3 mt-1 pl-2">
                <AddQuestionMenu onPick={type => addQuestion(i, type)} />
              </div>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="border-t border-border p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={addSection}>+ Add section</Button>
        </div>
      )}
    </div>
  );
}

/**
 * The question type picker (Sprint 3 Part 6). Only the six types the engine
 * can actually render and submit end-to-end appear here - see
 * engine/questionFactory.ts, which is the single list every picker reads from.
 */
function AddQuestionMenu({ onPick }: { onPick: (type: QuestionType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setOpen(o => !o)}>
        + Add question
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-md border border-border bg-background py-1 shadow-lg">
          {QUESTION_TYPES.map(type => (
            <button
              key={type} type="button" role="menuitem"
              onClick={() => { setOpen(false); onPick(type); }}
              className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <span className="block text-xs font-medium text-foreground">{QUESTION_TYPE_LABELS[type]}</span>
              <span className="block text-[10px] text-muted-foreground">{QUESTION_TYPE_DESCRIPTIONS[type]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, label, disabled, onClick }: { children: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button" aria-label={label} title={label} disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className="grid h-5 w-5 place-items-center rounded text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
    >
      {children}
    </button>
  );
}
