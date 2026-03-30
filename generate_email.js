#!/usr/bin/env node
/**
 * generate_email.js — Daily email digest for AllFreeAlerts
 *
 * Reads data/results.json, picks top deals from each category,
 * generates a branded HTML email, and sends via Brevo campaign API.
 *
 * Usage:
 *   node generate_email.js             # Send to list
 *   node generate_email.js --dry-run   # Save to email_preview.html only
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY_RUN = process.argv.includes('--dry-run');
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_LIST_ID = 2;
const SENDER_NAME = 'AllFreeAlerts';
const SENDER_EMAIL = 'contact@allfreealerts.com';
const SITE_URL = 'https://allfreealerts.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[email] ${msg}`);
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d)) return str; // return raw string if unparseable
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Try to extract a dollar value from text like "$5,000", "worth $3,250", "$375 - $4,500"
 * Returns the highest number found, or 0.
 */
function extractValue(text) {
  if (!text) return 0;
  const matches = text.match(/\$[\d,]+/g);
  if (!matches) return 0;
  return Math.max(...matches.map(m => parseInt(m.replace(/[$,]/g, ''), 10)));
}

/**
 * Parse a deadline string into a Date for sorting.
 * Handles formats like "3/31/27", "March 31, 2026", "1/1/28", etc.
 */
function parseDeadline(str) {
  if (!str) return null;
  // Try M/D/YY format
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, parseInt(slashMatch[1], 10) - 1, parseInt(slashMatch[2], 10));
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// ---------------------------------------------------------------------------
// Deal selection
// ---------------------------------------------------------------------------

function loadDeals() {
  const filePath = path.join(__dirname, 'data', 'results.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function pickDeals(allDeals) {
  const todayStr = today();

  // Sweepstakes — newest first, then highest value as tiebreaker
  const sweeps = allDeals
    .filter(d => d.category === 'Sweepstakes')
    .sort((a, b) => {
      const dateA = a.date_found || '';
      const dateB = b.date_found || '';
      if (dateB !== dateA) return dateB.localeCompare(dateA);
      return extractValue(b.prize_summary) - extractValue(a.prize_summary);
    })
    .slice(0, 3);

  // Freebies — newest first
  const freebies = allDeals
    .filter(d => d.category === 'Freebies')
    .sort((a, b) => {
      const dateA = a.date_found || '';
      const dateB = b.date_found || '';
      return dateB.localeCompare(dateA);
    })
    .slice(0, 3);

  // Settlements — ending soonest (with a deadline in the future)
  const now = new Date();
  const settlements = allDeals
    .filter(d => d.category === 'Settlements')
    .map(d => ({ ...d, _deadline: parseDeadline(d.deadline) }))
    .filter(d => d._deadline && d._deadline > now)
    .sort((a, b) => a._deadline - b._deadline)
    .slice(0, 3);

  // Ending Soon — any category, expiring within 7 days
  const endingSoon = allDeals
    .map(d => ({ ...d, _deadline: parseDeadline(d.deadline || d.end_date) }))
    .filter(d => {
      if (!d._deadline || d._deadline <= now) return false;
      const daysLeft = Math.ceil((d._deadline - now) / 86400000);
      return daysLeft <= 7 && daysLeft >= 0;
    })
    .sort((a, b) => a._deadline - b._deadline)
    .slice(0, 3);

  return { sweeps, freebies, settlements, endingSoon };
}

function countNewToday(allDeals) {
  const todayStr = today();
  return allDeals.filter(d => d.date_found === todayStr).length;
}

// ---------------------------------------------------------------------------
// HTML email generation
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function categoryBadge(category) {
  const colors = {
    Sweepstakes: { bg: '#0ABAB5', text: '#ffffff' },
    Freebies:    { bg: '#FF6F3C', text: '#ffffff' },
    Settlements: { bg: '#F5A623', text: '#ffffff' },
  };
  const c = colors[category] || { bg: '#888888', text: '#ffffff' };
  return `<span style="display:inline-block;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(category)}</span>`;
}

function dealCard(deal) {
  const title = escapeHtml(deal.title);
  const link = escapeHtml(deal.link);
  const category = deal.category;

  // Build meta line
  const meta = [];
  if (deal.payout) meta.push(`<strong>Payout:</strong> ${escapeHtml(deal.payout)}`);
  if (deal.prize_summary) {
    const val = extractValue(deal.prize_summary);
    if (val > 0) meta.push(`<strong>Value:</strong> $${val.toLocaleString()}`);
  }
  if (deal.deadline) meta.push(`<strong>Deadline:</strong> ${escapeHtml(deal.deadline)}`);
  if (deal.end_date) meta.push(`<strong>Ends:</strong> ${escapeHtml(deal.end_date)}`);

  // Short description
  let desc = '';
  if (deal.description) {
    desc = escapeHtml(deal.description.length > 140 ? deal.description.slice(0, 137) + '...' : deal.description);
  } else if (deal.prize_summary) {
    desc = escapeHtml(deal.prize_summary.length > 140 ? deal.prize_summary.slice(0, 137) + '...' : deal.prize_summary);
  }

  return `
    <tr><td style="padding:0 0 16px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e8e8e8;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:20px 24px;">
          <div style="margin-bottom:8px;">${categoryBadge(category)}</div>
          <h3 style="margin:0 0 6px 0;font-size:17px;color:#1a1a1a;line-height:1.3;">${title}</h3>
          ${desc ? `<p style="margin:0 0 10px 0;font-size:14px;color:#555555;line-height:1.5;">${desc}</p>` : ''}
          ${meta.length ? `<p style="margin:0 0 14px 0;font-size:13px;color:#777777;line-height:1.6;">${meta.join(' &nbsp;|&nbsp; ')}</p>` : ''}
          <a href="${link}" target="_blank" style="display:inline-block;background:#0ABAB5;color:#ffffff;font-size:14px;font-weight:600;padding:10px 24px;border-radius:6px;text-decoration:none;">View Deal &rarr;</a>
        </td></tr>
      </table>
    </td></tr>`;
}

function sectionHeader(title, emoji) {
  return `
    <tr><td style="padding:24px 0 8px 0;">
      <h2 style="margin:0;font-size:20px;color:#1a1a1a;font-weight:700;">${emoji} ${escapeHtml(title)}</h2>
    </td></tr>`;
}

function endingSoonCard(deal) {
  const title = escapeHtml(deal.title);
  const link = escapeHtml(deal.link);
  const daysLeft = deal._deadline ? Math.ceil((deal._deadline - new Date()) / 86400000) : '?';
  const urgencyColor = daysLeft <= 2 ? '#FF6B6B' : '#FF6F3C';

  return `
    <tr><td style="padding:0 0 10px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid ${urgencyColor}33;border-radius:8px;">
        <tr><td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:14px;font-weight:700;color:#1a1a1a;line-height:1.3;">${title}</td>
              <td style="width:80px;text-align:right;"><span style="display:inline-block;background:${urgencyColor};color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;">${daysLeft}d left</span></td>
            </tr>
          </table>
          <a href="${link}" target="_blank" style="font-size:13px;color:#0ABAB5;font-weight:600;text-decoration:none;">Claim now &rarr;</a>
        </td></tr>
      </table>
    </td></tr>`;
}

function generateEmailHtml(sweeps, freebies, settlements, endingSoon, newCount, totalDeals) {
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AllFreeAlerts Daily Digest</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

        <!-- HEADER -->
        <tr><td style="background:linear-gradient(135deg,#0ABAB5 0%,#089E9A 100%);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="margin:0 0 4px 0;font-size:28px;color:#ffffff;font-weight:800;letter-spacing:-0.5px;">AllFreeAlerts</h1>
          <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.9);font-weight:400;">Free Stuff, Found For You</p>
        </td></tr>

        <!-- DATE BAR -->
        <tr><td style="background:#ffffff;padding:14px 24px;border-bottom:1px solid #eeeeee;">
          <p style="margin:0;font-size:13px;color:#888888;text-align:center;">${escapeHtml(dateStr)}${newCount > 0 ? ` &mdash; <strong style="color:#FF6F3C;">${newCount} new deal${newCount === 1 ? '' : 's'} today</strong>` : ''}</p>
        </td></tr>

        <!-- BODY -->
        <tr><td style="background:#fafafa;padding:8px 24px 32px 24px;border-radius:0 0 12px 12px;">

          <!-- ENDING SOON -->
          ${endingSoon.length ? `
          <tr><td style="padding:20px 0 8px 0;">
            <h2 style="margin:0 0 4px 0;font-size:20px;color:#FF6B6B;font-weight:700;">🔥 Ending Soon</h2>
            <p style="margin:0;font-size:13px;color:#888;">Don't miss these — expiring in the next few days</p>
          </td></tr>
          ${endingSoon.map(endingSoonCard).join('\n')}` : ''}

          <!-- ACTIVE DEALS COUNT -->
          <tr><td style="padding:16px 0 8px 0;text-align:center;">
            <p style="margin:0;font-size:14px;color:#555;"><strong style="color:#0ABAB5;font-size:22px;">${totalDeals.toLocaleString()}</strong> active deals on the site right now</p>
          </td></tr>

          <!-- SWEEPSTAKES -->
          ${sweeps.length ? sectionHeader('Top Sweepstakes', '🏆') : ''}
          ${sweeps.map(dealCard).join('\n')}

          <!-- FREEBIES -->
          ${freebies.length ? sectionHeader('Free Stuff', '🎁') : ''}
          ${freebies.map(dealCard).join('\n')}

          <!-- SETTLEMENTS -->
          ${settlements.length ? sectionHeader('Settlements Ending Soon', '⚖️') : ''}
          ${settlements.map(dealCard).join('\n')}

          <!-- CTA -->
          <tr><td style="padding:32px 0 8px 0;text-align:center;">
            <a href="${SITE_URL}" target="_blank" style="display:inline-block;background:#FF6F3C;color:#ffffff;font-size:16px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;">See All Deals on AllFreeAlerts &rarr;</a>
          </td></tr>

        </td></tr>

        <!-- FOOTER -->
        <tr><td style="padding:24px;text-align:center;">
          <p style="margin:0 0 8px 0;font-size:12px;color:#aaaaaa;line-height:1.6;">
            You're receiving this because you subscribed at <a href="${SITE_URL}" style="color:#0ABAB5;text-decoration:none;">allfreealerts.com</a>.
          </p>
          <p style="margin:0;font-size:12px;color:#aaaaaa;">
            <a href="{{ unsubscribe }}" style="color:#aaaaaa;text-decoration:underline;">Unsubscribe</a> &nbsp;|&nbsp;
            <a href="${SITE_URL}/privacy.html" style="color:#aaaaaa;text-decoration:underline;">Privacy Policy</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Brevo API
// ---------------------------------------------------------------------------

function brevoRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    if (!BREVO_API_KEY) {
      return reject(new Error('BREVO_API_KEY environment variable is not set'));
    }
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: apiPath,
      method,
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(responseBody); } catch { parsed = responseBody; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`Brevo API ${res.statusCode}: ${JSON.stringify(parsed)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function createAndSendCampaign(subject, htmlContent) {
  const scheduledAt = new Date(Date.now() + 60 * 1000).toISOString(); // now + 1 min
  const campaignName = `Daily Digest - ${today()}`;

  log(`Creating campaign: "${campaignName}"`);

  const campaign = await brevoRequest('POST', '/v3/emailCampaigns', {
    name: campaignName,
    subject,
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    type: 'classic',
    htmlContent,
    recipients: { listIds: [BREVO_LIST_ID] },
    scheduledAt,
  });

  const campaignId = campaign.id;
  log(`Campaign created with ID: ${campaignId}`);

  log('Sending campaign now...');
  await brevoRequest('POST', `/v3/emailCampaigns/${campaignId}/sendNow`, {});
  log('Campaign sent successfully!');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('Loading deals from data/results.json...');
  const allDeals = loadDeals();
  log(`Loaded ${allDeals.length} total deals`);

  const { sweeps, freebies, settlements, endingSoon } = pickDeals(allDeals);
  log(`Selected: ${sweeps.length} sweepstakes, ${freebies.length} freebies, ${settlements.length} settlements, ${endingSoon.length} ending soon`);

  const newCount = countNewToday(allDeals);
  log(`New deals found today: ${newCount}`);

  const subject = `🎁 ${newCount} new deal${newCount === 1 ? '' : 's'} today — AllFreeAlerts`;
  const html = generateEmailHtml(sweeps, freebies, settlements, endingSoon, newCount, allDeals.length);

  if (DRY_RUN) {
    const previewPath = path.join(__dirname, 'email_preview.html');
    fs.writeFileSync(previewPath, html, 'utf-8');
    log(`Dry run — email preview saved to ${previewPath}`);
    log(`Subject: ${subject}`);
    log('Open email_preview.html in a browser to review.');
  } else {
    await createAndSendCampaign(subject, html);
  }

  log('Done.');
}

main().catch(err => {
  console.error('[email] ERROR:', err.message || err);
  process.exit(1);
});
