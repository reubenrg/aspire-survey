# S2M Survey Platform — Engineering Handoff

_Last verified: 15 September 2026, against the running application and the production database._

A definition-driven survey engine and admin builder. One live survey in production; a multi-survey
engine built and verified on a branch, not yet merged.

| | |
|---|---|
| **Stack** | React 18, TypeScript, Vite 8, Tailwind, React Router 7 |
| **Data** | Supabase (Postgres + PostgREST + Auth), project ref `zpefurbbejsarkcgmscg` |
| **Hosting** | Vercel, static SPA. No Next.js, no Node server. |
| **Live survey** | https://s2m-aspire-survey.vercel.app |
| **Repo** | `github.com/reubenrg/aspire-survey` |
| **Production branch** | `main` @ `9062424` |
| **Engine branch** | `survey-engine` @ `4f791ea` (3 commits ahead, unpushed) |

---

## 1. Where the project actually stands

The most common misreading is that this is a static frontend with a JSON schema. It is not.

There are **two things** in the repository:

1. **The live survey** — a hand-written 13-section S2M Health behaviour survey in English, Tamil and
   Hindi. Deployed and collecting responses.
2. **The engine** — a newer system that renders *any* survey from a stored definition, plus an admin
   panel for building them. Complete through publishing, verified end to end against the production
   database, living on an unmerged branch.

The live survey was deliberately **not** migrated onto the engine. It works, it is circulating, and
rewriting it would put real respondents at risk for no gain. It keeps its own code path at `/`.

### Against the four admin-panel requirements

| Requirement | Status | Detail |
|---|---|---|
| Dynamic form builder | **Built** | Six question types, options, required, max-selections, "Other" free text, conditional visibility, reordering. Arrows rather than drag-and-drop. |
| Survey management | **Partial** | Create, edit, delete, publish, unpublish all work. Versioning does not exist. |
| Analytics & export | **Not built** | Nothing can read responses today. Deliberate security posture, not an omission — see §3. |
| RBAC & compliance | **Partial** | Magic-link auth plus a single-boolean admin allowlist. No roles, no audit log. |

Two new workstreams, then, rather than four.

---

## 2. Architecture

A static SPA talking **straight to Postgres**. There is no application server, so every access rule
is a database policy.

This is the single most important thing to understand before changing anything. The browser holds a
publishable key and speaks to PostgREST directly. Nothing is enforced in JavaScript, because anyone
can change what a browser runs. **Row level security *is* the security model.**

```
BROWSER                    POLICY GATE                  POSTGRES
─────────────────────────────────────────────────────────────────────────
Respondent      ──────▶  published = true      ──────▶  surveys
anon · /s/:slug          select only                    (definitions as jsonb)
     │
     │ submit   ──────▶  insert only,          ──────▶  survey_<slug>
     │                   no select                      (one table per survey)
     │
Admin           ──────▶  is_survey_admin()     ──────▶  surveys
authenticated            security definer               (full access)
/admin                          │
                                └──── reads ──────────▶ survey_admins
                                                        (no policy, unreadable)
```

### Why responses are unreadable

Response tables get an `insert` grant and an insert policy, and **deliberately no `select` policy at
all**. Two independent barriers. A staff survey that promises honesty has to make reading answers
impossible from the public key, not merely inconvenient.

This is why analytics is genuine work rather than a screen: it requires opening a read path that does
not currently exist, which is a **security decision before it is a feature**.

### Key source files

```
apps/Aspire-Survey/src/
  engine/
    types.ts          the definition schema (the contract everything hangs off)
    definition.ts     visibility, validation, row building, column derivation
    generateSql.ts    create-table + RLS policy + grant + registration SQL
    QuestionField.tsx renders one question of any type
    SurveyRenderer.tsx step machine, welcome, thank-you
    surveyStore.ts    load a survey by slug; insert a response
    translate.tsx     per-survey translations with English fallback
  admin/
    AdminGate.tsx     magic-link sign in, session handling
    SurveyEditor.tsx  build / preview / translate / SQL tabs
    QuestionEditor.tsx one question, all six types
    adminStore.ts     reads and writes the surveys table
  routes/
    SurveyPage.tsx    /s/:slug
    AdminPages.tsx    /admin and /admin/:slug
apps/scripts/
  gen-sql.ts          npm run gen:sql -- <survey>
  engine.test.ts      npm test (13 tests)
apps/supabase/
  COMPLETE_SETUP.sql  everything: surveys table, demo, admin allowlist, policies, grants
```

---

## 3. Data model

| Table | Holds | `anon` | `authenticated` |
|---|---|---|---|
| `surveys` | One row per survey; definition as `jsonb` | select where `published` | all, if admin |
| `survey_<slug>` | Responses, one table per survey, one column per answer | insert | insert |
| `survey_admins` | Allowlist of admin emails | none | none |
| `survey_responses` | The original live survey, predating the engine | insert | insert |

The allowlist has **no policy for any role**, so it cannot be enumerated from a browser. Admin checks
read it through a `security definer` function instead.

### Definitions are data, never code

A definition contains no functions and no component references, so it survives a round trip through
`jsonb` intact — including conditional logic and answer-dependent question sets. **That property is
what lets the builder publish a survey without a redeploy.** Preserve it: the moment a definition
needs a callback, the builder stops working.

Verified surviving the round trip: `showIf` conditions, `rowsByAnswer` maps, matrix scales.

---

## 4. Traps

Four things that fail **silently**. Each one has already cost a debugging session.

### 4.1 Matrix rows map to columns by position

A rating grid writes `prefix_01`, `prefix_02` and so on, numbered by the row's index. Reordering or
deleting a row after responses exist silently reassigns what an existing column means. Nothing
errors; the data simply stops meaning what the column comment says.

**Treat row lists as append-only once a survey is live.**

### 4.2 Translations are keyed by the English string

Change an English question and its Tamil and Hindi entries no longer match, so those languages
silently fall back to English. No error, no warning. Every reword must update all three.

The live survey's **thank-you page has exactly this bug today**: its component text and its
translation key differ by two words, so Tamil and Hindi respondents finish the survey and get an
English closing message. Left unfixed pending a decision.

### 4.3 The Supabase SQL editor runs only what is selected

With any text highlighted, Run executes that fragment and still shows a success toast. **Three
migrations appeared to succeed and did nothing.** Always `Ctrl+A` first, and prefer scripts that end
in a `select` that proves their own result.

### 4.4 A policy does not grant access

Row level security decides *which rows* a role may touch; it does not grant access to the table.
PostgREST builds its schema cache from relations a role has privileges on, so a table with policies
but no `grant` is invisible to the API and every request fails with `PGRST205` — which reads like a
missing table. The SQL generator now always emits the grant.

---

## 5. Roadmap

Ordered by dependency, not priority. **A and B ship together** because versioning needs roles to
decide who may publish.

### A. Role-based access control

Replace the boolean allowlist with `survey_members(email, role)` carrying `owner`, `editor`,
`analyst`, `viewer`. Policies read the role through the existing definer function. Owner alone may
publish or change roles.

### B. Versioning

A `survey_versions` table holding definition snapshots, a `current_version` pointer on `surveys`, and
a version stamped onto every response row so it is always clear which shape a row was collected
under. The editor should **refuse**, not warn, when an edit would break a column that already holds
data.

### C. Analytics and export

Requires opening a read path that does not exist today, gated on `analyst` and above. Then completion
rates, per-question breakdowns, and CSV/JSON export. See §6 on whether analysts see individual
responses at all.

### D. Audit log

Who published, unpublished, edited, or exported what, and when. Cheap to add once roles exist, and
the first thing any compliance review asks for.

---

## 6. Open decisions

Both change the schema. Neither should be decided by whoever picks up the code next.

### 6.1 How versioning coexists with one table per survey

These pull against each other: edit a survey after responses exist and its table no longer matches
its definition. Three options:

1. **Additive-only** — new questions add columns; nothing is removed or reordered.
2. **A table per version** — `survey_x_v2`. Clean history, but analytics must union across versions.
3. **`jsonb` responses with generated columns** — maximum flexibility, loses the readable column
   layout that was asked for.

**Recommendation: additive-only with a version stamp.** It preserves the one-table-per-survey model
that was asked for, keeps columns readable, and makes the positional-column trap (§4.1) structurally
harder to trigger.

### 6.2 Whether analysts read individual responses

For a staff survey where people were promised honesty, **aggregate-only is often the right answer**,
and it is enforceable in row level security rather than left to convention. Raw access is easy to add
later; it is very hard to take back once people know it exists.

---

## 7. A note on HIPAA

**The current survey is not PHI.** It collects employee identifiers, names and workplace opinions.
HIPAA governs protected health information about *patients*, so today's survey is almost certainly
out of scope whatever the wider business does.

**If any future survey collects patient data, this hosting is not eligible.** HIPAA requires a signed
business associate agreement with every processor. Supabase offers one only on paid plans with the
HIPAA add-on; Vercel's requires Enterprise. One of the Vercel teams here is on the Hobby plan, and
the other's tier has not been confirmed. Role-based access and audit logs are necessary but nowhere
near sufficient on their own.

Until a BAA exists, treat **"no patient data in surveys"** as an explicit design rule. A publish-time
confirmation in the builder would make that rule visible rather than tribal.

_Nothing here certifies compliance; it describes what compliance would require._

---

## 8. Running it

```bash
npm --prefix apps install
npm --prefix apps run dev          # localhost:8080

npm --prefix apps test             # 13 passing — column mapping and generated SQL
npm --prefix apps run gen:sql -- demo   # SQL for a survey's response table
npm --prefix apps run build
```

| Route | Serves |
|---|---|
| `/` | The original hand-written S2M survey, unchanged |
| `/s/:slug` | Any published survey, rendered from its stored definition |
| `/admin` | Survey list; create, publish, delete |
| `/admin/:slug` | Builder — build, preview, translate, SQL |

Two environment variables, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, are read **at build
time** and baked into the bundle, so changing either needs a redeploy. The build fails loudly when
one is missing rather than shipping a survey that cannot submit.

Note the two keys are not interchangeable in shape: production uses a newer `sb_publishable_…` key,
while the local `.env.local` holds the legacy JWT anon key. Both work.

---

## 9. Outstanding

- **Magic-link sign-in is unverified.** Everything else on the branch was tested against the
  production database; completing a sign-in requires opening an emailed link, so a human has to
  confirm it.
- **The branch is unmerged and unpushed.** `survey-engine` at `4f791ea`, three commits ahead of `main`.
- **The thank-you translation bug** (§4.2) is live and unfixed.
- **Test rows** prefixed `ZZ-` may remain in `survey_responses` and `survey_engine_demo`:
  ```sql
  delete from public.survey_responses where employee_id like 'ZZ-%';
  delete from public.survey_engine_demo where employee_id like 'ZZ-%';
  ```

---

## 10. History worth knowing

The project began as a Fillout/Zite export. Removing that platform's runtime uncovered three separate
production-breaking bugs, all fixed:

1. The build read files outside its own directory, which Vercel's build context does not include.
2. Two imports whose casing only resolved on Windows — Linux is case-sensitive.
3. Every submission would have failed: the client sent `Prefer: return=representation`, which needs a
   `select` policy that deliberately does not exist.

The third is the instructive one. It returned `201` in some paths and failed in others, and looked
like a working survey right up until a real person submitted.
