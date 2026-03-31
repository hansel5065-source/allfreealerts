#!/usr/bin/env node
/**
 * AllFreeAlerts — RSS Feed Generator
 * Generates RSS 2.0 feed from data.json for use with Zapier/IFTTT → X/Twitter
 * Run: node generate_rss.js
 * Output: site/rss.xml
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://allfreealerts.com';
const FEED_TITLE = 'AllFreeAlerts — Free Stuff, Sweepstakes & Settlements';
const FEED_DESC = 'Daily verified freebies, sweepstakes, and class action settlements. Updated every day.';

function escapeXml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Build tweet-ready description for each item
function buildTweetText(item) {
  const cat = item.category || 'Freebies';
  const emoji = cat === 'Sweepstakes' ? '🎉' : cat === 'Settlements' ? '💰' : '🆓';
  const label = cat === 'Sweepstakes' ? 'SWEEPSTAKES' : cat === 'Settlements' ? 'SETTLEMENT' : 'FREE';

  let text = `${emoji} ${label}: ${item.title}`;

  if (cat === 'Sweepstakes' && item.prize_summary) {
    text += `\n\n${item.prize_summary.slice(0, 100)}`;
  } else if (cat === 'Settlements' && item.prize_summary) {
    text += `\n\n${item.prize_summary.slice(0, 100)}`;
    if (item.proof_required === 'No') text += '\n✅ No proof needed!';
  } else if (cat === 'Freebies') {
    text += '\n\nNo purchase necessary!';
  }

  text += `\n\n👉 ${SITE_URL}`;
  text += '\n📸 IG · 👤 FB · 🦋 Bluesky → @allfreealerts';
  text += '\n#allfreealerts #freestuff #sweepstakes #settlements';

  // Keep under 280 chars for X
  if (text.length > 280) {
    text = text.slice(0, 276) + '...';
  }

  return text;
}

function generateRSS() {
  const dataPath = path.join(__dirname, 'data', 'results.json');
  if (!fs.existsSync(dataPath)) {
    console.error('❌ data/results.json not found');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // Strip source field (not public)
  const data = raw.map(({ source, ...rest }) => rest);
  const now = new Date().toUTCString();

  // Get latest 30 items, sorted by date_found (newest first)
  const sorted = [...data]
    .sort((a, b) => (b.date_found || '').localeCompare(a.date_found || ''))
    .slice(0, 30);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(FEED_TITLE)}</title>
  <link>${SITE_URL}</link>
  <description>${escapeXml(FEED_DESC)}</description>
  <language>en-us</language>
  <lastBuildDate>${now}</lastBuildDate>
  <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
`;

  for (const item of sorted) {
    const cat = item.category || 'Freebies';
    const tweetText = buildTweetText(item);
    const pubDate = item.date_found ? new Date(item.date_found + 'T12:00:00Z').toUTCString() : now;
    const guid = item.link || `${SITE_URL}#${Buffer.from(item.title || '').toString('base64').slice(0, 30)}`;

    xml += `  <item>
    <title>${escapeXml(`${cat === 'Sweepstakes' ? '🎉' : cat === 'Settlements' ? '💰' : '🆓'} ${item.title}`)}</title>
    <link>${escapeXml(item.link || SITE_URL)}</link>
    <description>${escapeXml(tweetText)}</description>
    <category>${escapeXml(cat)}</category>
    <pubDate>${pubDate}</pubDate>
    <guid isPermaLink="false">${escapeXml(guid)}</guid>
  </item>
`;
  }

  xml += `</channel>
</rss>`;

  const outPath = path.join(__dirname, 'site', 'rss.xml');
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log(`✅ RSS feed generated: ${outPath} (${sorted.length} items)`);
}

generateRSS();
