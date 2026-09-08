/**
 * Survey-level content and branding.
 *
 * Keep campaign-specific text here and question/answer content in
 * `data/SurveyData.ts`. This allows a future survey to be created without
 * changing navigation or submission code.
 */
export const SURVEY_CONFIG = {
  organization: 'S2M Health',
  program: 'Aspire',
  title: 'Behaviour & Performance Impact Survey — 2026',
  documentTitle: 'S2M Health Employees Survey',
  estimatedTime: '8–10 minutes',
  welcome: {
    introduction: 'Since April 2026, the Aspire Program has been working with S2M Health employees through role-specific habit formation programs designed to strengthen day-to-day workplace behaviours and improve how work is approached, managed and completed.',
    prompt: 'This survey is intended to understand:',
    goals: [
      'What has changed in the way you work?',
      'What has helped create that change?',
      'How much the Aspire Program has contributed to those changes?',
      'What is helping or limiting consistent behaviour? and',
      'What support would help you perform your role better?',
    ],
    privacy: 'The survey is focused on your actual work experience. There are no right or wrong answers, and honest responses will help S2M Health and the Aspire Program identify what is working well, where stronger support is needed, and how the program can be improved further.',
  },
  sections: [
    'About You',
    'How Has The Way You Work Changed?',
    'How Do You Handle Problems?',
    'Work Environment & Manager Support',
    'Aspire & Behaviour Change',
    'Has The Habit Become Part Of Your Work?',
    'What Has Helped You Improve?',
    'What Type Of Impact Have You Seen?',
    'Real Evidence of Change',
    'What Is Getting In The Way?',
    'Performance Clarity',
    'Role-Specific Module',
    'Final Question',
  ],
} as const;

export const SURVEY_BRAND_NAME = `${SURVEY_CONFIG.organization} × ${SURVEY_CONFIG.program}`;
