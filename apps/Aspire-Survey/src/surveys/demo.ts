import type { SurveyDefinition } from '../engine/types';

/**
 * A fixture that exercises every question type and both awkward behaviours the
 * existing survey relies on: a conditional follow-up, and a matrix whose rows
 * depend on an earlier answer. If the engine can render this, it can express
 * the live survey.
 *
 * Not a real survey. Stage 2 replaces this with definitions loaded from the
 * database.
 */
export const demoSurvey: SurveyDefinition = {
  slug: 'engine-demo',
  title: 'Engine Demo Survey',
  brand: 'Survey Engine',
  uniqueBy: 'employeeId',
  welcome: {
    heading: 'Engine Demo',
    body: [
      'This survey exists to prove the engine renders every question type from a definition alone.',
      'Nothing here is real. Answers are written to the demo table.',
    ],
    note: 'Every question below is generated from data, not from a hand-written component.',
  },
  thankYou: {
    heading: 'Thank You!',
    body: 'Your response has been recorded.',
  },
  sections: [
    {
      id: 'about',
      title: 'About You',
      intro: 'All fields are required.',
      questions: [
        { id: 'employeeId', type: 'text', label: 'Employee ID', placeholder: 'e.g. 1234', required: true },
        { id: 'employeeName', type: 'text', label: 'Employee Name', placeholder: 'Your full name', required: true },
        {
          id: 'role',
          type: 'select',
          label: 'Aspire Team / Role',
          placeholder: 'Select your role…',
          options: ['HR', 'Quality Analyst', 'Trainer'],
          required: true,
        },
      ],
    },
    {
      id: 'change',
      title: 'How Has the Way You Work Changed?',
      questions: [
        {
          id: 'change',
          type: 'matrix',
          label: 'Compared with six months ago, how has your ability changed in the following areas?',
          columnPrefix: 'q_change',
          rows: ['Planning and prioritising my work', 'Solving problems when they arise', 'Being consistent in how I work'],
          scale: ['Reduced', 'Slightly reduced', 'No meaningful change', 'Improved', 'Improved significantly'],
          required: true,
        },
      ],
    },
    {
      id: 'evidence',
      title: 'Real Evidence of Change',
      questions: [
        {
          id: 'oneThing',
          type: 'textarea',
          label: 'What is ONE thing you have started doing differently at work in the last six months?',
          required: true,
        },
        {
          id: 'factors',
          type: 'checkbox',
          label: 'Which factors helped most? (Select up to 3)',
          options: ['Formal training', 'Support from my manager', 'Practice and work experience', 'Personal effort', 'Other'],
          maxSelections: 3,
          otherColumn: 'q_factors_other',
          required: true,
        },
        {
          id: 'aspireContribution',
          type: 'radio',
          label: 'Did any habit, task or activity contribute to this change?',
          options: ['Yes, significantly', 'Yes, to some extent', 'No', 'Maybe / not sure'],
          required: true,
        },
        {
          // Only appears for the two affirmative answers, mirroring EvidenceStep.
          id: 'aspireDetail',
          type: 'textarea',
          label: 'Which habit/task/activity helped, and what did it change?',
          showIf: { questionId: 'aspireContribution', equals: ['Yes, significantly', 'Yes, to some extent'] },
        },
      ],
    },
    {
      id: 'roleSpecific',
      title: 'Role-Specific',
      questions: [
        {
          id: 'roleAnswers',
          type: 'matrix',
          label: 'Indicate how much you agree with each statement.',
          columnPrefix: 'q_role',
          scale: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
          rows: ['I consistently follow tasks through to closure.'],
          rowsByAnswer: {
            questionId: 'role',
            map: {
              HR: [
                'I identify patterns behind employee performance issues.',
                'I look for ways to improve recurring HR processes.',
              ],
              'Quality Analyst': [
                'I identify patterns behind repeated quality issues.',
                'My feedback helps others prevent similar issues.',
              ],
              Trainer: [
                'I adjust my training based on evidence of learner needs.',
                'I check whether learning is being applied after training.',
              ],
            },
          },
          titleByAnswer: {
            HR: 'Your HR Practice',
            'Quality Analyst': 'Your Quality Practice',
            Trainer: 'Your Training Practice',
          },
          required: true,
        },
      ],
    },
  ],
};
