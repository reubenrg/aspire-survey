# Aspire Survey Admin — Operating Guide

For Aspire Customer Success / Operations. Not an engineering document — see `TECHNICAL_RUNBOOK.md` for that.

## Login

Go to the Admin sign-in page and enter your email. You'll receive a one-time sign-in link — no password to remember or leak. Click the link to land in the dashboard. Links expire after a short window; if yours has expired, just request a new one.

## Create a customer

**Customers → New customer.** Give it a name, an optional brand colour and logo URL. The web address (used in survey links) is derived from the name and stays fixed once set, even if you rename the customer later — so existing survey links keep working.

## Import employees

Open a customer → **Employees → Import CSV**. The wizard maps your columns to the required fields (employee code, name, email, department, designation, location) and shows you a preview before committing. Employee codes must be unique within a customer. Deactivating an employee (rather than deleting) is the normal way to remove someone — it preserves any responses they've already submitted.

## Create a survey

**Surveys → New survey.** Three starting points:
- **Blank** — start from nothing.
- **From a template** — pick a saved template (global Aspire templates or one of your workspace's own) and it prefills the whole structure.
- **Duplicate an existing survey** — copies another survey's current structure.

Pick the customer, give it a title/category/purpose, and choose a **privacy mode** (next section) before moving into the Builder.

## Privacy modes

This is the single most important decision when creating a survey — choose carefully, it shapes what can ever be seen later:

- **Anonymous** — no link between a respondent and their answers, ever. Distributed via one shared link; anyone with the link can respond.
- **Anonymous, participation tracked** — you can see *who has completed* the survey (for reminders/follow-up), but their individual answers can never be traced back to them. Requires per-employee invitation links.
- **Confidential** — answers ARE linked to an identified employee, but only for team members explicitly granted the **identity view** permission (see Team, below). Everyone else sees only de-identified, aggregated data.

You cannot change a survey's privacy mode after it has real responses — get this right before publishing.

## Build the survey

The Builder is a section-and-question canvas. Add sections, add questions (text, single/multi-choice, matrix, and more), reorder by drag, and set **conditional logic** ("show this question only if…") from a question's properties panel. Everything autosaves as a draft — nothing goes live until you **Publish**. Use **Preview** at any point to see exactly what a respondent will see, including how conditional logic behaves.

You can also **save a question to the Question Library** or **save the whole survey as a template** from inside the Builder, to reuse it later — this makes a one-time copy; editing the library/template afterward never changes surveys that already used it.

## Publish

Once you're happy with the draft, **Publish**. This locks in the live version respondents will see. You can still make additive changes later (add a question, add a matrix row) without breaking existing responses; changes that would reinterpret already-collected data (renaming a question, changing its type) are blocked with a clear explanation of why.

## Magic links (invitations)

For any non-Anonymous survey, generate per-employee invitation links from **Audience**. Each link can be copied, revoked, or regenerated. Status per employee is tracked through: **Sent → Opened → Started → Completed**. A revoked or expired link stops working immediately and shows the respondent a clear message, not an error page.

**Current behaviour:** Admin generates the links; it does not currently send invitation emails itself. Copy the link(s) and distribute them through your own email/communication tool. (See the Technical Runbook for the operational classification of this gap.)

## Audience

Shows every invited employee for a survey and their current status, with search and filters. This is where you generate, copy, revoke, and regenerate individual invitations.

## Responses

**Response Centre** shows individual submissions (where the privacy mode allows — Anonymous surveys never show anything traceable to a person). Filter, page through, and open individual responses where permitted.

## Analytics

Aggregated charts and breakdowns — distributions per question, trends over time, segment comparisons (by department/location/designation). Any group smaller than the confidentiality threshold (minimum 5, platform-enforced) is automatically suppressed rather than shown, to protect small groups from being identifiable by elimination.

## Report

A management-facing summary view of a survey's results, formatted for printing/PDF.

## Export

CSV export is available from Analytics/Response Centre. An export never contains more than what you're already allowed to see on screen — if you don't have identity-view permission on a Confidential survey, the export is de-identified too. Every export is logged in Activity.

## Team roles

Four roles, each including everything below it:
- **Viewer** — read-only.
- **Analyst** — can view responses/analytics for surveys they have access to.
- **Editor** — can build/manage surveys, the Question Library, and Templates.
- **Owner** — everything Editor can do, plus managing Team membership and Settings.

Roles can be **global** (Aspire-wide) or scoped to one customer/workspace. A separate **"can view identified responses"** permission gates Confidential-survey identity access — it's independent of role, so an Owner doesn't automatically get it either; it must be explicitly granted.

Only an Owner can add members, change roles, or change identity permission — and even an Owner cannot change their own role or identity permission (ask another Owner). The last Owner for a scope cannot be removed or demoted, to prevent workspace lockout.

## Archive a survey

Closing a survey stops new responses; archiving removes it from the active list without deleting any data. Both are reversible from Survey Detail.

## Common errors

Every error you see in Admin is written in plain language — if you ever see raw database text or a stack trace, that's a bug, please report it. Typical messages:
- *"You don't have permission to manage team access."* — you need Owner for that action.
- *"This template is unavailable."* — it was deactivated after you opened the page; refresh.
- *"The question could not be saved."* — check required fields are filled in.
- *"This survey was changed elsewhere just now."* — someone else edited the same draft; reopen it to get the latest version.

## Privacy rules to remember

- Privacy mode cannot be changed once a survey has responses.
- The confidentiality threshold has a hard floor of 5 — nobody, including an Owner, can lower it below that for analytics.
- Editing a Question Library item or a Template never changes a survey that already copied it.
- A workspace's own Library/Template content is never visible to another customer's team.
