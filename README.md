# Aspire Survey

Production-ready Vite survey for S2M Health's Aspire programme. The application is configured to deploy from the repository root to Vercel and stores completed responses in Supabase.

## Publish to Vercel

### 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Run [`apps/supabase/schema.sql`](apps/supabase/schema.sql). Run the entire file even if the table already exists: it creates or updates the response table, prevents duplicate employee IDs, enables row-level security, and grants the public form insert-only access without exposing submitted responses.

### 2. Configure environment variables

Add these variables to the Vercel project for **Production**, **Preview**, and **Development**:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | The Supabase project URL from **Project Settings → API** |
| `VITE_SUPABASE_ANON_KEY` | The Supabase publishable/anonymous key (never use the service-role key in a browser app) |

The required names are also listed in [`apps/.env.example`](apps/.env.example).

### 3. Deploy

Import this repository at [vercel.com/new](https://vercel.com/new). Keep the project root set to the repository root; [`vercel.json`](vercel.json) already specifies the build command and output directory. Add the environment variables above, then select **Deploy**.

For an existing linked Vercel project, deploy from a terminal instead:

```bash
npm run deploy
```

After deployment, complete one test response and confirm that a row appears in `public.survey_responses` in Supabase's Table Editor. Delete the test row before distributing the survey URL if the Employee ID must be reused.

## Local development

```bash
cp apps/.env.example apps/.env.local
# Fill in the two Supabase values in apps/.env.local
npm run dev
```

The development server reads `apps/.env.local` and is available at <http://localhost:8080>. Restart it after adding or changing environment variables.

Create a production build with:

```bash
npm run build
```

The generated site is written to `apps/Aspire-Survey/dist`.

## Create future surveys

Campaign identity and section metadata live in `apps/Aspire-Survey/src/survey.config.ts`, while question text and answer choices live in `apps/Aspire-Survey/src/data/SurveyData.ts`. See [CUSTOMIZING.md](CUSTOMIZING.md) for the complete customization and verification checklist. The original responsive components and Aspire theme remain unchanged.

## Data-access note

The Supabase anonymous key is intentionally public and is safe to include in the generated frontend. Access is controlled by database grants and row-level security: the included SQL grants anonymous users `INSERT` only, not `SELECT`, `UPDATE`, or `DELETE`. The submission request deliberately uses PostgREST's minimal response mode so saving a response does not require public read access. Keep all privileged keys out of Vercel variables whose names start with `VITE_`.
