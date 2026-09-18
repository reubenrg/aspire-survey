// Aspire Surveys — send-campaign Edge Function
//
// The ONLY server-side surface that ever calls Resend. Runs with two Supabase
// clients: `userClient` (carries the caller's own JWT, so has_survey_role/RLS
// apply exactly as they would in the browser) authorises the request, and
// `admin` (the service-role key, bypasses RLS) does the actual privileged
// work once authorisation is confirmed - resolving recipients, regenerating
// invitation tokens, and writing delivery state. A browser client can never
// reach the service-role client directly; it only ever gets this function's
// JSON response.
//
// verify_jwt is enabled on this function's deployment, so an unauthenticated
// request is rejected before this code even runs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * One structured line per notable event, to Supabase's own function log
 * (queryable via query_logs / the dashboard) - never response content,
 * employee PII beyond an id, invitation/magic-link tokens, the Resend API
 * key, or anything else secret. This is deliberately separate from
 * record_audit()/service_record_audit(): those are the durable business
 * record ("a campaign was sent"), this is operational detail for answering
 * "what failed, where, for which campaign, how many recipients, was it
 * auth/validation/DB/provider, and how long did it take" without querying
 * audit_logs for every diagnostic question.
 */
function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event_ts: new Date().toISOString(), ...fields }));
}

// ── Email rendering ─────────────────────────────────────────────────────
// Deliberately duplicated from apps/Aspire-Survey/src/admin/emailTemplate.ts:
// this Edge Function runs on Deno, that module ships to the browser/Node test
// runner, and this repo has no shared-package build step to bridge them.
// Keep the two in step by hand if either changes - same merge-token set,
// same escape-first-then-substitute order, same fixed HTML layout.

interface MergeContext {
  employeeFirstName: string;
  surveyTitle: string;
  customerName: string;
  dueDate: string;
}

const MERGE_KEYS: Record<string, keyof MergeContext> = {
  employee_first_name: "employeeFirstName",
  survey_title: "surveyTitle",
  customer_name: "customerName",
  due_date: "dueDate",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || "there";
}

function substituteMergeTokens(text: string, ctx: MergeContext): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, key: string) => {
    const field = MERGE_KEYS[key];
    if (!field) return whole;
    return escapeHtml(ctx[field] ?? "");
  });
}

function renderCampaignEmail(
  input: { subject: string; previewText?: string | null; bodyText: string; ctaLabel: string; ctaUrl: string; senderName: string },
  ctx: MergeContext,
): { subject: string; html: string; text: string } {
  const subject = substituteMergeTokens(input.subject, ctx);
  const bodyEscaped = substituteMergeTokens(escapeHtml(input.bodyText), ctx);
  const paragraphs = bodyEscaped
    .split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 16px;line-height:1.6;color:#1f2430;">${p.replace(/\n/g, "<br />")}</p>`)
    .join("\n");
  const preview = input.previewText ? substituteMergeTokens(input.previewText, ctx) : "";
  const cta = escapeHtml(input.ctaLabel);
  const sender = escapeHtml(input.senderName);
  const safeUrl = escapeHtml(input.ctaUrl);

  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">',
    preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>` : "",
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">',
    "<tr><td align=\"center\">",
    '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">',
    `<tr><td style="padding:24px 32px 0;"><span style="display:block;margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;">${sender}</span></td></tr>`,
    `<tr><td style="padding:0 32px 8px;">${paragraphs}</td></tr>`,
    `<tr><td style="padding:8px 32px 32px;"><a href="${safeUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">${cta}</a></td></tr>`,
    "</table></td></tr></table></body></html>",
  ].filter(Boolean).join("\n");

  const text = `${bodyEscaped}\n\n${input.ctaLabel}: ${input.ctaUrl}`;
  return { subject, html, text };
}

// ── Resend ───────────────────────────────────────────────────────────────

async function sendViaResend(msg: { from: string; to: string; subject: string; html: string; text: string }):
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY is not configured for this project yet." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Resend responded ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Missing Authorization header" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const mode = body.mode as string | undefined;
  const campaignId = body.campaignId as string | undefined;
  if (!campaignId || !mode) return json({ ok: false, error: "campaignId and mode are required" }, 400);

  // Caller-scoped client: RLS and has_survey_role() apply exactly as they
  // would for this same request made directly from the browser.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  // Service-role client: bypasses RLS. Used only for work this function has
  // already independently authorised via userClient above.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: campaign, error: campErr } = await userClient
    .from("survey_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (campErr || !campaign) return json({ ok: false, error: "Campaign not found or not authorised" }, 404);

  const { data: isEditor } = await userClient.rpc("has_survey_role", { target_org_id: campaign.organization_id, minimum: "editor" });
  if (!isEditor) return json({ ok: false, error: "You need the editor role to act on this campaign" }, 403);

  // Attributed to the real acting admin, not the service role: read once
  // here from the caller's own JWT, then passed explicitly into
  // service_record_audit() below (which record_audit() itself cannot do,
  // since a service-role connection carries no JWT for it to read).
  const { data: userData } = await userClient.auth.getUser();
  const actorEmail = userData.user?.email ?? "";

  const { data: survey } = await admin.from("surveys").select("title, published, closed_at").eq("id", campaign.survey_id).maybeSingle();
  const { data: org } = await admin.from("organizations").select("name, is_active").eq("id", campaign.organization_id).maybeSingle();
  const dueDate = campaign.due_date ? new Date(campaign.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

  // ── TEST: sandbox sender is fine here regardless of the production gate -
  // a test never reaches a real employee, so it carries none of the
  // reputational/compliance risk a real bulk send from an unverified sender
  // would.
  if (mode === "test") {
    const testUrl = body.testUrl as string | undefined;
    const recipientEmail = body.recipientEmail as string | undefined;
    const testSendId = body.testSendId as string | undefined;
    if (!testUrl || !recipientEmail || !testSendId) {
      return json({ ok: false, error: "testUrl, recipientEmail and testSendId are required" }, 400);
    }

    const rendered = renderCampaignEmail(
      { subject: campaign.subject, previewText: campaign.preview_text, bodyText: campaign.body_text, ctaLabel: campaign.cta_label, ctaUrl: testUrl, senderName: campaign.sender_name },
      { employeeFirstName: "Alex", surveyTitle: survey?.title ?? "your survey", customerName: org?.name ?? "your organisation", dueDate },
    );

    const result = await sendViaResend({
      from: `${campaign.sender_name} <${campaign.sender_email}>`,
      to: recipientEmail,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
    });

    await admin.from("survey_campaign_test_sends").update({
      status: result.ok ? "SENT" : "FAILED",
      sent_at: result.ok ? new Date().toISOString() : null,
      error: result.ok ? null : result.error,
    }).eq("id", testSendId);

    if (result.ok) {
      await admin.rpc("service_record_audit", { p_organization_id: campaign.organization_id, p_actor_email: actorEmail, p_action_type: "TEST_EMAIL_SENT", p_details: { campaign_id: campaignId, recipient_email: recipientEmail } });
    }
    logEvent({
      event: "campaign_test_send", operation: "test", campaign_id: campaignId, survey_id: campaign.survey_id,
      result: result.ok ? "ok" : "provider_error", error_code: result.ok ? null : "EMAIL_PROVIDER_ERROR",
    });

    return json(result.ok ? { ok: true } : { ok: false, error: result.error });
  }

  // ── SEND / REMIND: real bulk email to real employees. Hard-gated behind
  // the production_email_domain_verified platform setting - see the
  // migration's comment on that row. This is intentionally the ONLY place
  // that gate is enforced, since this function is the only path that ever
  // calls Resend for a real recipient.
  const { data: gate } = await admin.from("platform_settings").select("value").eq("key", "production_email_domain_verified").maybeSingle();
  const verified = gate?.value === true;
  if (!verified) {
    return json({ ok: false, error: "Production email domain is not verified. Bulk employee email sending is disabled until a founder verifies a custom domain and enables this setting." }, 403);
  }

  // A real send/remind is pointless (and confusing to the recipient) once the
  // survey or its customer is no longer accepting responses - the link would
  // still be correctly rejected at submission time by resolve_invitation()/
  // submit_invited_response()'s own checks, but there is no reason to mail it
  // out in the first place. Test sends above intentionally skip this, same as
  // they skip the production-domain gate: a test never reaches a real
  // employee either way.
  if (!survey?.published || survey.closed_at) {
    return json({ ok: false, error: "This survey is closed or unpublished. Reopen it before sending or reminding." }, 409);
  }
  if (!org?.is_active) {
    return json({ ok: false, error: "This customer is deactivated. Reactivate it before sending or reminding." }, 409);
  }

  if (mode === "send") {
    // Atomic claim, not check-then-act: two "Send" clicks arriving at nearly
    // the same instant could otherwise both read status !== 'SENDING' before
    // either write landed, and both proceed to email every recipient. The
    // UPDATE ... WHERE status <> 'SENDING' ... RETURNING id is a single
    // statement Postgres serializes per row, so only one concurrent caller
    // ever gets a non-empty result back.
    const { data: claimed } = await admin
      .from("survey_campaigns")
      .update({ status: "SENDING", updated_at: new Date().toISOString() })
      .eq("id", campaignId)
      .neq("status", "SENDING")
      .select("id");
    if (!claimed || claimed.length === 0) {
      logEvent({ event: "campaign_send_conflict", operation: "send", campaign_id: campaignId, result: "already_sending" });
      return json({ ok: false, error: "This campaign is already sending." }, 409);
    }
    await admin.rpc("service_record_audit", { p_organization_id: campaign.organization_id, p_actor_email: actorEmail, p_action_type: "CAMPAIGN_STARTED", p_details: { campaign_id: campaignId } });

    // Only NOT_SENT/FAILED: a recipient already SENT/DELIVERED/QUEUED is left
    // alone, so a retried send pass never double-emails someone who already
    // succeeded, and a partial failure never has to be resolved by resending
    // everyone.
    const { data: recipients } = await admin
      .from("survey_campaign_recipients")
      .select("id, invitation_id")
      .eq("campaign_id", campaignId)
      .in("delivery_status", ["NOT_SENT", "FAILED"]);

    const sendStarted = Date.now();
    logEvent({ event: "campaign_send_started", operation: "send", campaign_id: campaignId, survey_id: campaign.survey_id, actor: actorEmail, recipient_count: recipients?.length ?? 0 });

    let sent = 0, failed = 0;
    for (const r of recipients ?? []) {
      const outcome = await sendOneRecipient(admin, campaign, survey?.title ?? "", org?.name ?? "", dueDate, r.id, r.invitation_id);
      if (outcome.ok) sent++; else {
        failed++;
        await admin.rpc("service_record_audit", { p_organization_id: campaign.organization_id, p_actor_email: actorEmail, p_action_type: "RECIPIENT_SEND_FAILED", p_details: { campaign_id: campaignId, campaign_recipient_id: r.id } });
      }
    }

    const finalStatus = failed === 0 ? "SENT" : "PARTIALLY_FAILED";
    await admin.from("survey_campaigns").update({
      status: finalStatus, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", campaignId);
    await admin.rpc("service_record_audit", { p_organization_id: campaign.organization_id, p_actor_email: actorEmail, p_action_type: finalStatus === "SENT" ? "CAMPAIGN_COMPLETED" : "CAMPAIGN_PARTIALLY_FAILED", p_details: { campaign_id: campaignId, sent, failed } });
    logEvent({
      event: "campaign_send_completed", operation: "send", campaign_id: campaignId, survey_id: campaign.survey_id,
      result: finalStatus, sent, failed, duration_ms: Date.now() - sendStarted,
    });

    return json({ ok: failed === 0, sent, failed });
  }

  if (mode === "remind") {
    // campaign_reminder_candidates is itself has_survey_role-gated on the
    // caller's own JWT, so it goes through userClient, not the service-role
    // admin client (which carries no JWT and would fail that check).
    const { data: candidates } = await userClient.rpc("campaign_reminder_candidates", { p_campaign_id: campaignId });
    const remindStarted = Date.now();
    logEvent({ event: "campaign_remind_started", operation: "remind", campaign_id: campaignId, survey_id: campaign.survey_id, actor: actorEmail, recipient_count: candidates?.length ?? 0 });

    let sent = 0, failed = 0;
    for (const c of (candidates ?? []) as { recipient_id: string; invitation_id: string }[]) {
      const outcome = await sendOneRecipient(admin, campaign, survey?.title ?? "", org?.name ?? "", dueDate, c.recipient_id, c.invitation_id);
      if (outcome.ok) sent++; else {
        failed++;
        await admin.rpc("service_record_audit", { p_organization_id: campaign.organization_id, p_actor_email: actorEmail, p_action_type: "RECIPIENT_SEND_FAILED", p_details: { campaign_id: campaignId, campaign_recipient_id: c.recipient_id, reminder: true } });
      }
    }
    await admin.rpc("service_record_audit", { p_organization_id: campaign.organization_id, p_actor_email: actorEmail, p_action_type: "REMINDER_SENT", p_details: { campaign_id: campaignId, sent, failed } });
    logEvent({
      event: "campaign_remind_completed", operation: "remind", campaign_id: campaignId, survey_id: campaign.survey_id,
      result: failed === 0 ? "ok" : "partial_failure", sent, failed, duration_ms: Date.now() - remindStarted,
    });
    return json({ ok: failed === 0, sent, failed });
  }

  return json({ ok: false, error: `Unknown mode "${mode}"` }, 400);
});

// deno-lint-ignore no-explicit-any
async function sendOneRecipient(
  admin: ReturnType<typeof createClient>,
  campaign: any, surveyTitle: string, customerName: string, dueDate: string,
  recipientId: string, invitationId: string,
): Promise<{ ok: boolean }> {
  // service_regenerate_invitation is service_role-only (see migration): a
  // fresh raw token is required here because build_campaign_recipients
  // already discarded whatever token issue_invitations produced earlier -
  // "a token nobody has looked at yet should not exist outside the database"
  // applies just as much to a not-yet-sent campaign as to the Audience page.
  const started = Date.now();
  const { data: regen, error: regenErr } = await admin.rpc("service_regenerate_invitation", { p_invitation_id: invitationId });
  const row = (regen as { employee_id: string; token: string }[] | null)?.[0];
  if (regenErr || !row) {
    await logFailure(admin, recipientId, regenErr?.message ?? "Could not generate a link for this recipient");
    logEvent({ event: "recipient_send_failed", campaign_id: campaign.id, recipient_id: recipientId, result: "error", error_code: "INVALID_STATE", duration_ms: Date.now() - started });
    return { ok: false };
  }

  const { data: employee } = await admin.from("employees").select("employee_name, email").eq("id", row.employee_id).maybeSingle();
  if (!employee?.email) {
    await logFailure(admin, recipientId, "No email address on file for this employee");
    logEvent({ event: "recipient_send_failed", campaign_id: campaign.id, recipient_id: recipientId, result: "error", error_code: "VALIDATION_ERROR", duration_ms: Date.now() - started });
    return { ok: false };
  }

  const ctaUrl = `${Deno.env.get("PUBLIC_APP_ORIGIN") ?? ""}/r/${row.token}`;
  const rendered = renderCampaignEmail(
    { subject: campaign.subject, previewText: campaign.preview_text, bodyText: campaign.body_text, ctaLabel: campaign.cta_label, ctaUrl, senderName: campaign.sender_name },
    { employeeFirstName: firstNameOf(employee.employee_name), surveyTitle, customerName, dueDate },
  );

  const result = await sendViaResend({
    from: `${campaign.sender_name} <${campaign.sender_email}>`,
    to: employee.email, subject: rendered.subject, html: rendered.html, text: rendered.text,
  });

  const now = new Date().toISOString();
  await admin.from("survey_campaign_recipients").update({
    delivery_status: result.ok ? "SENT" : "FAILED",
    sent_at: result.ok ? now : null,
    failed_at: result.ok ? null : now,
    last_error: result.ok ? null : result.error,
    updated_at: now,
  }).eq("id", recipientId);

  await admin.from("survey_email_events").insert({
    campaign_recipient_id: recipientId,
    event_type: result.ok ? "SENT" : "FAILED",
    detail: result.ok ? null : result.error,
  });

  logEvent({
    event: "recipient_send_completed", campaign_id: campaign.id, recipient_id: recipientId,
    result: result.ok ? "ok" : "provider_error", error_code: result.ok ? null : "EMAIL_PROVIDER_ERROR",
    duration_ms: Date.now() - started,
  });

  return { ok: result.ok };
}

async function logFailure(admin: ReturnType<typeof createClient>, recipientId: string, message: string): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("survey_campaign_recipients").update({ delivery_status: "FAILED", failed_at: now, last_error: message, updated_at: now }).eq("id", recipientId);
  await admin.from("survey_email_events").insert({ campaign_recipient_id: recipientId, event_type: "FAILED", detail: message });
}
