/**
 * AllFreeAlerts — Facebook Group Auto-Poster
 * Posts 3 deals daily to the AllFreeAlerts Facebook Group
 * (1 sweepstakes, 1 freebie, 1 nationwide settlement)
 * Spaced out as individual posts for better engagement
 *
 * Usage: node fb_group_autoposter.js [--dry-run]
 * GitHub Actions: runs daily after scraper
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ──
const FB_GROUP_ID = process.env.FB_GROUP_ID || '935874152569187';
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || '';
const API_VERSION = 'v25.0';

// ── History (dedup) ──
const HISTORY_FILE = path.join(__dirname, 'fb_group_post_history.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return { posted: [] }; }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ── Load Data ──
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'results.json'), 'utf8'));
  } catch {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'site', 'data.json'), 'utf8');
      const key = 'aFa2026xK';
      const b = Buffer.from(raw, 'base64');
      const decoded = Buffer.from(b.map((v, i) => v ^ key.charCodeAt(i % key.length)));
      return JSON.parse(decoded.toString('utf8'));
    } catch { return []; }
  }
}

// ── Social Score (higher = more eye-catching) ──
function socialScore(item) {
  const title = (item.title || '').toLowerCase();
  let score = 0;
  const brands = ['amazon', 'walmart', 'target', 'costco', 'starbucks', 'mcdonald', 'chick-fil-a',
    'chipotle', 'dunkin', 'wendy', 'burger king', 'taco bell', 'pizza hut', 'domino',
    'apple', 'samsung', 'nike', 'adidas', 'coca-cola', 'pepsi', 'ben & jerry',
    'sephora', 'ulta', 'lego', 'disney', 'netflix', 'spotify', 'uber', 'doordash',
    'kroger', 'walgreen', 'cvs', 'aldi', 'ikea', 'seaworld', 'planet fitness',
    'rita', 'sonic', 'dairy queen', 'smoothie king', 'panera', 'subway'];
  if (brands.some(b => title.includes(b))) score += 30;
  const dollarMatch = title.match(/\$[\d,.]+/);
  if (dollarMatch) {
    const amount = parseFloat(dollarMatch[0].replace(/[$,]/g, ''));
    if (amount >= 1000000) score += 40;
    else if (amount >= 100000) score += 30;
    else if (amount >= 10000) score += 20;
    else if (amount >= 100) score += 10;
  }
  if (/free .*(coffee|pizza|burger|taco|ice cream|smoothie|fries|nugget|cone|soda|beer|wine|meal|sandwich|chicken|donut|pancake|milkshake|lollypop|candy|cookie)/i.test(title)) score += 25;
  if (/gift card/i.test(title)) score += 20;
  if (/\d+\s*winners/i.test(title)) score += 10;
  if (/no purchase|no proof/i.test(title)) score += 10;
  if (/seed|calendar|sticker|printable|ebook|label|magazine|survey|kit.*teacher|classroom/i.test(title)) score -= 20;
  if (/today only/i.test(title)) score -= 15;
  if (/order|purchase|buy|log in to order|spend \$/i.test(title)) score -= 30;
  score += Math.random() * 15;
  return score;
}

// ── Pick 5 deals (2 sweepstakes, 2 freebies, 1 settlement) ──
function pickDeals() {
  const data = loadData();
  const history = loadHistory();
  const postedLinks = new Set(history.posted || []);

  const categories = [
    { name: 'Sweepstakes', count: 1, emoji: '🎉', label: 'SWEEPSTAKES' },
    { name: 'Freebies', count: 1, emoji: '🆓', label: 'FREE STUFF' },
    { name: 'Settlements', count: 1, emoji: '💰', label: 'SETTLEMENT' }
  ];

  const picks = [];

  for (const cat of categories) {
    let pool = data.filter(i => i.category === cat.name && !postedLinks.has(i.link));

    // Settlements: only nationwide
    if (cat.name === 'Settlements') {
      pool = pool.filter(i => !i.scope || i.scope === 'nationwide');
    }

    if (pool.length === 0) {
      console.log(`No unposted ${cat.name} deals available, skipping.`);
      continue;
    }

    // Sort by social score, pick from top 5
    pool.sort((a, b) => socialScore(b) - socialScore(a));
    const topPool = pool.slice(0, Math.max(5, cat.count * 3));

    // Shuffle top pool and take what we need
    for (let j = topPool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [topPool[j], topPool[k]] = [topPool[k], topPool[j]];
    }

    for (let n = 0; n < cat.count && n < topPool.length; n++) {
      const item = topPool[n];
      postedLinks.add(item.link);
      picks.push({ item, category: cat });
    }
  }

  return picks;
}

// ── Build group post text ──
function buildPostText(item, category) {
  const title = item.title || '';
  const link = item.link || 'https://allfreealerts.com';

  if (category.name === 'Sweepstakes') {
    let text = `${category.emoji} SWEEPSTAKES ALERT!\n\n`;
    text += `${title}\n\n`;
    if (item.prize_summary) text += `🏆 Prize: ${item.prize_summary.slice(0, 200)}\n`;
    if (item.eligibility) text += `📋 ${item.eligibility}\n`;
    if (item.end_date) text += `⏰ Ends: ${item.end_date}\n`;
    text += `\n🔗 Enter here: ${link}\n\n`;
    text += `💬 Drop a 🎉 if you entered!\n\n`;
    text += `───────────────────\n`;
    text += `👉 allfreealerts.com — hundreds more free deals updated daily\n`;
    text += `📬 Get deals in your inbox → allfreealerts.com/#subscribe`;
    return text;
  }

  if (category.name === 'Freebies') {
    let text = `${category.emoji} FREE STUFF ALERT!\n\n`;
    text += `${title}\n\n`;
    text += `✅ No purchase necessary\n`;
    if (item.end_date) text += `⏰ Ends: ${item.end_date}\n`;
    text += `\n🔗 Claim it: ${link}\n\n`;
    text += `💬 Tag someone who needs to see this!\n\n`;
    text += `───────────────────\n`;
    text += `👉 allfreealerts.com — hundreds more free deals updated daily\n`;
    text += `📬 Get deals in your inbox → allfreealerts.com/#subscribe`;
    return text;
  }

  if (category.name === 'Settlements') {
    let text = `${category.emoji} CLASS ACTION SETTLEMENT\n\n`;
    text += `${title}\n\n`;
    if (item.prize_summary) text += `💵 Payout: ${item.prize_summary.slice(0, 200)}\n`;
    if (item.proof_required === 'No') text += `✅ No proof needed — just file the claim\n`;
    if (item.end_date) text += `⏰ Deadline: ${item.end_date}\n`;
    text += `\n🔗 File your claim: ${link}\n\n`;
    text += `💬 Share this — most people don't know they're owed money!\n\n`;
    text += `───────────────────\n`;
    text += `👉 allfreealerts.com — hundreds more free deals updated daily\n`;
    text += `📬 Get deals in your inbox → allfreealerts.com/#subscribe`;
    return text;
  }

  return `${title}\n\n🔗 ${link}\n\n👉 allfreealerts.com\n📬 Get deals in your inbox → allfreealerts.com/#subscribe`;
}

// ── Facebook Graph API ──
function graphAPI(method, endpoint, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const url = `https://graph.facebook.com/${API_VERSION}/${endpoint}`;

    if (method === 'GET') {
      https.get(url + '?' + body, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        });
      }).on('error', reject);
      return;
    }

    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Post to Group ──
async function postToGroup(text) {
  const result = await graphAPI('POST', `${FB_GROUP_ID}/feed`, {
    message: text,
    access_token: FB_PAGE_TOKEN
  });

  if (result.error) {
    throw new Error(`FB Group post failed: ${result.error.message}`);
  }

  return result.id;
}

// ── Main ──
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('AllFreeAlerts Facebook Group Auto-Poster');
  console.log('=========================================');
  if (dryRun) console.log('DRY RUN MODE — nothing will be posted\n');
  else console.log('LIVE MODE — posts will be sent to FB Group\n');

  if (!dryRun && !FB_PAGE_TOKEN) {
    console.error('Error: FB_PAGE_TOKEN environment variable is required.');
    process.exit(1);
  }

  const picks = pickDeals();
  console.log(`${picks.length} posts ready\n`);

  if (picks.length === 0) {
    console.log('No new items to post. Done!');
    process.exit(0);
  }

  const history = loadHistory();

  for (let i = 0; i < picks.length; i++) {
    const { item, category } = picks[i];
    const text = buildPostText(item, category);

    console.log(`\n--- Post ${i + 1} of ${picks.length} (${category.name}) ---`);
    console.log(text);
    console.log(`\n(${text.length} chars)\n`);

    if (!dryRun) {
      try {
        const postId = await postToGroup(text);
        console.log(`✅ Posted! ID: ${postId}`);

        if (item.link) {
          history.posted.push(item.link);
        }
        // Keep history manageable
        if (history.posted.length > 1000) {
          history.posted = history.posted.slice(-1000);
        }
      } catch (err) {
        console.error(`❌ Failed to post ${i + 1}:`, err.message);
      }

      // 30 second delay between posts (avoid spam triggers)
      if (i < picks.length - 1) {
        console.log('⏳ Waiting 30s before next post...');
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }

  if (!dryRun) {
    saveHistory(history);
    console.log('\n✅ Done! History saved.');
  } else {
    console.log('\nDry run complete. No posts sent.');
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
