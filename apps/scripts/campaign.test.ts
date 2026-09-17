/**
 * Tests for the Campaign/Distribution Center's pure-logic surface: email
 * rendering (merge tokens, escaping, no HTML injection) and recipient
 * eligibility filtering. The privacy/RLS/idempotency proofs for the schema
 * itself (survey_campaigns, survey_campaign_recipients, survey_email_events,
 * survey_campaign_test_sends, and every new security-definer function) live
 * in the database migration's own comments and were verified there directly
 * via the Supabase advisors check; they are not re-implemented here as they
 * cannot run without a live Postgres connection. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, firstNameOf, renderCampaignEmail, substituteMergeTokens, type MergeContext,
} from '../Aspire-Survey/src/admin/emailTemplate.ts';
import {
  isValidEmail, eligibleRecipients, isRemindable, type CampaignEmployee,
} from '../Aspire-Survey/src/admin/campaignEligibility.ts';

const ctx: MergeContext = {
  employeeFirstName: 'Priya',
  surveyTitle: 'Q3 Engagement Survey',
  customerName: 'Acme Corp',
  dueDate: '30 Sep 2026',
};

// ── Email rendering ──────────────────────────────────────────────────────

test('escapeHtml neutralises every HTML-special character', () => {
  assert.equal(escapeHtml(`<script>alert('x')</script> & "quotes"`),
    '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quotes&quot;');
});

test('firstNameOf takes the first token and falls back for an empty name', () => {
  assert.equal(firstNameOf('Priya Sharma'), 'Priya');
  assert.equal(firstNameOf('  Priya   Sharma  '), 'Priya');
  assert.equal(firstNameOf(''), 'there');
  assert.equal(firstNameOf('   '), 'there');
});

test('substituteMergeTokens replaces every known token and escapes the substituted value', () => {
  const out = substituteMergeTokens('Hi {{employee_first_name}}, please complete {{survey_title}} for {{customer_name}} by {{due_date}}.', ctx);
  assert.equal(out, 'Hi Priya, please complete Q3 Engagement Survey for Acme Corp by 30 Sep 2026.');
});

test('substituteMergeTokens leaves an unknown token untouched rather than guessing at it', () => {
  const out = substituteMergeTokens('Hello {{not_a_real_token}}', ctx);
  assert.equal(out, 'Hello {{not_a_real_token}}');
});

test('a merge value containing HTML-special characters is escaped, not injected', () => {
  const hostile: MergeContext = { ...ctx, employeeFirstName: '<img src=x onerror=alert(1)>' };
  const out = substituteMergeTokens('Hi {{employee_first_name}}', hostile);
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/);
});

test('renderCampaignEmail never leaves raw angle-bracket input in the rendered HTML', () => {
  const rendered = renderCampaignEmail({
    subject: 'Your feedback is requested — {{survey_title}}',
    previewText: 'Quick survey, 5 minutes',
    bodyText: 'Hi {{employee_first_name}},\n\nPlease complete <b>the survey</b> for {{customer_name}}.',
    ctaLabel: 'Start survey',
    ctaUrl: 'https://example.com/r/abc123',
    senderName: 'Aspire Surveys',
  }, ctx);

  assert.equal(rendered.subject, 'Your feedback is requested — Q3 Engagement Survey');
  assert.doesNotMatch(rendered.html, /<b>the survey<\/b>/);
  assert.match(rendered.html, /&lt;b&gt;the survey&lt;\/b&gt;/);
  assert.match(rendered.html, /href="https:\/\/example\.com\/r\/abc123"/);
  assert.match(rendered.html, /Start survey/);
});

test('renderCampaignEmail splits blank-line-separated paragraphs into separate <p> tags', () => {
  const rendered = renderCampaignEmail({
    subject: 'Subject', bodyText: 'First paragraph.\n\nSecond paragraph.',
    ctaLabel: 'Go', ctaUrl: 'https://example.com/r/x', senderName: 'Aspire',
  }, ctx);
  const matches = rendered.html.match(/<p /g);
  assert.equal(matches?.length, 2);
});

test('a CTA URL is embedded verbatim as the link target, never re-interpreted as HTML', () => {
  const rendered = renderCampaignEmail({
    subject: 'Subject', bodyText: 'Body',
    ctaLabel: 'Go', ctaUrl: 'https://example.com/r/"><script>alert(1)</script>', senderName: 'Aspire',
  }, ctx);
  assert.doesNotMatch(rendered.html, /<script>alert\(1\)<\/script>/);
});

// ── Recipient eligibility ────────────────────────────────────────────────

test('isValidEmail accepts a plausible address and rejects the common broken shapes', () => {
  assert.ok(isValidEmail('person@example.com'));
  assert.ok(!isValidEmail(null));
  assert.ok(!isValidEmail(''));
  assert.ok(!isValidEmail('not-an-email'));
  assert.ok(!isValidEmail('missing@domain'));
  assert.ok(!isValidEmail('@example.com'));
});

const employees: CampaignEmployee[] = [
  { id: 'e1', email: 'valid@example.com', invitationStatus: 'NOT_SENT' },
  { id: 'e2', email: null, invitationStatus: 'NOT_SENT' },
  { id: 'e3', email: 'not-an-email', invitationStatus: 'NOT_SENT' },
  { id: 'e4', email: 'sent@example.com', invitationStatus: 'SENT' },
  { id: 'e5', email: 'completed@example.com', invitationStatus: 'COMPLETED' },
  { id: 'e6', email: 'revoked@example.com', invitationStatus: 'REVOKED' },
];

test('eligibleRecipients separates the audience into valid / missing-email / invalid-email buckets', () => {
  const result = eligibleRecipients(employees);
  assert.deepEqual(result.valid.map(e => e.id), ['e1', 'e4', 'e5', 'e6']);
  assert.deepEqual(result.missingEmail.map(e => e.id), ['e2']);
  assert.deepEqual(result.invalidEmail.map(e => e.id), ['e3']);
});

test('eligibleRecipients counts already-invited (anything past NOT_SENT) separately from brand-new recipients', () => {
  const result = eligibleRecipients(employees);
  assert.deepEqual(result.newRecipients.map(e => e.id), ['e1']);
  assert.deepEqual(result.alreadyInvited.map(e => e.id), ['e4', 'e5', 'e6']);
});

test('isRemindable only targets someone a link already went out to, with a resolvable email', () => {
  assert.ok(!isRemindable(employees[0])); // NOT_SENT - nothing to remind them of yet, that would be a first send
  assert.ok(isRemindable(employees[3])); // SENT
  assert.ok(!isRemindable(employees[1])); // missing email
  assert.ok(!isRemindable(employees[2])); // invalid email
  assert.ok(!isRemindable(employees[4])); // COMPLETED - nothing to chase
  assert.ok(!isRemindable(employees[5])); // REVOKED
});
