#!/usr/bin/env node
// QA checker for new AllFreeAlerts entries
// Runs after scraper, before deploy — automatically removes bad entries
// Checks: live links, middleman detection, content validation
// Run: node qa_new_entries.js

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, 'data', 'results.json');
const SITE_DATA = path.join(__dirname, 'site', 'data.json');
const QA_LOG = path.join(__dirname, 'data', 'qa_log.json');

// === MIDDLEMAN DOMAINS ===
// These are aggregator sites that repackage deals — we want the original source
// NOTE: Only check the LINK URL, not the source name.
// We scrape FROM aggregator sites to FIND deals, but the links should go to original sources.
// Settlement aggregators (topclassactions, classaction.org) are legitimate — they link to real claim forms.
const MIDDLEMAN_DOMAINS = [
  // Sweepstakes aggregators (if link points here, it's a middleman)
  'contestgirl.com', 'sweepstakesfanatics.com', 'sweetiessweeps.com', 'giveawaybase.com',
  'sweepstakesadvantage.com', 'ultracontest.com', 'onlinesweepstakes.com',
  'sweepstakeslovers.com', 'sweepstakesbible.com', 'winzily.com',
  'sweepstakestoday.com', 'sweepstakeswinner.com',
  // Freebie aggregators (if link points here, it's a middleman)
  'freebieshark.com', 'freeflys.com', 'hip2save.com', 'yofreetsamples.com',
  'thefreebieguy.com', 'freebiefindingmom.com', 'freestuff.com',
  'heysitsfree.net', 'freesamples.org', 'allfreestuff.com',
  'freestuffinder.com', 'ilovegiveaways.com',
  // Settlement aggregators (we scrape FROM them but links should go to actual claim forms)
  'settlemate.io',
  // Generic deal aggregators
  'slickdeals.net', 'dealnews.com', 'offers.com', 'retailmenot.com',
  'coupons.com', 'groupon.com',
  // Shortlink/tracking domains used by aggregators
  'freebi.es', 'trk.adbloom.co', 'bmv.biz', 'a.pub.network',
];

// === KNOWN GOOD DOMAINS ===
// Original sweepstakes/deal platforms — these are NOT middlemen
const GOOD_DOMAINS = [
  // Sweepstakes platforms
  'gleam.io', 'wn.nr', 'rafflecopter.com', 'woobox.com', 'shortstack.com',
  'viral-loops.com', 'kingsumo.com', 'vyper.ai', 'upviral.com',
  'easypromos.com', 'wishpond.com', 'outgrow.co',
  // Survey/form platforms (direct entry)
  'surveymonkey.com', 'typeform.com', 'google.com/forms', 'jotform.com',
  'wufoo.com', 'cognito.forms', 'formstack.com',
  // Brand/company domains (original sources)
  'coca-cola.com', 'pepsi.com', 'mcdonalds.com', 'samsung.com',
  'apple.com', 'microsoft.com', 'amazon.com',
  // Settlement claim sites
  'settlementclass.com', 'gilardi.com', 'epiqglobal.com',
  'gcginc.com', 'heffler.com', 'kccllc.com', 'rust-oleum.com',
  'atticsettlement.com', 'angeion.com', 'analytics.com',
  // FTC
  'ftc.gov', 'consumer.ftc.gov',
  // Direct freebie sources
  'walmart.com', 'target.com', 'costco.com', 'samsclub.com',
  'kroger.com', 'publix.com', 'dollargeneral.com',
];

// === DEAD LINK PATTERNS ===
const DEAD_PATTERNS = [
  'no longer available', 'has expired', 'page not found',
  'promotion has ended', 'sweepstakes has ended', 'this offer has ended',
  'survey_is_not_public', 'contest is closed', 'giveaway has ended',
  'this sweepstakes is over', 'this promotion has ended', 'offer expired',
  'this page doesn\'t exist', 'this page does not exist',
  'sorry, this page', 'error 404', '404 not found',
  'the page you requested', 'has been removed', 'no longer exists',
  'content is unavailable', 'we can\'t find', 'we couldn\'t find',
  'this giveaway is over', 'this contest has ended', 'entry period has ended',
  'submissions are closed', 'this form is closed', 'form is no longer accepting',
  'sweepstakes is closed', 'promotion is closed', 'offer is no longer',
  'redemption period has ended', 'claim deadline has passed',
];

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[QA ${ts.split('T')[1].split('.')[0]}] ${msg}`);
}

function checkUrl(url) {
  return new Promise(resolve => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      timeout: 12000
    }, res => {
      // Follow redirects manually to check final destination
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const finalUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        res.resume(); // drain response
        return resolve({ alive: true, status: res.statusCode, redirectTo: finalUrl });
      }

      let body = '';
      res.on('data', c => {
        body += c;
        // Only read first 50KB for pattern matching
        if (body.length > 50000) res.destroy();
      });
      res.on('end', () => checkBody(url, res.statusCode, body, resolve));
      res.on('close', () => checkBody(url, res.statusCode, body, resolve));
    });
    req.on('error', (e) => resolve({ alive: true, status: 0, flagged: `Network error: ${e.message} — check manually` }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ alive: true, status: 0, flagged: 'Timeout (12s) — check manually' }); });
  });
}

function checkBody(url, statusCode, body, resolve) {
  if (resolve._called) return;
  resolve._called = true;

  // Hard dead — 404/410 are definitively dead
  if (statusCode === 404 || statusCode === 410) {
    return resolve({ alive: false, status: statusCode, reason: `HTTP ${statusCode}` });
  }

  // 403 = could be bot protection (Cloudflare, etc.) — flag but don't auto-remove
  // Many legit sites return 403 to scrapers but work fine in browsers
  if (statusCode === 403) {
    return resolve({ alive: true, status: statusCode, flagged: '403 — may be bot-blocked, check manually' });
  }

  // Check body for dead patterns
  const lowerBody = body.toLowerCase();
  for (const pattern of DEAD_PATTERNS) {
    if (lowerBody.includes(pattern)) {
      return resolve({ alive: false, status: statusCode, reason: `Dead pattern: "${pattern}"` });
    }
  }

  // Check redirect headers in body (some sites use meta refresh)
  const metaRefresh = lowerBody.match(/meta[^>]*http-equiv="refresh"[^>]*url=([^">\s]+)/);
  if (metaRefresh) {
    const redirectUrl = metaRefresh[1].replace(/['"]/g, '');
    if (redirectUrl.includes('error') || redirectUrl.includes('expired') || redirectUrl.includes('notfound')) {
      return resolve({ alive: false, status: statusCode, reason: `Meta redirect to error page` });
    }
  }

  resolve({ alive: true, status: statusCode });
}

function isMiddleman(link, category) {
  // Settlement links are ALWAYS allowed — aggregators like topclassactions/classaction.org
  // link to real claim forms and are legitimate sources for settlements
  if (category === 'Settlements') return { isMiddleman: false };

  const lowerLink = link.toLowerCase();

  // Only flag if the LINK URL itself points to a middleman domain
  // (We scrape FROM aggregators to find deals, but links should go to original sources)
  for (const domain of MIDDLEMAN_DOMAINS) {
    if (lowerLink.includes(domain)) {
      return { isMiddleman: true, domain, reason: `Link points to aggregator: ${domain}` };
    }
  }

  return { isMiddleman: false };
}

function validateContent(item) {
  const issues = [];

  // Title checks
  if (!item.title || item.title.trim().length === 0) {
    issues.push('Missing title');
  } else if (item.title.length < 10) {
    issues.push(`Title too short (${item.title.length} chars)`);
  } else if (item.title.includes('undefined') || item.title.includes('null') || item.title.includes('NaN')) {
    issues.push('Title contains undefined/null/NaN');
  }

  // Link checks
  if (!item.link || !item.link.startsWith('http')) {
    issues.push('Invalid or missing link');
  }

  // Category check
  if (!item.category || !['Sweepstakes', 'Freebies', 'Settlements'].includes(item.category)) {
    issues.push(`Invalid category: ${item.category}`);
  }

  // Duplicate title/link patterns
  if (item.title && /^(test|example|sample|lorem|ipsum)/i.test(item.title)) {
    issues.push('Title looks like test/sample content');
  }

  return issues;
}

async function main() {
  log('Starting QA check on new entries...');

  if (!fs.existsSync(RESULTS_FILE)) {
    log('No results file found, nothing to QA.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const today = new Date().toISOString().split('T')[0];

  // Only QA items added today (new entries from this scrape run)
  const newEntries = data.filter(i => i.date_found === today);
  const existingEntries = data.filter(i => i.date_found !== today);

  if (newEntries.length === 0) {
    log('No new entries to QA.');
    return;
  }

  log(`Found ${newEntries.length} new entries to QA (${existingEntries.length} existing)`);

  const removed = [];
  const flagged = []; // items that pass but need manual review
  const passed = [];
  const BATCH = 20;

  for (let i = 0; i < newEntries.length; i += BATCH) {
    const batch = newEntries.slice(i, i + BATCH);
    await Promise.all(batch.map(async (item) => {
      // 1. Content validation
      const contentIssues = validateContent(item);
      if (contentIssues.length > 0) {
        removed.push({ ...item, qa_reason: `Content: ${contentIssues.join(', ')}` });
        return;
      }

      // 2. Middleman check (skips settlements — those aggregators are legit)
      const mm = isMiddleman(item.link, item.category);
      if (mm.isMiddleman) {
        removed.push({ ...item, qa_reason: `Middleman: ${mm.reason}` });
        return;
      }

      // 3. Live link check
      const result = await checkUrl(item.link);

      if (!result.alive) {
        removed.push({ ...item, qa_reason: `Dead link [${result.status}]: ${result.reason}` });
        return;
      }

      // 4. Check if redirect lands on a middleman
      if (result.redirectTo) {
        const redirectMm = isMiddleman(result.redirectTo);
        if (redirectMm.isMiddleman) {
          removed.push({ ...item, qa_reason: `Redirects to middleman: ${redirectMm.domain}` });
          return;
        }
      }

      // 5. Flag items that need manual review (403s, timeouts) but still pass
      if (result.flagged) {
        flagged.push({ ...item, qa_flag: result.flagged });
      }

      passed.push(item);
    }));
    log(`  Checked ${Math.min(i + BATCH, newEntries.length)}/${newEntries.length}...`);
  }

  // Report
  log('');
  log('========================================');
  log('QA RESULTS');
  log('========================================');
  log(`New entries checked: ${newEntries.length}`);
  log(`  ✓ Passed: ${passed.length}`);
  log(`  ⚠ Flagged (live but check manually): ${flagged.length}`);
  log(`  ✗ Removed: ${removed.length}`);

  if (removed.length > 0) {
    log('');
    log('REMOVED ENTRIES:');
    for (const item of removed) {
      log(`  ✗ [${item.source}] ${item.title.substring(0, 60)} — ${item.qa_reason}`);
    }
  }

  if (flagged.length > 0) {
    log('');
    log('FLAGGED (still live, review recommended):');
    for (const item of flagged) {
      log(`  ⚠ [${item.source}] ${item.title.substring(0, 60)} — ${item.qa_flag}`);
    }
  }

  // Count removals by reason type
  const reasonCounts = {};
  for (const item of removed) {
    const type = item.qa_reason.split(':')[0];
    reasonCounts[type] = (reasonCounts[type] || 0) + 1;
  }
  if (Object.keys(reasonCounts).length > 0) {
    log('');
    log('Removal breakdown:');
    for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      log(`  ${reason}: ${count}`);
    }
  }

  // Save QA log
  const qaLog = {
    date: today,
    timestamp: new Date().toISOString(),
    total_checked: newEntries.length,
    passed: passed.length,
    flagged: flagged.length,
    removed: removed.length,
    removed_entries: removed.map(i => ({
      title: i.title,
      link: i.link,
      source: i.source,
      reason: i.qa_reason,
    })),
    flagged_entries: flagged.map(i => ({
      title: i.title,
      link: i.link,
      source: i.source,
      flag: i.qa_flag,
    })),
  };

  // Append to QA log history
  let qaHistory = [];
  if (fs.existsSync(QA_LOG)) {
    try { qaHistory = JSON.parse(fs.readFileSync(QA_LOG, 'utf8')); } catch (e) {}
  }
  qaHistory.push(qaLog);
  // Keep last 30 days of QA logs
  if (qaHistory.length > 30) qaHistory = qaHistory.slice(-30);
  fs.writeFileSync(QA_LOG, JSON.stringify(qaHistory, null, 2));

  // Save cleaned results
  if (removed.length > 0) {
    const cleanData = [...existingEntries, ...passed];
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(cleanData, null, 2));
    // Encode for anti-scraping (XOR + base64, strip source field)
    const publicData = cleanData.map(({ source, ...rest }) => rest);
    const jsonStr = JSON.stringify(publicData);
    const key = 'aFa2026xK';
    const encoded = Buffer.from(jsonStr).map((b, i) => b ^ key.charCodeAt(i % key.length));
    fs.writeFileSync(SITE_DATA, encoded.toString('base64'), 'utf8');
    log(`\nSaved ${cleanData.length} entries (removed ${removed.length} bad entries)`);
  } else {
    log('\nAll new entries passed QA — no changes needed.');
  }
}

main().catch(e => { console.error('QA FATAL:', e.message); process.exit(1); });
