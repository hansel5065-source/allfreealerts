/**
 * AllFreeAlerts — Daily Deep Cleanup
 * Removes expired, stale, and broken entries from data/results.json
 * Regenerates site/data.json after cleanup
 * Runs at 12:05am ET via .github/workflows/daily-cleanup.yml
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'results.json');
const SITE_DATA = path.join(__dirname, 'site', 'data.json');
const BLOCKLIST_FILE = path.join(__dirname, 'data', 'removed_blocklist.json');
const ENCODE_KEY = 'aFa2026xK';

// No age-based guessing — only remove items with confirmed expired dates
// Nightly link checker (check_links.js) handles live verification

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function log(msg) { console.log(`[Cleanup] ${msg}`); }

/**
 * Parse dates in any format found in our data:
 *   - "3/30/26" or "3/30/2026" (M/D/YY or M/D/YYYY)
 *   - "March 30, 2026" (Month D, YYYY)
 *   - "April 5 at 11:59 PM" (Month D at time — no year, assume current year)
 *   - "2026-04-05" (ISO)
 * Returns a Date object or null if unparseable.
 */
function parseDate(str) {
  if (!str || str === 'Unknown') return null;
  str = str.trim();

  // ISO format: 2026-04-05
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  // M/D/YY or M/D/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let [, m, d, y] = slashMatch;
    y = parseInt(y);
    if (y < 100) y += 2000;
    return new Date(y, parseInt(m) - 1, parseInt(d));
  }

  // "Month D, YYYY" or "Month D at HH:MM PM"
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

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = now.toISOString().split('T')[0];
  log(`Today: ${todayStr} | Total items: ${data.length}`);

  let removed = [];

  const clean = data.filter(item => {
    const title = (item.title || '').toLowerCase();
    const link = (item.link || '').toLowerCase();
    const category = item.category || '';

    // 1. Remove items past their deadline/end_date (with proper date parsing)
    const deadlineStr = item.deadline || item.end_date;
    if (deadlineStr) {
      const deadlineDate = parseDate(deadlineStr);
      if (deadlineDate && deadlineDate < startOfToday) {
        removed.push(`[EXPIRED] ${item.title.substring(0, 60)} (${deadlineStr})`);
        return false;
      }
    }

    // 2. Remove "today only" items older than 1 day
    const foundDate = parseDate(item.date_found);
    const isToday = item.date_found === todayStr;
    if (!isToday && (/today only|today!|– today|— today/i.test(title))) {
      removed.push(`[STALE TODAY-ONLY] ${item.title.substring(0, 60)}`);
      return false;
    }

    // 3. Remove "last day" / "last chance" / "ends tonight" items older than 1 day
    if (!isToday && (/last day|last chance|ends tonight|ending today/i.test(title))) {
      removed.push(`[STALE LAST-DAY] ${item.title.substring(0, 60)}`);
      return false;
    }

    // 4. Remove items with "expired" / "closed" / "ended" in title
    if (/\bexpired\b|\bclosed\b|\bended\b|\bno longer available\b/i.test(title)) {
      removed.push(`[CLOSED] ${item.title.substring(0, 60)}`);
      return false;
    }

    // 5. Remove broken ad/script links
    const brokenDomains = ['scorecardresearch.com', 'pubmatic.com', 'clarity.ms', 'adthrive.com', 'privacymanager.io'];
    if (brokenDomains.some(d => link.includes(d))) {
      removed.push(`[BROKEN LINK] ${item.title.substring(0, 60)}`);
      return false;
    }

    // 7. Remove non-claimable lawsuit investigations (not settlements)
    if (category === 'Settlements' && (/investigation|lawsuit/i.test(title)) && !(/settlement/i.test(title))) {
      if (link.includes('/investigation') || link.includes('/lawsuit')) {
        removed.push(`[NOT CLAIMABLE] ${item.title.substring(0, 60)}`);
        return false;
      }
    }

    return true;
  });

  if (removed.length === 0) {
    log('No expired entries found. Data is clean.');
    return;
  }

  log(`\nRemoved ${removed.length} entries:`);
  removed.forEach(r => log(`  ${r}`));

  // Add removed URLs to blocklist so scraper doesn't re-add them
  const blocklist = fs.existsSync(BLOCKLIST_FILE)
    ? JSON.parse(fs.readFileSync(BLOCKLIST_FILE, 'utf8'))
    : [];
  const removedItems = data.filter(item => !clean.includes(item));
  let blockedCount = 0;
  for (const item of removedItems) {
    if (item.link) {
      // Extract a stable URL fragment (domain + path) for matching
      try {
        const u = new URL(item.link);
        const fragment = u.hostname + u.pathname.replace(/\/$/, '');
        if (!blocklist.some(b => fragment.includes(b) || b.includes(fragment))) {
          blocklist.push(fragment);
          blockedCount++;
        }
      } catch (e) { /* skip malformed URLs */ }
    }
  }
  if (blockedCount > 0) {
    fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify(blocklist, null, 2));
    log(`Added ${blockedCount} URLs to blocklist (total: ${blocklist.length})`);
  }

  // Save cleaned data
  fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2));
  log(`\nSaved data/results.json: ${data.length} → ${clean.length}`);

  // Regenerate encoded site data
  const stripped = clean.map(({ source, ...rest }) => rest);
  const jsonStr = JSON.stringify(stripped);
  const encoded = Buffer.from(
    Buffer.from(jsonStr).map((v, i) => v ^ ENCODE_KEY.charCodeAt(i % ENCODE_KEY.length))
  ).toString('base64');
  fs.writeFileSync(SITE_DATA, encoded);
  log(`Saved site/data.json (${(fs.statSync(SITE_DATA).size / 1024).toFixed(1)} KB)`);
}

main();
