/**
 * Email Service
 *
 * Handles all outbound email for Fund-Raise using Nodemailer.
 * Supports SMTP (SendGrid, Mailgun, etc.) via env vars:
 *
 *   SMTP_HOST       (e.g. smtp.sendgrid.net)
 *   SMTP_PORT       (default: 587)
 *   SMTP_USER       (e.g. apikey for SendGrid)
 *   SMTP_PASS       (the API key or password)
 *   SMTP_FROM       (e.g. "Fund-Raise <noreply@fund-raise.ca>")
 *
 * If SMTP_HOST is not set, emails are logged to console (dev mode).
 */

const nodemailer = require('nodemailer');

const APP_URL = process.env.APP_URL || 'https://fund-raise.onrender.com';
const FROM = process.env.SMTP_FROM || 'Fund-Raise <noreply@fund-raise.ca>';

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Dev fallback — log to console
    transporter = {
      sendMail: async (opts) => {
        console.log('[EMAIL-DEV] To:', opts.to);
        console.log('[EMAIL-DEV] Subject:', opts.subject);
        console.log('[EMAIL-DEV] Body preview:', opts.text?.substring(0, 200));
        return { messageId: 'dev-' + Date.now() };
      },
    };
  }

  return transporter;
}

// ── Shared HTML wrapper ──────────────────────────────────────────────

function wrapHtml(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
    <div style="background:linear-gradient(135deg,#1A223D 0%,#3434D6 100%);padding:28px 32px;">
      <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Fund-Raise</div>
    </div>
    <div style="padding:32px;">
      ${content}
    </div>
    <div style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
      <a href="${APP_URL}" style="color:#3434D6;text-decoration:none;">fund-raise.ca</a> &middot; Fundraising intelligence for RE&nbsp;NXT foundations
    </div>
  </div>
</body>
</html>`;
}

// ── Email types ──────────────────────────────────────────────────────

/**
 * Send a team invitation email.
 */
async function sendInvitation({ to, inviterName, orgName, role, token }) {
  const joinUrl = `${APP_URL}/auth/accept-invite?token=${token}`;
  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">You're invited to ${escapeHtml(orgName)}</h2>
    <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0 0 24px;">
      ${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(orgName)}</strong> on Fund-Raise as a <strong>${escapeHtml(role)}</strong>.
    </p>
    <a href="${joinUrl}" style="display:inline-block;background:linear-gradient(135deg,#3434D6,#1A223D);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      Accept Invitation
    </a>
    <p style="font-size:12px;color:#9ca3af;margin:24px 0 0;line-height:1.6;">
      This invitation expires in 7 days. You'll sign in with your Google account.<br>
      If you weren't expecting this, you can safely ignore this email.
    </p>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `${inviterName} invited you to ${orgName} on Fund-Raise`,
    text: `${inviterName} invited you to join ${orgName} on Fund-Raise as a ${role}. Accept here: ${joinUrl}`,
    html,
  });
}

/**
 * Send a welcome email on first login.
 */
async function sendWelcome({ to, userName, orgName }) {
  const dashboardUrl = `${APP_URL}/crm-dashboard`;
  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">Welcome to Fund-Raise!</h2>
    <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(userName || 'there')}, you've successfully joined <strong>${escapeHtml(orgName)}</strong>. Here's what you can do:
    </p>
    <ul style="font-size:14px;color:#4b5563;line-height:2;padding-left:20px;margin:0 0 24px;">
      <li>Explore <strong>30+ dashboards</strong> with real-time fundraising analytics</li>
      <li>Ask questions with <strong>Ask Fund-Raise</strong>, your AI assistant</li>
      <li>Generate board reports, thank-you letters, and impact stories</li>
    </ul>
    <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(135deg,#3434D6,#1A223D);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      Go to Dashboard
    </a>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `Welcome to Fund-Raise, ${userName || 'there'}!`,
    text: `Welcome to Fund-Raise! You've joined ${orgName}. Go to your dashboard: ${dashboardUrl}`,
    html,
  });
}

/**
 * Send CRM import completion notification.
 */
async function sendImportComplete({ to, userName, orgName, giftCount, duration }) {
  const dashUrl = `${APP_URL}/crm-dashboard`;
  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">CRM Import Complete</h2>
    <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0 0 16px;">
      Hi ${escapeHtml(userName || 'there')}, your data import for <strong>${escapeHtml(orgName)}</strong> has finished.
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 24px;">
      <div style="font-size:24px;font-weight:700;color:#16a34a;">${(giftCount || 0).toLocaleString()} gifts</div>
      <div style="font-size:13px;color:#4b5563;">imported successfully${duration ? ' in ' + duration : ''}</div>
    </div>
    <a href="${dashUrl}" style="display:inline-block;background:linear-gradient(135deg,#3434D6,#1A223D);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      View Dashboard
    </a>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `CRM import complete — ${(giftCount || 0).toLocaleString()} gifts imported`,
    text: `Your CRM import for ${orgName} is complete. ${(giftCount || 0).toLocaleString()} gifts imported. View: ${dashUrl}`,
    html,
  });
}

/**
 * Send API quota warning email (to all admins).
 */
async function sendQuotaWarning({ to, orgName, usagePercent, count, limit }) {
  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">Blackbaud API Quota Warning</h2>
    <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0 0 16px;">
      Your organization <strong>${escapeHtml(orgName)}</strong> has used <strong>${usagePercent}%</strong> of today's Blackbaud API quota.
    </p>
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:0 0 24px;">
      <div style="font-size:24px;font-weight:700;color:#d97706;">${count} / ${limit}</div>
      <div style="font-size:13px;color:#4b5563;">API calls used today</div>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;">
      The quota resets at midnight. If the limit is reached, Blackbaud API requests will be paused until tomorrow.
    </p>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `Blackbaud API quota at ${usagePercent}% — ${orgName}`,
    text: `Your Blackbaud API usage is at ${usagePercent}% (${count}/${limit}). Quota resets at midnight.`,
    html,
  });
}

/**
 * Notify admins when a user accepts an invitation.
 */
async function sendInviteAccepted({ to, newUserName, newUserEmail, orgName }) {
  const teamUrl = `${APP_URL}/organization`;
  const html = wrapHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">New team member joined</h2>
    <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0 0 24px;">
      <strong>${escapeHtml(newUserName || newUserEmail)}</strong> has accepted your invitation and joined <strong>${escapeHtml(orgName)}</strong>.
    </p>
    <a href="${teamUrl}" style="display:inline-block;background:linear-gradient(135deg,#3434D6,#1A223D);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      Manage Team
    </a>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `${newUserName || newUserEmail} joined ${orgName}`,
    text: `${newUserName || newUserEmail} accepted your invitation and joined ${orgName}.`,
    html,
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  sendInvitation,
  sendWelcome,
  sendImportComplete,
  sendQuotaWarning,
  sendInviteAccepted,
};
