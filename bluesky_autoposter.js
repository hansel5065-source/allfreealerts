/**
 * AllFreeAlerts — Bluesky Auto-Poster
 * Posts 3 deals daily (1 sweepstakes, 1 freebie, 1 nationwide settlement)
 * Uses the AT Protocol (Bluesky API) with native Node.js https
 *
 * Usage: node bluesky_autoposter.js [--dry-run]
 * GitHub Actions: runs daily after scraper
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Credentials ──
const BLUESKY_HANDLE = process.env.BLUESKY_HANDLE || 'allfreealerts.bsky.social';
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD || '';

// ── History (dedup) ──
const HISTORY_FILE = path.join(__dirname, 'bluesky_post_history.json');

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return { posted: [] };
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ── Load scraped data ──
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
    } catch (e) {
      console.error('Could not load data:', e.message);
      return [];
    }
  }
}

// ── Pick 3 deals (1 per category, day-based seed, dedup) ──
function pickDeals() {
  const data = loadData();
  const history = loadHistory();
  const postedLinks = new Set(history.posted || []);
  const daySeed = Math.floor(Date.now() / 86400000);

  // Seeded random using day seed
  function seededRandom(seed) {
    let s = seed;
    return function () {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }

  const rng = seededRandom(daySeed);

  const categories = [
    { name: 'Sweepstakes', emoji: '\u{1F389}', label: 'SWEEPSTAKES ALERT' },
    { name: 'Freebies', emoji: '\u{1F193}', label: 'FREE STUFF ALERT' },
    { name: 'Settlements', emoji: '\u{1F4B0}', label: 'SETTLEMENT ALERT' }
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

    // Pick using seeded random
    const index = Math.floor(rng() * pool.length);
    const item = pool[index];
    postedLinks.add(item.link);

    picks.push({ item, category: cat });
  }

  return picks;
}

// ── Build post text with link ──
function buildPostText(item, category) {
  const title = (item.title || '').slice(0, 120);
  const link = item.link || 'https://allfreealerts.com';

  // Bluesky limit: 300 graphemes. Keep posts compact.
  // Footer: "100s more → allfreealerts.com" (~32) + email CTA (~48) + hashtags (~30) = ~110
  // + emoji+label ~20, newlines ~10 = ~140 overhead
  const overhead = 140;
  const maxTotal = 300 - overhead;
  const maxTitle = Math.min(80, maxTotal - link.length);
  const trimmedTitle = title.length > maxTitle ? title.slice(0, Math.max(30, maxTitle - 1)) + '…' : title;

  const lines = [
    `${category.emoji} ${category.label}`,
    '',
    trimmedTitle,
    '',
    link,
    '',
    `100s more \u{1F449} allfreealerts.com`,
    `\u{1F4EC} Daily inbox deals \u{2192} allfreealerts.com/#subscribe`,
    '#freestuff #sweepstakes #settlements'
  ];

  return lines.join('\n');
}

// ── Compute UTF-8 byte offsets for facets ──
function getByteIndices(text, substring, startFrom) {
  const idx = text.indexOf(substring, startFrom || 0);
  if (idx === -1) return null;
  const before = Buffer.byteLength(text.slice(0, idx), 'utf8');
  const len = Buffer.byteLength(substring, 'utf8');
  return { byteStart: before, byteEnd: before + len };
}

// ── Build facets (clickable links) ──
function buildFacets(text, link) {
  const facets = [];

  // Main deal link
  const linkIndices = getByteIndices(text, link);
  if (linkIndices) {
    facets.push({
      index: linkIndices,
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: link }]
    });
  }

  // Site link (first occurrence — the "100s more" line)
  const siteUrl = 'allfreealerts.com';
  const siteIndices = getByteIndices(text, siteUrl);
  if (siteIndices) {
    facets.push({
      index: siteIndices,
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://allfreealerts.com' }]
    });
  }

  // Subscribe link (second occurrence)
  const subUrl = 'allfreealerts.com/#subscribe';
  const subIndices = getByteIndices(text, subUrl);
  if (subIndices) {
    facets.push({
      index: subIndices,
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://allfreealerts.com/#subscribe' }]
    });
  }

  // Hashtags
  const hashtagPattern = /#\w+/g;
  let match;
  while ((match = hashtagPattern.exec(text)) !== null) {
    const tag = match[0];
    const indices = getByteIndices(text, tag, match.index);
    if (indices) {
      facets.push({
        index: indices,
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tag.slice(1) }]
      });
    }
  }

  return facets;
}

// ── HTTPS request helper ──
function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── AT Protocol: Create Session ──
async function createSession() {
  const body = JSON.stringify({
    identifier: BLUESKY_HANDLE,
    password: BLUESKY_APP_PASSWORD
  });

  const result = await request('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  console.log(`Authenticated as ${result.handle} (DID: ${result.did})`);
  return { accessJwt: result.accessJwt, did: result.did };
}

// ── AT Protocol: Create Post ──
async function createPost(session, text, facets) {
  const record = {
    $type: 'app.bsky.feed.post',
    text: text,
    createdAt: new Date().toISOString(),
    facets: facets
  };

  const body = JSON.stringify({
    repo: session.did,
    collection: 'app.bsky.feed.post',
    record: record
  });

  const result = await request('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  return result;
}

// ── Main ──
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('AllFreeAlerts Bluesky Auto-Poster');
  console.log('==================================');
  if (dryRun) console.log('DRY RUN MODE — nothing will be posted\n');
  else console.log('LIVE MODE — posts will be sent to Bluesky\n');

  if (!dryRun && !BLUESKY_APP_PASSWORD) {
    console.error('Error: BLUESKY_APP_PASSWORD environment variable is required.');
    process.exit(1);
  }

  const picks = pickDeals();
  console.log(`${picks.length} posts ready\n`);

  if (picks.length === 0) {
    console.log('No new items to post. Done!');
    return;
  }

  let session = null;
  if (!dryRun) {
    session = await createSession();
  }

  const history = loadHistory();

  for (let i = 0; i < picks.length; i++) {
    const { item, category } = picks[i];
    const text = buildPostText(item, category);
    const facets = buildFacets(text, item.link || 'https://allfreealerts.com');

    console.log(`\n--- Post ${i + 1} of ${picks.length} (${category.name}) ---`);
    console.log(text);
    console.log(`(${Buffer.byteLength(text, 'utf8')} bytes, ${facets.length} facets)\n`);

    if (!dryRun) {
      try {
        const result = await createPost(session, text, facets);
        console.log(`Posted! URI: ${result.uri}`);

        if (item.link) {
          history.posted.push(item.link);
        }
        // Keep history manageable
        if (history.posted.length > 500) {
          history.posted = history.posted.slice(-500);
        }
      } catch (err) {
        console.error(`Failed to post ${i + 1}:`, err.message);
      }

      // Small delay between posts
      if (i < picks.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (!dryRun) {
    saveHistory(history);
    console.log('\nDone! History saved.');
  } else {
    console.log('\nDry run complete. No posts sent.');
  }
}

main().catch(console.error);
