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
const BLOCKLIST_FILE = path.join(__dirname, 'data', 'removed_blocklist.json');

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Parse dates in any format: M/D/YY, Month D YYYY, Month D at time, ISO
 */
function parseDate(str) {
  if (!str || str === 'Unknown') return null;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str + 'T00:00:00');
    return isNaN(d) ? null : d;
  }
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let [, m, d, y] = slashMatch;
    y = parseInt(y);
    if (y < 100) y += 2000;
    return new Date(y, parseInt(m) - 1, parseInt(d));
  }
  const monthMatch = str.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (monthMatch) {
    const monthIdx = MONTH_MAP[monthMatch[1].toLowerCase()];
    if (monthIdx !== undefined) {
      const day = parseInt(monthMatch[2]);
      const year = monthMatch[3] ? parseInt(monthMatch[3]) : new Date().getFullYear();
      return new Date(year, monthIdx, day);
    }
  }
  return null;
}

function fetchWithRedirects(url, maxRedirects = 5) {
  return new Promise(resolve => {
    if (maxRedirects <= 0) return resolve({ body: '', status: 0, finalUrl: url });
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    }, res => {
      // Follow redirects — but check the redirect URL for expired signals first
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        const locLower = resolved.toLowerCase();
        // Check if redirect itself signals expiration
        if (/\/(over|ended|closed|expired|unavailable|not-found|404)\b/.test(locLower) ||
            locLower.includes('notavailable') || locLower.includes('expired') || locLower.includes('error')) {
          return resolve({ body: '', status: res.statusCode, finalUrl: resolved, redirectDead: true });
        }
        // Check if redirect goes to login-wall platform
        // Check if sample/free page redirected to a shop/product page (sample expired)
        if (/\/(free|sample|giveaway)/.test(url.toLowerCase()) && /\/(shop|product|buy|store|cleansing|collection)/.test(locLower)) {
          return resolve({ body: '', status: res.statusCode, finalUrl: resolved, redirectDead: true });
        }
        const LOGIN_WALL = ['gleam.io', 'rafflecopter.com', 'woobox.com', 'shortstack.com'];
        if (LOGIN_WALL.some(d => locLower.includes(d))) {
          return resolve({ body: '', status: res.statusCode, finalUrl: resolved, redirectDead: true });
        }
        // Otherwise follow the redirect
        res.resume();
        return fetchWithRedirects(resolved, maxRedirects - 1).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ body: d, status: res.statusCode, finalUrl: url }));
    });
    req.on('error', (err) => resolve({ body: '', status: 0, finalUrl: url, networkError: true, errorMsg: err.code || err.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ body: '', status: 0, finalUrl: url, networkError: true, errorMsg: 'TIMEOUT' }); });
  });
}

function checkUrl(url) {
  return new Promise(async resolve => {
    const { body: rawBody, status, finalUrl, redirectDead, networkError, errorMsg } = await fetchWithRedirects(url);
    if (redirectDead) return resolve({ dead: true, status });
    // DNS failures, connection refused, timeouts = dead
    if (networkError) return resolve({ dead: true, status: 0 });
    const body = rawBody.toLowerCase();
    const dead =
      status === 404 || status === 410 ||
      body.includes('no longer available') || body.includes('has expired') ||
      body.includes('page not found') || body.includes('promotion has ended') ||
      body.includes('sweepstakes has ended') || body.includes('this offer has ended') ||
      body.includes('survey_is_not_public') || body.includes('contest is closed') ||
      body.includes('giveaway has ended') || body.includes('this sweepstakes is over') ||
      body.includes('this promotion has ended') || body.includes('offer expired') ||
      body.includes('claim deadline has passed') || body.includes('claims period has ended') ||
      body.includes('settlement has been completed') || body.includes('filing deadline has passed') ||
      body.includes('this deal has expired') || body.includes('this freebie has expired') ||
      body.includes('offer has ended') || body.includes('no longer accepting claims') ||
      body.includes('this giveaway is over') || body.includes('entry period has ended') ||
      body.includes('redemption period has ended') || body.includes('campaign has ended') ||
      body.includes('sorry, this promotion has ended') || body.includes('this contest has ended') ||
      body.includes('this sweepstakes has closed') || body.includes('promotion is over') ||
      body.includes('problem accessing the intended page') || body.includes('this page is no longer available') ||
      body.includes('this link has expired') || body.includes('this form is no longer accepting') ||
      body.includes('sign-ups closed') || body.includes('signups closed') || body.includes('sign ups closed') ||
      body.includes('registration is closed') || body.includes('entries are closed') ||
      body.includes('submissions are closed') || body.includes('not available in your region') ||
      body.includes('giveaway is now closed') || body.includes('supply has been claimed') ||
      body.includes('giveaway is closed') || body.includes('all items have been claimed') ||
      body.includes('sold out') && body.includes('giveaway') ||
      body.includes('fresh out of') || body.includes('out of stock') ||
      body.includes('currently unavailable') || body.includes('thanks for stopping by') ||
      body.includes('we ran out') || body.includes('all gone') || body.includes('no more available') ||
      body.includes('scooped up') || body.includes('all scooped up') ||
      body.includes('samples were all') || body.includes('all claimed') ||
      body.includes('this sample is no longer available') || body.includes('sample is no longer available');
    // Flag pages that embed login-wall widgets (gleam.io, etc.)
    const hasGleam = !dead && ['gleam.io/js/widget', 'e.gleam.io', 'rafflecopter.com/rafl/'].some(d => body.includes(d));
    // Flag pages with login/signup/age-gate walls
    const loginSignals = ['sign in to continue', 'log in to continue', 'register to enter',
      'create an account to', 'sign up to enter', 'verify your age', 'sign up to start earning',
      'are you 21', 'are you over 21', 'you must be 21', 'you must be 18',
      'age verification required', 'please verify your age', 'confirm you are of legal',
      'sign in or register', 'login or register', 'this competition has ended'];
    const hasLoginWall = !dead && loginSignals.some(s => body.includes(s));
    resolve({ dead: dead || hasGleam || hasLoginWall, status });
  });
}

async function main() {
  console.log('Dead-link checker starting...');
  let data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));

  // Remove expired items (deadline/end_date in the past, with proper date parsing)
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const beforeExpiry = data.length;
  data = data.filter(i => {
    const d = i.deadline || i.end_date;
    if (!d) return true;
    const parsed = parseDate(d);
    if (!parsed) return true;
    return parsed >= startOfToday;
  });
  const expiredCount = beforeExpiry - data.length;
  if (expiredCount > 0) console.log(`Removed ${expiredCount} expired items (past deadline)`);
  // Check every link every night — no caching, no skipping
  const toCheck = data.filter(i => i.link);
  console.log(`Checking ${toCheck.length} links (all categories)...`);

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

  console.log(`\nDead links found: ${deadLinks.size}`);

  // Remove dead links from data
  if (deadLinks.size > 0) {
    data = data.filter(i => !deadLinks.has(i.link));
    console.log(`Removed ${deadLinks.size} dead items.`);
  }

  // Add dead/expired URLs to blocklist so scraper doesn't re-add them
  if (deadLinks.size > 0) {
    const blocklist = fs.existsSync(BLOCKLIST_FILE)
      ? JSON.parse(fs.readFileSync(BLOCKLIST_FILE, 'utf8'))
      : [];
    let blockedCount = 0;
    for (const link of deadLinks) {
      try {
        const u = new URL(link);
        const fragment = u.hostname + u.pathname.replace(/\/$/, '');
        if (!blocklist.some(b => fragment.includes(b) || b.includes(fragment))) {
          blocklist.push(fragment);
          blockedCount++;
        }
      } catch (e) { /* skip */ }
    }
    if (blockedCount > 0) {
      fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify(blocklist, null, 2));
      console.log(`Added ${blockedCount} dead URLs to blocklist (total: ${blocklist.length})`);
    }
  }

  // Save if anything changed (expired items or dead links)
  const totalRemoved = expiredCount + deadLinks.size;
  if (totalRemoved > 0) {
    console.log(`Remaining: ${data.length} items`);
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
    // Encode for anti-scraping (XOR + base64, strip source field)
    const publicData = data.map(({ source, ...rest }) => rest);
    const jsonStr = JSON.stringify(publicData);
    const key = 'aFa2026xK';
    const encoded = Buffer.from(jsonStr).map((b, i) => b ^ key.charCodeAt(i % key.length));
    fs.writeFileSync(SITE_DATA, encoded.toString('base64'), 'utf8');
    console.log('Saved.');
  } else {
    console.log('All links are live, nothing expired!');
  }

  return totalRemoved;
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
