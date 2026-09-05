// All survey questions — 13-section Workplace Behaviour & Impact Survey 2026

export const ROLES = [
  'SME / Process Coach', 'HCC Coders', 'HR', 'Team Leads', 'Admin',
  'Quality Analyst', 'Trainer', 'IT Manager', 'IT', 'MIS', 'Team Manager',
] as const;

export const LOCATIONS = [
  'Chennai – MINT', 'Chennai – Ambattur', 'Chennai – Prakash Tower', 'Coimbatore', 'Other',
] as const;

// Section 2 — How Has The Way You Work Changed?
export const CHANGE_ROWS = [
  'Understanding what is expected from my role',
  'Planning and prioritising my work',
  'Completing my responsibilities reliably',
  'Taking ownership until work is completed',
  'Solving problems when they arise',
  'Making appropriate decisions independently',
  'Learning from mistakes, feedback or difficult situations',
  'Applying previous learning to new situations',
  'Adapting when requirements or priorities change',
  'Communicating clearly with the people I work with',
  'Preventing repeated problems',
  'Being consistent in how I work',
];

export const CHANGE_SCALE = [
  '1 – Reduced', '2 – Slightly reduced', '3 – No meaningful change', '4 – Improved', '5 – Improved significantly',
];

// Section 3 — How Do You Handle Problems?
export const MISTAKE_RESPONSE_OPTIONS = [
  'Fix the immediate issue and move on',
  'Understand what caused the issue',
  'Understand the cause and check the relevant process/guideline/information',
  'Change the way I work based on what I learned',
  'Take action to prevent the same issue from happening again',
  'Prevent recurrence and share the learning with others',
];

export const WORK_LEVEL_OPTIONS = [
  'I mainly follow instructions given to me',
  'I understand how to complete my responsibilities',
  'I understand why the process or approach is important',
  'I can apply my understanding when the situation changes',
  'I can independently handle more complex situations',
  'I can help others understand or improve the way the work is done',
];

// Section 4 — Work Environment & Manager Support
export const MANAGER_ROWS = [
  'My manager makes it clear what good performance looks like in my role',
  'My manager gives feedback that helps me improve',
  'My manager helps me understand what I should do differently',
  'My manager follows up after important feedback',
  'My manager encourages me to take ownership',
  'My manager gives me appropriate freedom to solve problems',
  'My manager encourages learning from mistakes or challenges',
  'My manager connects Aspire Program behaviours with actual work where relevant',
];

export const AGREE_SCALE = [
  '1 – Strongly Disagree', '2 – Disagree', '3 – Neutral', '4 – Agree', '5 – Strongly Agree',
];

export const MANAGER_FREQUENCY_OPTIONS = [
  'Never', 'Rarely', 'Once a month', 'A few times a month', 'Weekly', 'Several times a week',
];

// Section 5 — Aspire & Behaviour Change
export const ASPIRE_BEHAVIOUR_ROWS = [
  'Aspire Program makes me pause and think about how I perform my work',
  'Aspire Program helps me reflect on real situations from my work',
  'Aspire Program helps me identify something I could do differently',
  'Aspire Program helps me apply learning in my normal work',
  'Aspire Program has helped me become more consistent in at least one useful behaviour',
  'Aspire Program has helped me handle some situations better than before',
  'Aspire Program habits are relevant to the responsibilities of my role',
];

// Section 6 — Has The Habit Become Part Of Your Work?
export const HABIT_LEVELS = [
  'I usually do it only when reminded',
  'I understand the behaviour but do not practice it consistently',
  'I consciously try to practice it',
  'I regularly use it during my normal work',
  'It has become a natural part of how I work',
  'I now encourage or help others use the same behaviour',
];

// Section 7 — What Has Helped You Improve?
export const IMPROVEMENT_FACTORS = [
  'Aspire Program habit formation',
  'Support from my manager',
  'Support from my Team Lead',
  'Formal training',
  'Practice and work experience',
  'Support from colleagues',
  'PMS feedback',
  'Feedback from quality/review/audit',
  'Better process or work clarity',
  'Personal effort',
  'Changes in my role/project/work allocation',
  'I have not noticed a major improvement yet',
  'Other',
];

// Section 8 — What Type Of Impact Have You Seen?
export const IMPACT_AREAS = [
  'Better quality or reliability of my work',
  'Faster or more efficient completion of work',
  'Fewer repeated mistakes/issues',
  'Better decision making',
  'Better problem solving',
  'Better ownership and follow-through',
  'Better communication',
  'Better collaboration',
  'Better service to internal/external stakeholders',
  'Better ability to support or develop others',
  'Better ability to identify risks early',
  'Better consistency in how I work',
  'No major improvement yet',
  'Other',
];

// Section 9 — Real Evidence of Change
export const EVIDENCE_ATTRIBUTION_OPTIONS = [
  'Aspire Program habit formation',
  'Manager / Team Lead coaching',
  'Formal training',
  'Work experience / practice',
  'Feedback',
  'Support from colleagues',
  'PMS discussion',
  'My own effort',
  'Process / system changes',
  'Multiple factors together',
  'Other',
];

export const ASPIRE_ATTRIBUTION_OPTIONS = [
  'Yes, significantly', 'Yes, to some extent', 'Maybe / not sure', 'No',
];

// Section 10 — What Is Getting In The Way?
export const BARRIER_OPTIONS = [
  'Workload / work pressure',
  'Not enough time',
  'I forget to practise it',
  'I practise the behaviour but forget to record it',
  'The behaviour/task is not clear enough',
  'It does not always feel relevant to my work',
  'It feels repetitive',
  'I need more feedback',
  'I need more manager reinforcement',
  'Technical/app issue',
  'My work situation does not give me enough opportunity to practise it',
  'No major challenge',
  'Other',
];

export const HELP_OPTIONS = [
  'Clearer explanation',
  'More role-relevant activities',
  'Better examples',
  'More manager reinforcement',
  'More feedback',
  'More team discussion',
  'Shorter/simpler activities',
  'Better connection with actual work situations',
  'Better app experience',
  'No additional support needed',
  'Other',
];

// Section 11 — Performance Clarity
export const PMS_CLARITY_OPTIONS = [
  'Very clear', 'Mostly clear', 'Somewhat clear', 'Not very clear', 'Not clear at all',
];

// Section 12 — Role-Specific Module (3 questions each)
export const ROLE_QUESTIONS: Record<string, { title: string; statements: string[] }> = {
  'HCC Coders': {
    title: 'Your Coding Practice',
    statements: [
      'I can explain the reasoning behind important coding decisions.',
      'I review mistakes to understand why they happened.',
      'I take action to reduce repeated coding/QA issues.',
    ],
  },
  'Quality Analyst': {
    title: 'Your Quality Practice',
    statements: [
      'I can clearly explain the reasoning behind my review/audit decisions.',
      'I identify patterns behind repeated quality issues.',
      'My feedback helps others prevent similar issues.',
    ],
  },
  'SME / Process Coach': {
    title: 'Your Coaching & Knowledge Practice',
    statements: [
      'I identify the root cause behind recurring questions or knowledge gaps.',
      'I turn complex information into clear and practical guidance.',
      'I convert repeated learning into something the wider team can reuse.',
    ],
  },
  'Team Leads': {
    title: 'Your Team Leadership Practice',
    statements: [
      'I identify patterns behind employee performance issues.',
      'I coach people on the reason behind a problem, not only the correction.',
      'I follow up to check whether coaching actually changed behaviour.',
    ],
  },
  'Team Manager': {
    title: 'Your Management Practice',
    statements: [
      'I use information/data to decide where intervention is required.',
      'I distinguish people capability issues from process/work-environment issues.',
      'I ensure improvement actions are followed through by my team.',
    ],
  },
  'HR': {
    title: 'Your HR Practice',
    statements: [
      'I maintain clear ownership of employee/process actions until closure.',
      'I identify delays or dependencies before they become larger issues.',
      'I look for ways to improve recurring HR processes.',
    ],
  },
  'Admin': {
    title: 'Your Administrative Practice',
    statements: [
      'I maintain clear visibility of open tasks and dependencies.',
      'I communicate delays or required actions at the right time.',
      'I consistently follow tasks through to closure.',
    ],
  },
  'Trainer': {
    title: 'Your Training Practice',
    statements: [
      'I identify the specific reason behind learner performance gaps.',
      'I check whether learning is being applied after training.',
      'I adjust my training based on evidence of learner needs.',
    ],
  },
  'IT': {
    title: 'Your IT Practice',
    statements: [
      'I look beyond the immediate technical issue to understand the underlying cause.',
      'I clearly communicate ownership, status and next action.',
      'I take preventive action where repeated issues occur.',
    ],
  },
  'IT Manager': {
    title: 'Your IT Management Practice',
    statements: [
      'I prioritise work based on business impact and risk.',
      'I ensure recurring technical issues receive root-cause action.',
      'I develop the team\'s ability to resolve issues independently.',
    ],
  },
  'MIS': {
    title: 'Your Reporting & Data Practice',
    statements: [
      'I verify the reliability of information before sharing it.',
      'I highlight the insights/exceptions that require attention, not only the numbers.',
      'I continuously look for opportunities to improve or automate reporting.',
    ],
  },
};
