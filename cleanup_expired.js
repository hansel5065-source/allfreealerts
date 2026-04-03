/**
 * AllFreeAlerts — Daily Cleanup
 * Removes expired entries from data/results.json and regenerates site/data.json
 * Runs at 12:05am ET via .github/workflows/daily-cleanup.yml
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'results.json');
const SITE_DATA = path.join(__dirname, 'site', 'data.json');
const ENCODE_KEY = 'aFa2026xK';

function log(msg) { console.log(`[Cleanup] ${msg}`); }

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const today = new Date().toISOString().split('T')[0];
  log(`Today: ${today} | Total items: ${data.length}`);

  let removed = [];

  const clean = data.filter(item => {
    const title = (item.title || '').toLowerCase();
    const link = (item.link || '').toLowerCase();

    // 1. Remove items past their deadline/end_date
    const deadline = item.deadline || item.end_date;
    if (deadline && deadline < today) {
      removed.push(`[EXPIRED] ${item.title.substring(0, 60)} (${deadline})`);
      return false;
    }

    // 2. Remove "today only" items older than 1 day
    const isToday = item.date_found === today;
    if (!isToday && (/today only|today!|– today|— today/i.test(title))) {
      removed.push(`[STALE TODAY-ONLY] ${item.title.substring(0, 60)}`);
      return false;
    }

    // 3. Remove "last day" / "last chance" items older than 1 day
    if (!isToday && (/last day|last chance/i.test(title))) {
      removed.push(`[STALE LAST-DAY] ${item.title.substring(0, 60)}`);
      return false;
    }

    // 4. Remove broken ad/script links
    const brokenDomains = ['scorecardresearch.com', 'pubmatic.com', 'clarity.ms', 'adthrive.com', 'privacymanager.io'];
    if (brokenDomains.some(d => link.includes(d))) {
      removed.push(`[BROKEN LINK] ${item.title.substring(0, 60)}`);
      return false;
    }

    // 5. Remove non-claimable lawsuit investigations (not settlements)
    if (item.category === 'Settlements' && (/investigation|lawsuit/i.test(title)) && !(/settlement/i.test(title))) {
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
