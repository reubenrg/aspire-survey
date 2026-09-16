import type { SurveyDefinition } from '../engine/types';

/**
 * Habit Formation Impact Survey - 2026, for the S2M Health customer in the
 * Admin Platform. ANONYMOUS mode: respondents self-identify with typed
 * Employee ID / Employee Name fields (Q1/Q2), the same pattern the original
 * hand-written S2M survey and engine-demo.ts both use, rather than the
 * employee-directory + magic-link system - nothing here reads or writes
 * `employees` or `survey_invitations`.
 *
 * Section 7 ("Program-Specific Questions") is one matrix question using
 * rowsByAnswer/titleByAnswer, switched on Q3's program choice, exactly the
 * mechanism engine-demo.ts already exercises for the same "each respondent
 * only sees their own module's statements" shape - not a second, parallel
 * way of doing conditional content.
 *
 * The engine has no 0-10 NPS-style question type; Q14 is expressed as a
 * single-choice (radio) from 11 labelled options, the closest honest fit
 * among the six types the engine actually renders and submits end-to-end.
 *
 * Only Q8 and Q9 were marked "Required" in the source brief; every other
 * question is left optional, matching that literally rather than assuming.
 */
export const habitFormationImpact2026: SurveyDefinition = {
  slug: 'habit-formation-impact-survey-2026',
  title: 'Habit Formation Impact Survey - 2026',
  brand: 'S2M Health × Aspire',
  uniqueBy: 'employeeId',

  welcome: {
    heading: 'Habit Formation Impact Survey - 2026',
    body: [
      'Since last six months, Aspire has been working with S2M Health employees through role-specific habit programs designed around actual workplace responsibilities.',
      'This short survey is intended to understand:',
      '• whether the Aspire habits are being applied in real work',
      '• whether the behaviour is becoming more consistent',
      '• what has changed because of the habit',
      '• what is helping or preventing stronger habit formation',
      'Please answer based on your actual work experience.',
      'Estimated time: 5–7 minutes',
    ],
  },

  thankYou: {
    heading: 'Thank You!',
    body: 'Your response has been recorded. Thank you for helping us understand how the Aspire habit programs are working in practice.',
  },

  sections: [
    {
      id: 'about_you',
      title: 'About You',
      questions: [
        { id: 'employeeId', type: 'text', label: 'Employee ID', required: true },
        { id: 'employeeName', type: 'text', label: 'Employee Name', required: true },
        {
          id: 'program',
          type: 'radio',
          label: 'Which Aspire program are you currently participating in?',
          required: true,
          options: [
            'Guideline-Anchored HCC Decision Making',
            'Coding Expert',
            'Regulatory-Anchored Audit Judgment',
            'Proactive Edge-Case Identification & Review',
            'Risk-Based Work Allocation & Quality Protection',
            'Decision Rule Creation & Clarification',
            'Issue Ownership & Explicit Handoffs',
            'Ownership Assignment & Responsibility Closure',
            'Task Status Visibility & Stakeholder Updates',
            'HR Follow-Up Discipline & Operational Credibility',
            'Guideline-Led Training Delivery',
            'Signal-First Reporting',
          ],
        },
      ],
    },

    {
      id: 'habit_becoming_part',
      title: 'Is the Habit Becoming Part of Your Work?',
      questions: [
        {
          id: 'habitStage',
          type: 'radio',
          label: 'Which statement best describes your current Aspire habit?',
          options: [
            'I mainly do it when reminded',
            'I understand the habit but do not practise it regularly',
            'I consciously practise it from time to time',
            'I regularly apply it during normal work',
            'It has become a natural part of how I work',
            'I now help or encourage others to practise the same behaviour',
          ],
        },
        {
          id: 'habitFrequency',
          type: 'radio',
          label: 'How often do you actually apply the behaviour from your Aspire program during normal work?',
          options: [
            'Rarely',
            'A few times a month',
            'Once or twice a week',
            'Several times a week',
            'Almost every working day',
            'The behaviour is now naturally part of my work',
          ],
        },
      ],
    },

    {
      id: 'what_changed',
      title: 'What Has Aspire Changed?',
      questions: [
        {
          id: 'habitChange',
          type: 'matrix',
          label: 'Thinking about your Aspire program, how much do you agree with the following?',
          columnPrefix: 'change',
          scale: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
          rows: [
            'The habit makes me think more carefully about how I handle my work',
            'I have applied something from the habit in a real work situation',
            'The habit has helped me change at least one way I work',
            'I am more consistent in the behaviour than when I started the program',
            'I am better able to recognise situations where this behaviour is needed',
            'The habit is relevant to the actual responsibilities of my role',
          ],
        },
        {
          id: 'personalImpact',
          type: 'checkbox',
          label: 'What impact have you personally noticed from practising your Aspire habit? (Select up to 3)',
          maxSelections: 3,
          otherColumn: 'personal_impact_other',
          options: [
            'Better quality / reliability of work',
            'Fewer repeated mistakes or issues',
            'Better problem solving',
            'Better decision making',
            'Better ownership / follow-through',
            'Better prioritisation',
            'Better communication',
            'Better knowledge sharing',
            'Better ability to support others',
            'Faster / clearer completion of work',
            'Better prevention of future problems',
            'Better consistency in how I work',
            'No noticeable impact yet',
            'Other',
          ],
        },
      ],
    },

    {
      id: 'real_evidence',
      title: 'Real Evidence of Change',
      questions: [
        {
          id: 'evidenceChange',
          type: 'textarea',
          label: 'What is ONE thing you do differently at work today because of the habit you have been practising through Aspire?',
          required: true,
        },
        {
          id: 'evidenceExample',
          type: 'textarea',
          label: 'Give one real example where this habit helped you handle a work situation better.',
          hint: 'This may include avoiding an error, solving a problem, making a better decision, completing work more clearly, improving a process, helping another employee or preventing an issue.',
          required: true,
        },
      ],
    },

    {
      id: 'manager_reinforcement',
      title: 'Manager Reinforcement',
      questions: [
        {
          id: 'managerFrequency',
          type: 'radio',
          label: 'How often does your manager / Team Lead discuss or reinforce the behaviour behind your Aspire habit?',
          options: ['Never', 'Rarely', 'Once a month', 'A few times a month', 'Weekly', 'Several times a week'],
        },
        {
          id: 'managerDiscussionType',
          type: 'radio',
          label: 'When your manager discusses Aspire, what usually happens?',
          options: [
            'I am mainly reminded to make an Aspire update',
            'The habit/task is explained again',
            'My manager connects the habit to my actual work',
            'My manager discusses examples from my work',
            'My manager gives feedback on whether I am applying the behaviour',
            'Aspire is not usually discussed',
          ],
        },
      ],
    },

    {
      id: 'barriers',
      title: 'What Is Preventing Stronger Habit Formation?',
      questions: [
        {
          id: 'biggestChallenge',
          type: 'radio',
          label: 'What is the biggest challenge preventing you from practising the Aspire behaviour more consistently?',
          otherColumn: 'biggest_challenge_other',
          options: [
            'High workload / work pressure',
            'I do not always remember the habit',
            'I practise the behaviour but forget to record it in Aspire',
            'The task/habit is not fully clear',
            'The habit sometimes feels repetitive',
            'I do not always see how it connects to my work',
            'I need more feedback',
            'I need more manager reinforcement',
            'I do not get enough opportunities to practise the behaviour',
            'App / technical issue',
            'No major difficulty',
            'Other',
          ],
        },
        {
          id: 'helpfulSupport',
          type: 'radio',
          label: 'What ONE thing would help you practise the behaviour better?',
          otherColumn: 'helpful_support_other',
          options: [
            'Better explanation of the habit',
            'More role-relevant examples',
            'More manager / Team Lead reinforcement',
            'More feedback on my Aspire updates',
            'Better connection with actual work situations',
            'More discussion with the team',
            'More advanced/challenging tasks',
            'Shorter or simpler tasks',
            'Better app experience',
            'No additional support needed',
            'Other',
          ],
        },
      ],
    },

    {
      id: 'program_specific',
      title: 'Program-Specific Questions',
      intro: 'Only the three statements for your own program are shown below.',
      questions: [
        {
          id: 'programSpecificAgreement',
          type: 'matrix',
          label: 'How much do you agree with the following statements about your program?',
          columnPrefix: 'program_stmt',
          scale: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
          rows: [
            'I now refer to the relevant guideline more consciously when making HCC coding decisions.',
            'I can better explain the reasoning behind my HCC decisions.',
            'I use learning from previous errors/audits to avoid repeating similar coding issues.',
          ],
          rowsByAnswer: {
            questionId: 'program',
            map: {
              'Guideline-Anchored HCC Decision Making': [
                'I now refer to the relevant guideline more consciously when making HCC coding decisions.',
                'I can better explain the reasoning behind my HCC decisions.',
                'I use learning from previous errors/audits to avoid repeating similar coding issues.',
              ],
              'Coding Expert': [
                'I actively strengthen my coding knowledge even when coding volume is low.',
                'I am better at identifying why a coding error happened.',
                'I am more confident explaining coding concepts to another person.',
              ],
              'Regulatory-Anchored Audit Judgment': [
                'I support my audit decisions with the relevant guideline or evidence.',
                'I am better at distinguishing important/high-risk defects from lower-impact issues.',
                'My audit feedback more clearly explains why a correction is required.',
              ],
              'Proactive Edge-Case Identification & Review': [
                'I identify uncertain or high-risk situations earlier than before.',
                'I look for patterns behind repeated escalations or coder uncertainty.',
                'I take preventive action before an issue becomes a QA error.',
              ],
              'Risk-Based Work Allocation & Quality Protection': [
                'I consider quality/risk signals before allocating or prioritising work.',
                'I adjust priorities when I identify a higher-risk account or situation.',
                'I take preventive action to protect quality when production pressure increases.',
              ],
              'Decision Rule Creation & Clarification': [
                'I convert repeated uncertainties or edge cases into clearer decision rules.',
                'I simplify complex scenarios so others can apply them consistently.',
                'I use feedback and repeated questions to improve existing rules/guidance.',
              ],
              'Issue Ownership & Explicit Handoffs': [
                'I clearly identify what I own and what needs to be handed over.',
                'I provide clear status, next action and ownership information during handoffs.',
                'I document troubleshooting and learning so that issues can progress without confusion.',
              ],
              'Ownership Assignment & Responsibility Closure': [
                'I clearly assign ownership for critical issues.',
                'I explain why an issue is assigned to a particular owner.',
                'I actively identify and close responsibility gaps before they delay resolution.',
              ],
              'Task Status Visibility & Stakeholder Updates': [
                'I maintain clear visibility of open tasks and their next actions.',
                'I update stakeholders before delays or blockers become surprises.',
                'I intentionally close tasks with clear status/closure information.',
              ],
              'HR Follow-Up Discipline & Operational Credibility': [
                'I maintain clear visibility of pending HR/compliance follow-ups.',
                'I follow up proactively instead of waiting for delays to occur.',
                'I plan the next action for pending work so that tasks move toward closure.',
              ],
              'Guideline-Led Training Delivery': [
                'I explain technical concepts in a simpler and more structured way.',
                'I use examples/scenarios to help learners understand difficult concepts.',
                'I check whether learners have understood before moving to the next topic.',
              ],
              'Signal-First Reporting': [
                'I validate important data before using or sharing it.',
                'I highlight the important signal or exception instead of only presenting numbers.',
                'I make reports clearer about what action or decision is required.',
              ],
            },
          },
          titleByAnswer: {
            'Guideline-Anchored HCC Decision Making': 'HCC Coders — Guideline-Anchored HCC Decision Making',
            'Coding Expert': 'Coders — Coding Expert',
            'Regulatory-Anchored Audit Judgment': 'Quality Analysts — Regulatory-Anchored Audit Judgment',
            'Proactive Edge-Case Identification & Review': 'Team Leads — Proactive Edge-Case Identification & Review',
            'Risk-Based Work Allocation & Quality Protection': 'Team Managers — Risk-Based Work Allocation & Quality Protection',
            'Decision Rule Creation & Clarification': 'SME / Process Coach — Decision Rule Creation & Clarification',
            'Issue Ownership & Explicit Handoffs': 'IT — Issue Ownership & Explicit Handoffs',
            'Ownership Assignment & Responsibility Closure': 'IT Manager — Ownership Assignment & Responsibility Closure',
            'Task Status Visibility & Stakeholder Updates': 'Admin — Task Status Visibility & Stakeholder Updates',
            'HR Follow-Up Discipline & Operational Credibility': 'HR — HR Follow-Up Discipline & Operational Credibility',
            'Guideline-Led Training Delivery': 'Trainers — Guideline-Led Training Delivery',
            'Signal-First Reporting': 'MIS — Signal-First Reporting',
          },
        },
      ],
    },

    {
      id: 'final',
      title: 'Final Aspire Question',
      questions: [
        {
          id: 'overallUsefulness',
          type: 'radio',
          label: 'Overall, how useful has your current Aspire habit program been in improving the way you work?',
          hint: '0 = No meaningful value · 10 = Extremely valuable',
          options: [
            '0 - No meaningful value', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10 - Extremely valuable',
          ],
        },
        {
          id: 'improvementSuggestion',
          type: 'textarea',
          label: 'What is ONE change Aspire could make to make your habit program more useful to your actual work?',
        },
      ],
    },
  ],
};
