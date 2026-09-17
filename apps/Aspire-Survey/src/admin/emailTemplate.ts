/**
 * Pure rendering for a campaign's invitation email. No Supabase import, no
 * DOM - this runs the exact same way in the browser (composer preview) and
 * inside the send Edge Function (Deno), so what the founder previews is
 * provably what gets sent.
 *
 * The composer never accepts raw HTML: subject/preview text/body are plain
 * text with {{merge}} tokens, and the only HTML this module ever produces is
 * from the fixed template below, built entirely from escaped strings. That is
 * what makes "no arbitrary executable HTML" true by construction rather than
 * by sanitizing something dangerous after the fact.
 */

export interface MergeContext {
  employeeFirstName: string;
  surveyTitle: string;
  customerName: string;
  dueDate: string; // already formatted for display, or '' if none
}

const MERGE_KEYS: Record<string, keyof MergeContext> = {
  employee_first_name: 'employeeFirstName',
  survey_title: 'surveyTitle',
  customer_name: 'customerName',
  due_date: 'dueDate',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** First whitespace-separated token of a full name, falling back to "there". */
export function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || 'there';
}

/**
 * Replaces every {{known_key}} token with its escaped value. An unknown
 * token (typo, or something dangerous someone tried to smuggle in) is left
 * exactly as written rather than guessed at or evaluated - it just renders
 * as the literal text "{{whatever}}", which is safe and immediately visible
 * as a mistake in the test-send preview.
 */
export function substituteMergeTokens(text: string, ctx: MergeContext): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, key: string) => {
    const field = MERGE_KEYS[key];
    if (!field) return whole;
    return escapeHtml(ctx[field] ?? '');
  });
}

export interface CampaignEmailInput {
  subject: string;
  previewText?: string | null;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  senderName: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders the plain-text subject/body (with merge tokens substituted and
 * HTML-escaped) into the one fixed Aspire email layout. bodyText's blank
 * lines become paragraph breaks; nothing else about its structure is
 * interpreted, so there is no markup dialect to parse or get wrong.
 */
export function renderCampaignEmail(input: CampaignEmailInput, ctx: MergeContext): RenderedEmail {
  const subject = substituteMergeTokens(input.subject, ctx);
  // Escape the author's own literal text first - {{tokens}} contain no
  // HTML-special characters, so escaping first cannot corrupt them - then
  // substitute merge values into the now-safe string. Skipping the escape
  // here would let literal HTML typed into the composer (or copy-pasted from
  // somewhere) render as real markup instead of visible text.
  const bodyEscaped = substituteMergeTokens(escapeHtml(input.bodyText), ctx);
  const paragraphs = bodyEscaped
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="margin:0 0 16px;line-height:1.6;color:#1f2430;">${p.replace(/\n/g, '<br />')}</p>`)
    .join('\n');

  const preview = input.previewText ? substituteMergeTokens(input.previewText, ctx) : '';
  const cta = escapeHtml(input.ctaLabel);
  const sender = escapeHtml(input.senderName);
  // ctaUrl is a same-origin /r/:token or /t/:token URL the caller builds from
  // a token it just generated server-side - never a value taken verbatim from
  // client input for a real send.
  const safeUrl = escapeHtml(input.ctaUrl);

  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">',
    preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>` : '',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">',
    '<tr><td align="center">',
    '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">',
    `<tr><td style="padding:24px 32px 0;"><span style="display:block;margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;">${sender}</span></td></tr>`,
    `<tr><td style="padding:0 32px 8px;">${paragraphs}</td></tr>`,
    `<tr><td style="padding:8px 32px 32px;"><a href="${safeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">${cta}</a></td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body></html>',
  ].filter(Boolean).join('\n');

  const text = `${bodyEscaped}\n\n${input.ctaLabel}: ${input.ctaUrl}`;

  return { subject, html, text };
}
