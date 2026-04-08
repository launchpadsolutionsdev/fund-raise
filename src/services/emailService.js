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
<body style="margin:0;padding:0;background:#EFF1F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:580px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,34,61,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1A223D 0%,#2A2E8A 50%,#3434D6 100%);padding:32px 36px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
        <td style="vertical-align:middle;">
          <!--[if mso]><table cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;vertical-align:middle;"><![endif]-->
          <div style="display:inline-block;vertical-align:middle;width:28px;height:28px;margin-right:10px;">
            <table cellpadding="0" cellspacing="0" border="0" style="width:28px;height:28px;"><tr>
              <td style="width:0;height:0;border-left:14px solid rgba(255,255,255,0.95);border-right:14px solid transparent;border-bottom:14px solid transparent;border-top:0;line-height:0;font-size:0;"></td>
            </tr><tr>
              <td style="width:0;height:0;border-left:14px solid rgba(255,255,255,0.7);border-right:14px solid rgba(255,255,255,0.85);border-top:14px solid transparent;border-bottom:0;line-height:0;font-size:0;"></td>
            </tr></table>
          </div>
          <!--[if mso]></td><td style="vertical-align:middle;"><![endif]-->
          <span style="display:inline-block;vertical-align:middle;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.4px;">Fund-Raise</span>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr></table>
    </div>
    <!-- Accent strip -->
    <div style="height:3px;background:linear-gradient(90deg,#1960F9 0%,#0D8CFF 40%,#12DEFF 70%,#29C8F9 100%);"></div>
    <!-- Body -->
    <div style="padding:36px 36px 32px;">
      ${content}
    </div>
    <!-- Footer -->
    <div style="padding:24px 36px;background:#F8F9FB;border-top:1px solid #E5E7EB;">
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
        <td style="text-align:center;">
          <div style="font-size:13px;font-weight:600;color:#1A223D;letter-spacing:-0.2px;margin-bottom:6px;">
            <a href="${APP_URL}" style="color:#1A223D;text-decoration:none;">Fund-Raise</a>
          </div>
          <div style="font-size:11px;color:#9CA3AF;line-height:1.5;">
            Fundraising intelligence for RE&nbsp;NXT foundations<br>
            <a href="${APP_URL}" style="color:#3434D6;text-decoration:none;">fund-raise.ca</a>
          </div>
        </td>
      </tr></table>
    </div>
  </div>
  <!-- Outer footer -->
  <div style="text-align:center;padding:16px 20px 32px;font-size:11px;color:#9CA3AF;">
    You're receiving this because you have an account on Fund-Raise.<br>
    &copy; ${new Date().getFullYear()} Fund-Raise &middot; Launchpad Solutions
  </div>
</body>
</html>`;
}

// ── Shared styles ────────────────────────────────────────────────────

const S = {
  heading: 'margin:0 0 10px;font-size:22px;font-weight:700;color:#1A223D;letter-spacing:-0.3px;line-height:1.3;',
  subheading: 'margin:0 0 6px;font-size:13px;font-weight:600;color:#3434D6;text-transform:uppercase;letter-spacing:0.5px;',
  body: 'font-size:15px;color:#4B5563;line-height:1.75;margin:0 0 24px;',
  bodyLast: 'font-size:15px;color:#4B5563;line-height:1.75;margin:0;',
  btn: 'display:inline-block;background:linear-gradient(135deg,#1960F9 0%,#3434D6 100%);color:#ffffff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.2px;mso-padding-alt:14px 32px;',
  btnWrap: 'margin:28px 0 0;',
  stat: (bg, border, color) => `background:${bg};border:1px solid ${border};border-radius:12px;padding:20px 24px;margin:0 0 24px;`,
  statNum: (color) => `font-size:28px;font-weight:700;color:${color};letter-spacing:-0.5px;line-height:1.2;`,
  statLabel: 'font-size:13px;color:#6B7280;margin-top:4px;',
  featureRow: 'font-size:14px;color:#4B5563;line-height:1.6;padding:8px 0;border-bottom:1px solid #F3F4F6;',
  featureIcon: 'display:inline-block;width:20px;text-align:center;margin-right:8px;font-size:14px;',
  muted: 'font-size:12px;color:#9CA3AF;line-height:1.6;margin:24px 0 0;',
};

// ── Email types ──────────────────────────────────────────────────────

/**
 * Send a team invitation email.
 */
async function sendInvitation({ to, inviterName, orgName, role, token }) {
  const joinUrl = `${APP_URL}/auth/accept-invite?token=${token}`;
  const html = wrapHtml(`
    <p style="${S.subheading}">You've been invited</p>
    <h2 style="${S.heading}">Join ${escapeHtml(orgName)} on Fund-Raise</h2>
    <p style="${S.body}">
      ${escapeHtml(inviterName)} wants you on the team. As a <strong>${escapeHtml(role)}</strong>, you'll get instant access to real-time fundraising dashboards, AI-powered analytics, and tools that replace hours of manual Blackbaud reporting.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px;">
      <tr>
        <td style="${S.featureRow}"><span style="${S.featureIcon}">&#9679;</span> <strong>30+ dashboards</strong> with live RE&nbsp;NXT data</td>
      </tr>
      <tr>
        <td style="${S.featureRow}"><span style="${S.featureIcon}">&#9679;</span> <strong>Ask Fund-Raise</strong> — your AI fundraising analyst</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#4B5563;line-height:1.6;padding:8px 0;"><span style="${S.featureIcon}">&#9679;</span> Board reports, donor letters, and impact stories on demand</td>
      </tr>
    </table>
    <div style="${S.btnWrap}">
      <a href="${joinUrl}" style="${S.btn}">Accept &amp; Get Started &#8594;</a>
    </div>
    <p style="${S.muted}">
      This invitation expires in 7&nbsp;days. You'll sign in securely with Google.<br>
      Didn't expect this? No action needed — this link will simply expire.
    </p>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `${inviterName} invited you to ${orgName} on Fund-Raise`,
    text: `${inviterName} invited you to join ${orgName} on Fund-Raise as a ${role}. You'll get access to 30+ fundraising dashboards, AI analytics, and automated reporting. Accept here: ${joinUrl}`,
    html,
  });
}

/**
 * Send a welcome email on first login.
 */
async function sendWelcome({ to, userName, orgName }) {
  const dashboardUrl = `${APP_URL}/crm-dashboard`;
  const name = escapeHtml(userName || 'there');
  const html = wrapHtml(`
    <p style="${S.subheading}">Welcome aboard</p>
    <h2 style="${S.heading}">You're in, ${name}.</h2>
    <p style="${S.body}">
      You've joined <strong>${escapeHtml(orgName)}</strong> on Fund-Raise. Your entire Blackbaud RE&nbsp;NXT analytics stack — dashboards, reports, donor insights — is ready to go. No setup required.
    </p>
    <div style="background:#F0F4FF;border:1px solid #DBEAFE;border-radius:12px;padding:24px;margin:0 0 28px;">
      <div style="font-size:14px;font-weight:600;color:#1A223D;margin-bottom:12px;">Here's what you can do right now:</div>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td style="padding:6px 0;font-size:14px;color:#4B5563;line-height:1.5;">
            <strong style="color:#1960F9;">Explore dashboards</strong> — 30+ views covering giving trends, donor retention, campaign performance, and fund analytics
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:14px;color:#4B5563;line-height:1.5;">
            <strong style="color:#1960F9;">Ask Fund-Raise</strong> — get instant answers like "Who are our top 20 lapsed donors?" or "Show giving by campaign this quarter"
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:14px;color:#4B5563;line-height:1.5;">
            <strong style="color:#1960F9;">Generate reports</strong> — board decks, thank-you letters, and impact stories in seconds, not hours
          </td>
        </tr>
      </table>
    </div>
    <div style="${S.btnWrap}">
      <a href="${dashboardUrl}" style="${S.btn}">Open Your Dashboard &#8594;</a>
    </div>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `Welcome to Fund-Raise, ${userName || 'there'} — your dashboard is ready`,
    text: `Welcome to Fund-Raise! You've joined ${orgName}. Your 30+ fundraising dashboards, AI analyst, and reporting tools are ready. Go to your dashboard: ${dashboardUrl}`,
    html,
  });
}

/**
 * Send CRM import completion notification.
 */
async function sendImportComplete({ to, userName, orgName, giftCount, duration }) {
  const dashUrl = `${APP_URL}/crm-dashboard`;
  const count = (giftCount || 0).toLocaleString();
  const name = escapeHtml(userName || 'there');
  const html = wrapHtml(`
    <p style="${S.subheading}">Import complete</p>
    <h2 style="${S.heading}">Your data is live, ${name}.</h2>
    <p style="${S.body}">
      The CRM import for <strong>${escapeHtml(orgName)}</strong> finished successfully. Every gift has been processed, classified, and is already powering your dashboards.
    </p>
    <div style="${S.stat('#F0FDF4', '#BBF7D0', '#16A34A')}">
      <div style="${S.statNum('#16A34A')}">${count} gifts</div>
      <div style="${S.statLabel}">imported and analyzed${duration ? ' in ' + duration : ''}</div>
    </div>
    <p style="${S.body}">
      Donor segments, giving trends, and campaign analytics have all been updated. Your AI assistant already knows about the new data — try asking it a question.
    </p>
    <div style="${S.btnWrap}">
      <a href="${dashUrl}" style="${S.btn}">See Your Updated Dashboard &#8594;</a>
    </div>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `Import complete — ${count} gifts now in Fund-Raise`,
    text: `Your CRM import for ${orgName} is complete. ${count} gifts imported and analyzed${duration ? ' in ' + duration : ''}. Your dashboards are updated: ${dashUrl}`,
    html,
  });
}

/**
 * Send API quota warning email (to all admins).
 */
async function sendQuotaWarning({ to, orgName, usagePercent, count, limit }) {
  const settingsUrl = `${APP_URL}/organization`;
  const html = wrapHtml(`
    <p style="${S.subheading}">Heads up</p>
    <h2 style="${S.heading}">Blackbaud API usage at ${usagePercent}%</h2>
    <p style="${S.body}">
      <strong>${escapeHtml(orgName)}</strong> is approaching today's Blackbaud SKY API quota. This is informational — no action is required right now.
    </p>
    <div style="${S.stat('#FEFCE8', '#FDE68A', '#D97706')}">
      <div style="${S.statNum('#D97706')}">${count} / ${limit}</div>
      <div style="${S.statLabel}">API calls used today</div>
      <div style="margin-top:12px;background:#FDE68A;border-radius:50px;height:6px;overflow:hidden;">
        <div style="background:linear-gradient(90deg,#F59E0B,#D97706);height:6px;width:${Math.min(usagePercent, 100)}%;border-radius:50px;"></div>
      </div>
    </div>
    <p style="${S.bodyLast}">
      The quota resets automatically at midnight. If the limit is reached, new Blackbaud API requests will pause until tomorrow — but your existing dashboards and Ask Fund-Raise will continue working with cached data.
    </p>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `API usage at ${usagePercent}% — ${orgName}`,
    text: `Your Blackbaud API usage for ${orgName} is at ${usagePercent}% (${count}/${limit}). Quota resets at midnight. Your dashboards continue working with cached data.`,
    html,
  });
}

/**
 * Notify admins when a user accepts an invitation.
 */
async function sendInviteAccepted({ to, newUserName, newUserEmail, orgName }) {
  const teamUrl = `${APP_URL}/organization`;
  const displayName = escapeHtml(newUserName || newUserEmail);
  const html = wrapHtml(`
    <p style="${S.subheading}">Team update</p>
    <h2 style="${S.heading}">${displayName} just joined ${escapeHtml(orgName)}</h2>
    <p style="${S.body}">
      Your invitation was accepted. <strong>${displayName}</strong> now has access to Fund-Raise and can start exploring dashboards, running queries, and generating reports immediately.
    </p>
    <div style="background:#F0F4FF;border:1px solid #DBEAFE;border-radius:12px;padding:20px 24px;margin:0 0 24px;">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:44px;height:44px;background:linear-gradient(135deg,#1960F9,#3434D6);border-radius:50%;text-align:center;vertical-align:middle;">
          <span style="font-size:18px;font-weight:700;color:#fff;line-height:44px;">${(newUserName || newUserEmail || '?').charAt(0).toUpperCase()}</span>
        </td>
        <td style="padding-left:16px;">
          <div style="font-size:15px;font-weight:600;color:#1A223D;">${displayName}</div>
          <div style="font-size:13px;color:#6B7280;">${escapeHtml(newUserEmail || '')}</div>
        </td>
      </tr></table>
    </div>
    <div style="${S.btnWrap}">
      <a href="${teamUrl}" style="${S.btn}">Manage Your Team &#8594;</a>
    </div>
  `);

  return getTransporter().sendMail({
    from: FROM,
    to,
    subject: `${newUserName || newUserEmail} joined ${orgName} on Fund-Raise`,
    text: `${newUserName || newUserEmail} accepted your invitation and joined ${orgName}. They now have full access to Fund-Raise. Manage your team: ${teamUrl}`,
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
  // Exposed for email preview
  _wrapHtml: wrapHtml,
  _escapeHtml: escapeHtml,
  _APP_URL: APP_URL,
};
