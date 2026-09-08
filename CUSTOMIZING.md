# Creating another survey

The application separates campaign settings, question content, presentation, and storage so a new survey can reuse the existing responsive UI without editing generated build files.

## What to change

1. **Campaign identity:** edit `apps/Aspire-Survey/src/survey.config.ts` for the organisation, programme, browser title, estimated completion time, and ordered section names.
2. **Questions and choices:** edit `apps/Aspire-Survey/src/data/SurveyData.ts`. Matrix definitions are imported by both the UI and the Supabase submission adapter, so their labels cannot silently drift apart.
3. **Translations:** add matching entries to `apps/Aspire-Survey/src/i18n/Translations.ts`. English is always the fallback when a translation is absent.
4. **Section layout:** reuse the controls in `src/components` and the step shell/navigation patterns in `src/components/Steps`. Add the new step to `App.tsx` and add its name to `SURVEY_CONFIG.sections`.
5. **Brand theme:** update the CSS custom properties near the top of `src/index.css`. Components consume semantic tokens such as `primary`, `background`, and `muted`, so the survey remains visually consistent.
6. **Storage:** every answer is retained in the `responses_json` JSONB column. Add a dedicated SQL column and mapping in `zite-api.ts` only when the answer also needs to be filtered or exported as a first-class reporting column.

## Safe customization rules

- Do not edit `public/` or `dist/`; they are generated build output.
- Do not put a Supabase service-role key in any `VITE_` variable. Browser builds expose these values.
- Keep stable answer labels during a live campaign. If a label must change, start a new survey version so reports do not combine two meanings.
- Keep `employee_id` unique only when one response per employee is required. For recurring surveys, use a unique constraint containing a campaign identifier instead.
- Run the schema in a non-production Supabase project and submit a complete response before applying a customized schema in production.

## Pre-publish checklist

- Complete the survey once on a phone-sized screen and once on desktop.
- Check English, Tamil, and Hindi views for overflow and untranslated campaign text.
- Confirm required questions prevent navigation until answered.
- Confirm conditional “Other” and evidence follow-up fields appear correctly.
- Confirm one row is inserted in Supabase and the JSON response contains the complete answer set.
- Confirm an anonymous browser cannot read rows from the REST endpoint.
- Confirm a repeated Employee ID receives the duplicate-response message.
