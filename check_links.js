#!/usr/bin/env node
// Dead-link checker for AllFreeAlerts
// Checks all sweepstakes/freebies links and removes dead ones
// Run: node check_links.js

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, 'data', 'results.json');
const SITE_DATA = path.join(__dirname, 'site', 'data.json');

function checkUrl(url) {
  return new Promise(resolve => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 5000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const loc = (res.headers.location || '').toLowerCase();
        const body = d.toLowerCase();
        const dead =
          res.statusCode === 404 || res.statusCode === 410 ||
          loc.includes('notavailable') || loc.includes('expired') || loc.includes('error') ||
          body.includes('no longer available') || body.includes('has expired') ||
          body.includes('page not found') || body.includes('promotion has ended') ||
          body.includes('sweepstakes has ended') || body.includes('this offer has ended') ||
          body.includes('survey_is_not_public') || body.includes('contest is closed') ||
          body.includes('giveaway has ended') || body.includes('this sweepstakes is over') ||
          body.includes('this promotion has ended') || body.includes('offer expired');
        resolve({ dead, status: res.statusCode });
      });
    });
    req.on('error', () => resolve({ dead: false, status: 0 }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ dead: false, status: 0 }); });
  });
}

async function main() {
  console.log('Dead-link checker starting...');
  let data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

  // Remove expired items (deadline/end_date in the past)
  const today = new Date().toISOString().split('T')[0];
  const beforeExpiry = data.length;
  data = data.filter(i => {
    const d = i.deadline || i.end_date;
    if (!d) return true;
    return d >= today;
  });
  const expiredCount = beforeExpiry - data.length;
  if (expiredCount > 0) console.log(`Removed ${expiredCount} expired items (past deadline)`);
  // Only check links older than 3 days (new ones are almost always live)
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
  // Only recheck each link once per 7 days to keep runtime under 5 minutes
  const RECHECK_FILE = path.join(__dirname, 'data', 'link_check_cache.json');
  let checkCache = {};
  try { checkCache = JSON.parse(fs.readFileSync(RECHECK_FILE, 'utf8')); } catch {}
  const now = Date.now();
  const WEEK = 7 * 86400000;
  const toCheck = data.filter(i =>
    i.category !== 'Settlements' &&
    (!i.date_found || i.date_found <= threeDaysAgo) &&
    (!checkCache[i.link] || now - checkCache[i.link] > WEEK)
  );
  console.log(`Checking ${toCheck.length} links (skipping items newer than 3 days or checked within 7 days)...`);

  const deadLinks = new Set();
  const BATCH = 100;

  for (let i = 0; i < toCheck.length; i += BATCH) {
    const batch = toCheck.slice(i, i + BATCH);
    await Promise.all(batch.map(async item => {
      const r = await checkUrl(item.link);
      if (r.dead) {
        deadLinks.add(item.link);
        console.log(`  DEAD [${r.status}] ${item.title.substring(0, 60)}`);
      }
    }));
    process.stdout.write(`  ${Math.min(i + BATCH, toCheck.length)}/${toCheck.length}\r`);
  }

  // Update check cache with timestamps
  for (const item of toCheck) {
    checkCache[item.link] = now;
  }
  // Clean cache of links no longer in data
  const dataLinks = new Set(data.map(i => i.link));
  for (const link of Object.keys(checkCache)) {
    if (!dataLinks.has(link)) delete checkCache[link];
  }
  fs.writeFileSync(RECHECK_FILE, JSON.stringify(checkCache));

  console.log(`\nDead links found: ${deadLinks.size}`);

  if (deadLinks.size > 0) {
    const clean = data.filter(i => !deadLinks.has(i.link));
    console.log(`Removed ${data.length - clean.length} dead items. Remaining: ${clean.length}`);
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(clean, null, 2));
    // Encode for anti-scraping (XOR + base64, strip source field)
    const publicData = clean.map(({ source, ...rest }) => rest);
    const jsonStr = JSON.stringify(publicData);
    const key = 'aFa2026xK';
    const encoded = Buffer.from(jsonStr).map((b, i) => b ^ key.charCodeAt(i % key.length));
    fs.writeFileSync(SITE_DATA, encoded.toString('base64'), 'utf8');
    console.log('Saved.');
  } else {
    console.log('All links are live!');
  }

  return deadLinks.size;
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
