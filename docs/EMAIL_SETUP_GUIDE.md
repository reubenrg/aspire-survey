# Aspire Auth Email Setup — Resend + Supabase

This is a manual setup guide. None of the steps below can be performed through any tool available to this session — Resend account configuration, DNS records, and Supabase Auth's SMTP/template settings are all dashboard-only surfaces with no API this session has access to (the Supabase connector here is direct Postgres SQL only; it doesn't reach Auth configuration). Everything below is written so you can execute it directly, in order, in under 20 minutes.

**Pre-flight check already done (safe, read-only, no account needed):** `spigroup.in`'s root domain already has an SPF record for Google Workspace (`v=spf1 include:_spf.google.com ~all`) — almost certainly your company's primary mail. No DMARC record exists yet at `_dmarc.spigroup.in`. This confirms the dedicated-subdomain approach below is the right call: `mail.spigroup.in` gets its own independent SPF/DKIM records that cannot conflict with or weaken the root domain's existing Google Workspace mail. Nothing about your company's real email changes.

**Sign-in now offers both a link and a 6-digit code** (added for accessibility — typing a code works across devices and doesn't depend on clicking a link inside an email client, which matters for screen-reader users especially). Both come from the same `signInWithOtp` call; the Magic Link template now displays `{{ .Token }}` as a code alongside the button. Confirmed against Supabase's own docs: email OTP is fixed at 6 digits — a 4-digit option only exists for SMS OTP, not email, so there's nothing to configure here beyond what's already in the template.

## 1. Resend: add and verify the sending domain

1. In Resend → **Domains** → **Add Domain**, enter `mail.spigroup.in` (not the bare `spigroup.in` — keeps this fully isolated from your company's real mail).
2. Resend will show you 3 DNS records to add at your DNS provider (whoever manages `spigroup.in`'s DNS — likely wherever the Google Workspace MX records live):
   - An **SPF** TXT record on `mail.spigroup.in` (Resend provides the exact value — do not reuse the root domain's SPF value, this is a separate one scoped to the subdomain)
   - A **DKIM** TXT record (usually on a `resend._domainkey.mail.spigroup.in`-style host — Resend gives you the exact name/value)
   - Optionally a **DMARC** record on `_dmarc.mail.spigroup.in` — since no DMARC exists anywhere on the domain yet, adding one scoped to the subdomain is safe and doesn't touch/create a policy for the root domain
3. Add exactly the records Resend shows you, nothing more/less — don't hand-modify them.
4. Back in Resend, click **Verify**. This can take a few minutes to propagate.
5. Confirm: **SPF = verified**, **DKIM = verified**, **Domain status = Verified**.

## 2. Resend: sending settings

1. Create a verified sender address on the new domain — e.g. `noreply@mail.spigroup.in` or `aspire@mail.spigroup.in`.
2. In Resend's settings for this domain/sender, turn **off** click tracking and **off** open tracking. This matters specifically for the Magic Link and Invite emails — click-tracking rewrites the link through Resend's own redirect domain, which is exactly the kind of link-rewriting that can break a one-time-use auth token or make the destination look unfamiliar/suspicious to the recipient.
3. Generate a Resend **API key** scoped for SMTP use. Copy it once — you won't be able to see it again after leaving that screen.

## 3. Supabase: Custom SMTP

Dashboard → **Authentication → Emails → SMTP Settings** (project `zpefurbbejsarkcgmscg`):

| Field | Value |
|---|---|
| Enable Custom SMTP | On |
| Sender name | `Aspire` |
| Sender email | the verified address from step 2 (e.g. `noreply@mail.spigroup.in`) |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key from step 2 — paste it directly into this field only, never into a file, chat, or repo |

Save, then use Supabase's own "Send test email" button if it offers one — that's the cleanest connection test. If it doesn't, the real test is section 6 below.

## 4. Supabase: Auth URL configuration

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: set this intentionally, not left over from before. Recommend keeping it as the Admin preview for now (`https://s2m-aspire-survey-git-admin-platform-v2-aspiresurvey.vercel.app`) since that's what's actually being tested — do **not** point it at `s2m-aspire-survey.vercel.app` again, that was the exact bug from earlier this session.
- **Redirect URLs allowlist**: confirm `https://s2m-aspire-survey-git-admin-platform-v2-aspiresurvey.vercel.app/admin` is present (should already be there from earlier). This is what actually governs where `emailRedirectTo` is allowed to send people — the app always supplies its own `emailRedirectTo` (`AdminGate.tsx`: `${window.location.origin}/admin`), so Site URL is really only a fallback/default, not the primary mechanism once this allowlist entry exists.
- Do not add a wildcard domain. Do not remove whatever's needed for S2M if anything in the legacy app still relies on this same Supabase Auth project.

## 5. Supabase: Email templates

Dashboard → **Authentication → Emails → Templates**. For each of the 6 templates, set the **Subject** field and paste the matching HTML body from `docs/email-templates/`:

| Template | Subject | File |
|---|---|---|
| Magic Link | `Sign in to Aspire` | `magic-link.html` |
| Invite user | `You've been invited to Aspire` | `invite-user.html` |
| Confirm signup | `Confirm your Aspire account` | `confirm-signup.html` |
| Reset password | `Reset your Aspire password` | `reset-password.html` |
| Change email address | `Confirm your new Aspire email address` | `change-email.html` |
| Reauthentication | `Your Aspire verification code` | `reauthentication.html` |

Every link-based template uses `{{ .ConfirmationURL }}` as its button href (never `{{ .SiteURL }}` directly — already checked, none of them do). Reauthentication displays `{{ .Token }}` as a 6-character code, not a link, per the spec — this project's respondent/admin flow doesn't currently use reauthentication at all, so this template exists for completeness but isn't exercised by anything today.

## 6. Delivery test (do this yourself, then tell me the results)

Once steps 1–5 are done, tell me and I'll send one fresh magic-link request through the actual app (same way as before — filling the real sign-in form, not a backend shortcut). What I can verify from my side after that: whether the request succeeds without error, and — once you click it — whether a real session gets created server-side (same DB check as before) and the app correctly resolves your Owner role. What I *cannot* verify: whether the email actually lands in your inbox, what the From address/subject/branding look like, or whether the button visually matches the design — only you can see that. Please report back:

- Did it arrive, and roughly how fast?
- From address exactly as configured?
- Subject: "Sign in to Aspire"?
- Does it look like the template (Aspire header, blue button, SPI Group footer)?
- Does clicking it land on `/admin` and show the dashboard?

For the Invite and Password Recovery templates, those aren't triggered anywhere in the current product yet (Admin has no "send invite email" button — team members are added by record only, as documented; there's no password-based login at all, so Reset Password never fires in practice). If you want those two tested for real, the only way is triggering them directly from the Supabase dashboard's own "send test email" tooling if it has one — otherwise they're reviewed by template content only, not a live send.
