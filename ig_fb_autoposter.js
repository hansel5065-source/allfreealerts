/**
 * AllFreeAlerts — Instagram & Facebook Auto-Poster with Deal-Specific Images
 * Generates branded images per deal, deploys to site, posts to IG + FB
 * Uses Instagram Graph API + Facebook Page API via System User tokens
 *
 * Usage: node ig_fb_autoposter.js [--dry-run]
 * GitHub Actions: runs daily after scraper + deploy
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── API Credentials ──
const IG_USER_ID = '17841436221523604';
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN || 'EAASCIjhOZCgMBRCpmzEw6zXbZA1VSZABhvR1TtJABDEzqcFphAxtsYoK0bYEnBADmE7qRkCyHqne6aj5hd1nLMPMiopzb7llbZBlf9E9WJtUmrleRUBAMli0EUSuQEA7ol1GZCNNOO7webD02cHYCUDPzDFt9mpxnV0KIGODsckoWn6JZC1NXDF3Awmkf9MgZDZD';
const FB_PAGE_ID = '1127348030451082';
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || 'EAASCIjhOZCgMBROPK3EAZChZB6YHsw8cEQxbyechAPOqYhZCpAYyu15LkSd0CyNvc6CFvldUZAZAPHgIPWe1xUcPg0pXYbBtE7NvzT2GlLzHQ9RZAH2vA0mlfXH9WWS4ZBOgHXQ97RMf6eROSgpK4eRoLyuaje7ZB4hUUJa8TZAhWcduv0klZAzFY3ZAunNHsR6UwTXbl9k0XVtH';
const API_VERSION = 'v25.0';
const SITE_BASE = 'https://allfreealerts.com';

// ── Brand Colors ──
const COLORS = {
  teal: '#0ABAB5',
  orange: '#FF6F3C',
  gold: '#F5A623',
  dark: '#0e1628',
  red: '#ff3333'
};

// ── Image Templates (HTML for each category) ──
function generateImageHTML(item, category) {
  const title = (item.title || '').slice(0, 80);
  const summary = (item.prize_summary || '').slice(0, 120);

  if (category === 'Sweepstakes') {
    return `<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
      .card{width:1080px;height:1080px;background:linear-gradient(135deg,${COLORS.teal} 0%,#087f7b 50%,#065a57 100%);
        display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif}
      .card::before{content:'';position:absolute;top:-100px;right:-100px;width:400px;height:400px;border-radius:50%;background:rgba(255,111,60,0.15)}
      .emoji{font-size:80px;margin-bottom:30px;z-index:1}
      .badge{background:${COLORS.orange};color:white;padding:10px 30px;border-radius:50px;font-size:24px;font-weight:800;
        letter-spacing:2px;margin-bottom:30px;z-index:1}
      .title{font-size:48px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px;
        text-shadow:0 2px 10px rgba(0,0,0,0.2)}
      .sub{font-size:28px;color:rgba(255,255,255,0.85);text-align:center;z-index:1;line-height:1.4}
      .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
        background:rgba(0,0,0,0.3);padding:12px 30px;border-radius:50px;z-index:1}
      .brand span{color:${COLORS.orange}}
    </style></head><body><div class="card">
      <div class="emoji">🎉</div>
      <div class="badge">SWEEPSTAKES ALERT</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">${summary ? escapeHtml(summary) : 'Enter now for a chance to win!'}</div>
      <div class="brand">All<span>Free</span>Alerts.com</div>
    </div></body></html>`;
  }

  if (category === 'Freebies') {
    return `<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
      .card{width:1080px;height:1080px;background:linear-gradient(135deg,${COLORS.orange} 0%,#e85525 50%,#c44218 100%);
        display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif}
      .card::before{content:'';position:absolute;top:-80px;left:-80px;width:350px;height:350px;border-radius:50%;background:rgba(10,186,181,0.15)}
      .emoji{font-size:80px;margin-bottom:30px;z-index:1}
      .badge{background:white;color:${COLORS.orange};padding:10px 30px;border-radius:50px;font-size:24px;font-weight:800;
        letter-spacing:2px;margin-bottom:30px;z-index:1}
      .title{font-size:46px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px}
      .sub{font-size:28px;color:rgba(255,255,255,0.9);text-align:center;z-index:1}
      .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
        background:rgba(0,0,0,0.3);padding:12px 30px;border-radius:50px;z-index:1}
      .brand span{color:${COLORS.teal}}
    </style></head><body><div class="card">
      <div class="emoji">🎁</div>
      <div class="badge">FREE STUFF ALERT</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">No purchase necessary. No credit card.</div>
      <div class="brand">All<span>Free</span>Alerts.com</div>
    </div></body></html>`;
  }

  if (category === 'Settlements') {
    return `<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
      .card{width:1080px;height:1080px;background:linear-gradient(135deg,${COLORS.gold} 0%,#e8950f 50%,#c47e0a 100%);
        display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif}
      .card::before{content:'';position:absolute;top:-100px;right:-100px;width:400px;height:400px;border-radius:50%;background:rgba(255,255,255,0.1)}
      .badge{background:${COLORS.red};color:white;padding:10px 30px;border-radius:50px;font-size:24px;font-weight:800;
        letter-spacing:2px;margin-bottom:30px;z-index:1}
      .emoji{font-size:80px;margin-bottom:20px;z-index:1}
      .title{font-size:44px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px}
      .sub{font-size:28px;color:rgba(255,255,255,0.9);text-align:center;z-index:1;line-height:1.4}
      .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
        background:rgba(0,0,0,0.3);padding:12px 30px;border-radius:50px;z-index:1}
      .brand span{color:${COLORS.teal}}
    </style></head><body><div class="card">
      <div class="badge">⚠️ SETTLEMENT ALERT</div>
      <div class="emoji">💰</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">${summary ? escapeHtml(summary) : 'You may be owed money. Check if you qualify.'}</div>
      <div class="brand">All<span>Free</span>Alerts.com</div>
    </div></body></html>`;
  }

  // Fallback
  return generateImageHTML(item, 'Freebies');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Generate PNG from HTML using Puppeteer ──
async function generateImage(item, category, index) {
  const imgDir = path.join(__dirname, 'site', 'social', 'generated');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  const htmlPath = path.join(imgDir, `post_${index}.html`);
  const pngPath = path.join(imgDir, `post_${index}.png`);

  const html = generateImageHTML(item, category);
  fs.writeFileSync(htmlPath, html);

  try {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
    await page.screenshot({ path: pngPath, type: 'png' });
    await browser.close();
    fs.unlinkSync(htmlPath); // cleanup HTML
    console.log(`🖼️  Image generated: post_${index}.png`);
    return `${SITE_BASE}/social/generated/post_${index}.png`;
  } catch (e) {
    console.error(`⚠️  Puppeteer failed: ${e.message}`);
    return null;
  }
}

// ── Cross-Promotion Lines (rotate randomly) ──
const IG_CROSS_PROMO = [
  '📘 Facebook · 🐦 X @allabordfree · 🎵 TikTok @allfreealerts',
  '🔗 Also on Facebook, X (@allabordfree) & TikTok!',
];
const FB_CROSS_PROMO = [
  '📸 IG @allfreealerts · 🐦 X @allabordfree · 🎵 TikTok @allfreealerts',
  '🔗 Also on Instagram, X (@allabordfree) & TikTok!',
];
function pickPromo(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Instagram Caption Templates ──
const IG_TEMPLATES = {
  Sweepstakes: [
    (i) => `🎉 SWEEPSTAKES ALERT 🎉\n\n${i.title}\n\n${i.prize_summary ? '🏆 ' + i.prize_summary.slice(0, 150) : 'Enter now for a chance to win!'}\n\n👉 Link in bio — allfreealerts.com\n📱 Follow @allfreealerts for daily finds!\n${pickPromo(IG_CROSS_PROMO)}\n\n#sweepstakes #giveaway #win #entertowin #contest #free #prizes #allfreealerts #sweepstakesalert #winprizes`,
    (i) => `WIN something amazing today! 🏆✨\n\n${i.title}\n\n${i.prize_summary ? i.prize_summary.slice(0, 150) : 'Free to enter — no purchase necessary!'}\n\n👉 allfreealerts.com (link in bio)\n${pickPromo(IG_CROSS_PROMO)}\n\n#sweepstakes #giveaway #winbig #freeprizes #entertowin #contest #allfreealerts #dailygiveaway`
  ],
  Freebies: [
    (i) => `🆓 FREE STUFF ALERT 🆓\n\n${i.title}\n\nNo purchase necessary. No credit card. No catch.\nGet yours before it's gone!\n\n👉 Link in bio — allfreealerts.com\n📱 Follow @allfreealerts for daily freebies!\n${pickPromo(IG_CROSS_PROMO)}\n\n#freestuff #freebie #freesample #free #nopurchasenecessary #freebies #savemoney #allfreealerts #freesamples #deals`,
    (i) => `This is completely FREE 👇🎁\n\n${i.title}\n\nGrab it while supplies last!\n\n👉 allfreealerts.com (link in bio)\n${pickPromo(IG_CROSS_PROMO)}\n\n#free #freebie #freesample #freestuff #savemoney #frugal #allfreealerts #dailydeals #freebiesusa`
  ],
  Settlements: [
    (i) => `💰 CLASS ACTION SETTLEMENT 💰\n\n${i.title}\n\n${i.prize_summary ? '💵 ' + i.prize_summary.slice(0, 150) + '\n' : 'You may be owed money!\n'}${i.proof_required === 'No' ? '✅ No proof of purchase needed!\n' : ''}\nFile your claim today!\n👉 Link in bio — allfreealerts.com\n${pickPromo(IG_CROSS_PROMO)}\n\n#classaction #settlement #freemoney #moneytok #refund #claim #allfreealerts #classactionsettlement #easymoney`,
    (i) => `You might be owed money 💵💵\n\n${i.title}\n${i.prize_summary ? '\n💰 ' + i.prize_summary.slice(0, 150) : ''}${i.proof_required === 'No' ? '\n✅ No receipt needed — just file a claim!' : ''}\n\nCheck if you qualify 👉 allfreealerts.com\n${pickPromo(IG_CROSS_PROMO)}\n\n#settlement #classaction #freemoney #moneyhack #allfreealerts #refund #claimyourmoney`
  ]
};

// ── Facebook Post Template ──
function buildFBText(posts) {
  let text = '🔥 Today\'s FREE Finds from AllFreeAlerts.com:\n\n';
  for (const p of posts) {
    if (p.category === 'Sweepstakes') {
      text += `🎉 SWEEPSTAKES: ${p.item.title}\n`;
      if (p.item.prize_summary) text += `   ${p.item.prize_summary.slice(0, 100)}\n`;
    } else if (p.category === 'Freebies') {
      text += `🎁 FREE: ${p.item.title}\n`;
    } else if (p.category === 'Settlements') {
      text += `💰 SETTLEMENT: ${p.item.title}\n`;
      if (p.item.prize_summary) text += `   ${p.item.prize_summary.slice(0, 100)}\n`;
      if (p.item.proof_required === 'No') text += '   ✅ No proof needed!\n';
    }
    text += '\n';
  }
  text += '👉 See all deals at allfreealerts.com\n';
  text += '📱 Follow us for daily alerts!\n';
  text += pickPromo(FB_CROSS_PROMO);
  return text;
}

// ── HTTP Helper ──
function graphAPI(method, endpoint, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const url = `https://graph.facebook.com/${API_VERSION}/${endpoint}`;

    if (method === 'GET') {
      const getUrl = url + '?' + body;
      https.get(getUrl, (res) => {
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

// ── Load Data + Pick Items ──
const HISTORY_FILE = path.join(__dirname, 'ig_fb_post_history.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return { posted: [] }; }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function loadData() {
  try {
    // Try internal data first (has source field, not encoded)
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'results.json'), 'utf8'));
  } catch {
    try {
      // Fallback: decode encoded site/data.json
      const raw = fs.readFileSync(path.join(__dirname, 'site', 'data.json'), 'utf8');
      const key = 'aFa2026xK';
      const b = Buffer.from(raw, 'base64');
      const decoded = Buffer.from(b.map((v, i) => v ^ key.charCodeAt(i % key.length)));
      return JSON.parse(decoded.toString('utf8'));
    } catch { return []; }
  }
}

function pickItems() {
  const data = loadData();
  const history = loadHistory();
  const postedLinks = new Set(history.posted || []);
  const today = new Date().toISOString().split('T')[0];
  const picks = [];

  for (const cat of ['Sweepstakes', 'Freebies', 'Settlements']) {
    let catItems = data.filter(i => i.category === cat && !postedLinks.has(i.link));
    // Settlements: only nationwide (skip state-specific)
    if (cat === 'Settlements') {
      catItems = catItems.filter(i => !i.scope || i.scope === 'nationwide');
    }
    const newItems = catItems.filter(i => i.date_found === today);
    const pool = newItems.length > 0 ? newItems : catItems;

    if (pool.length > 0) {
      const item = pool[Math.floor(Math.random() * pool.length)];
      const templates = IG_TEMPLATES[cat] || IG_TEMPLATES.Freebies;
      const caption = templates[Math.floor(Math.random() * templates.length)](item);
      picks.push({ category: cat, item, caption });
    }
  }

  return picks;
}

// ── Wait for container to be ready ──
async function waitForContainer(containerId) {
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await graphAPI('GET', containerId, {
      fields: 'status_code',
      access_token: IG_ACCESS_TOKEN
    });
    if (status.status_code === 'FINISHED') return true;
    if (status.status_code === 'ERROR') throw new Error(`Container ${containerId} failed`);
  }
  throw new Error(`Container ${containerId} not ready after 45s`);
}

// ── Post Instagram Carousel (multiple images in one post) ──
async function postInstagramCarousel(picks, caption) {
  // Step 1: Create child containers for each slide
  const childIds = [];
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    console.log(`📸 Creating carousel slide ${i + 1}/${picks.length} (${pick.category})...`);
    const child = await graphAPI('POST', `${IG_USER_ID}/media`, {
      image_url: pick.imageUrl,
      is_carousel_item: 'true',
      access_token: IG_ACCESS_TOKEN
    });
    if (child.error) throw new Error(`Slide ${i + 1} failed: ${child.error.message}`);
    childIds.push(child.id);
    await waitForContainer(child.id);
    console.log(`✅ Slide ${i + 1} ready`);
  }

  // Step 2: Create carousel container with all children
  console.log('📦 Creating carousel container...');
  const carousel = await graphAPI('POST', `${IG_USER_ID}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption,
    access_token: IG_ACCESS_TOKEN
  });
  if (carousel.error) throw new Error(`Carousel failed: ${carousel.error.message}`);
  await waitForContainer(carousel.id);

  // Step 3: Publish
  console.log('📤 Publishing carousel to Instagram...');
  const result = await graphAPI('POST', `${IG_USER_ID}/media_publish`, {
    creation_id: carousel.id,
    access_token: IG_ACCESS_TOKEN
  });
  if (result.error) throw new Error(`Publish failed: ${result.error.message}`);
  return result.id;
}

// ── Build carousel caption (combined for all deals) ──
function buildCarouselCaption(picks) {
  let caption = '\u{1F525} Today\u2019s FREE Finds \u2014 Swipe Through! \u{1F449}\n\n';
  for (const p of picks) {
    if (p.category === 'Sweepstakes') {
      caption += `\u{1F389} SWEEPSTAKES: ${p.item.title}\n`;
      if (p.item.prize_summary) caption += `   ${p.item.prize_summary.slice(0, 100)}\n`;
    } else if (p.category === 'Freebies') {
      caption += `\u{1F381} FREE: ${p.item.title}\n`;
      caption += '   No purchase necessary!\n';
    } else if (p.category === 'Settlements') {
      caption += `\u{1F4B0} SETTLEMENT: ${p.item.title}\n`;
      if (p.item.prize_summary) caption += `   ${p.item.prize_summary.slice(0, 100)}\n`;
      if (p.item.proof_required === 'No') caption += '   \u2705 No proof needed!\n';
    }
    caption += '\n';
  }
  caption += '\u{1F449} Link in bio \u2014 allfreealerts.com\n';
  caption += '\u{1F4F1} Follow @allfreealerts for daily finds!\n';
  caption += pickPromo(IG_CROSS_PROMO) + '\n\n';
  caption += '#freestuff #sweepstakes #classaction #settlement #freebie #giveaway #freemoney #savemoney #freesample #allfreealerts';
  return caption;
}

// ── Post to Facebook (photo post with caption) ──
async function postToFacebook(text, imageUrl) {
  console.log('📘 Posting photo to Facebook Page...');
  const params = {
    message: text,
    access_token: FB_PAGE_TOKEN
  };
  // If we have an image URL, post as photo (looks much better)
  if (imageUrl) {
    params.url = imageUrl;
    const result = await graphAPI('POST', `${FB_PAGE_ID}/photos`, params);
    if (result.error) throw new Error(`FB photo post failed: ${result.error.message}`);
    return result.id;
  }
  // Fallback: text + link post
  params.link = 'https://allfreealerts.com';
  const result = await graphAPI('POST', `${FB_PAGE_ID}/feed`, params);
  if (result.error) throw new Error(`FB post failed: ${result.error.message}`);
  return result.id;
}

// ── QA Checks ──
function runQA(pick) {
  const errors = [];
  // Content checks
  if (!pick.item.title || pick.item.title.trim() === '') errors.push('Missing title');
  if (pick.caption.includes('undefined')) errors.push('Caption contains "undefined"');
  if (pick.caption.includes('null')) errors.push('Caption contains "null"');
  if (!pick.caption.includes('allfreealerts')) errors.push('Missing site link');
  if (!pick.caption.includes('#')) errors.push('Missing hashtags');
  if (pick.caption.length > 2200) errors.push(`IG caption too long (${pick.caption.length}/2200)`);
  // Emoji encoding check — make sure emojis are actual unicode, not garbled
  if (pick.caption.includes('??') || pick.caption.includes('�')) errors.push('Broken emoji encoding');
  // Link check
  if (!pick.item.link || pick.item.link.trim() === '') errors.push('Missing deal link');
  if (pick.item.link && pick.item.link.includes(' ')) errors.push('Deal link contains spaces');
  // Category check
  if (!['Sweepstakes', 'Freebies', 'Settlements'].includes(pick.category)) errors.push('Invalid category');
  return errors;
}

// ── Verify image is publicly accessible ──
async function verifyImageUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        // Read a few bytes to confirm it's actually an image
        let data = Buffer.alloc(0);
        res.on('data', chunk => {
          data = Buffer.concat([data, chunk]);
          if (data.length > 8) res.destroy(); // only need header bytes
        });
        res.on('close', () => {
          // Check for PNG or JPEG magic bytes
          const isPNG = data[0] === 0x89 && data[1] === 0x50;
          const isJPEG = data[0] === 0xFF && data[1] === 0xD8;
          if (isPNG || isJPEG) resolve(true);
          else { console.log('⚠️  URL returned non-image content'); resolve(false); }
        });
      } else {
        console.log(`⚠️  Image URL returned ${res.statusCode}`);
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

// ── Main ──
async function main() {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--preview');

  console.log('📱 AllFreeAlerts IG + FB Auto-Poster');
  console.log('=====================================');
  if (dryRun) console.log('🔍 DRY RUN MODE — nothing will be posted\n');
  else console.log('🚀 LIVE MODE — posts will be published\n');

  const picks = pickItems();
  console.log(`📝 ${picks.length} posts ready\n`);

  if (picks.length === 0) {
    console.log('No new items to post. Done!');
    return;
  }

  const history = loadHistory();

  // Generate images for each pick
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    console.log(`\n--- Post ${i + 1} of ${picks.length} (${pick.category}) ---`);
    console.log(`Title: ${pick.item.title}`);
    console.log(`Caption: ${pick.caption.slice(0, 100)}...`);

    // QA checks
    const qaErrors = runQA(pick);
    if (qaErrors.length > 0) {
      console.log(`⚠️  QA FAILED: ${qaErrors.join(', ')}`);
      pick.skip = true;
      continue;
    }
    console.log('✅ QA passed');

    // Generate deal-specific image
    const imageUrl = await generateImage(pick.item, pick.category, i);
    pick.imageUrl = imageUrl;

    if (imageUrl) {
      console.log(`🖼️  Image URL: ${imageUrl}`);
    }
  }

  // Deploy images to Cloudflare so Instagram can fetch them by URL
  if (!dryRun) {
    console.log('\n☁️  Deploying images to Cloudflare...');
    try {
      const { execSync } = require('child_process');
      const deployCmd = 'npx wrangler pages deploy site/ --project-name=allfreealerts --commit-dirty=true';
      execSync(deployCmd, { cwd: __dirname, stdio: 'pipe', timeout: 60000 });
      console.log('✅ Images deployed to Cloudflare');
      // Wait for CDN propagation
      console.log('⏳ Waiting 15s for CDN propagation...');
      await new Promise(r => setTimeout(r, 15000));
    } catch (e) {
      console.error(`⚠️  Deploy failed: ${e.message}`);
      console.log('Images may not be accessible — proceeding anyway (GitHub Actions deploys separately)');
    }
  }

  if (!dryRun) {
    // Verify all images are accessible before posting
    const igPicks = [];
    for (const pick of picks) {
      if (pick.skip || !pick.imageUrl) continue;
      const imageOk = await verifyImageUrl(pick.imageUrl);
      if (imageOk) {
        igPicks.push(pick);
      } else {
        console.log(`⚠️  Image not accessible: ${pick.imageUrl}`);
      }
    }

    // Post carousel to Instagram (all deals in one swipeable post)
    if (igPicks.length >= 2) {
      try {
        const carouselCaption = buildCarouselCaption(igPicks);
        const mediaId = await postInstagramCarousel(igPicks, carouselCaption);
        console.log(`✅ Instagram carousel posted! Media ID: ${mediaId} (${igPicks.length} slides)`);
        for (const p of igPicks) {
          if (p.item.link) history.posted.push(p.item.link);
        }
      } catch (e) {
        console.error(`❌ Instagram carousel failed: ${e.message}`);
      }
    } else if (igPicks.length === 1) {
      // Fallback: single image post if only 1 deal
      const pick = igPicks[0];
      try {
        console.log('📸 Creating single IG post (only 1 deal available)...');
        const container = await graphAPI('POST', `${IG_USER_ID}/media`, {
          image_url: pick.imageUrl,
          caption: pick.caption,
          access_token: IG_ACCESS_TOKEN
        });
        if (container.error) throw new Error(container.error.message);
        await waitForContainer(container.id);
        const result = await graphAPI('POST', `${IG_USER_ID}/media_publish`, {
          creation_id: container.id,
          access_token: IG_ACCESS_TOKEN
        });
        if (result.error) throw new Error(result.error.message);
        console.log(`✅ Instagram posted! Media ID: ${result.id}`);
        if (pick.item.link) history.posted.push(pick.item.link);
      } catch (e) {
        console.error(`❌ Instagram failed: ${e.message}`);
      }
    } else {
      console.log('⚠️  No IG posts — no accessible images');
    }

    // Post Facebook — one photo post per deal (with image)
    const activePicks = picks.filter(p => !p.skip && p.imageUrl);
    for (let i = 0; i < activePicks.length; i++) {
      const pick = activePicks[i];
      try {
        const fbCaption = `${pick.caption.split('\n\n#')[0]}\n\n👉 allfreealerts.com`;
        const fbPostId = await postToFacebook(fbCaption, pick.imageUrl);
        console.log(`✅ Facebook posted! Post ID: ${fbPostId}`);
      } catch (e) {
        console.error(`❌ Facebook failed for ${pick.category}: ${e.message}`);
      }
      if (i < activePicks.length - 1) await new Promise(r => setTimeout(r, 3000));
    }

    // Save history
    if (history.posted.length > 500) history.posted = history.posted.slice(-500);
    saveHistory(history);
    console.log('\n✅ Done! History saved.');
  } else {
    console.log('\n📋 Preview complete. Images in site/social/generated/');
    console.log('\nFacebook post would be:');
    console.log(buildFBText(picks));
  }

  // Cleanup HTML files
  const genDir = path.join(__dirname, 'site', 'social', 'generated');
  if (fs.existsSync(genDir)) {
    fs.readdirSync(genDir).filter(f => f.endsWith('.html')).forEach(f =>
      fs.unlinkSync(path.join(genDir, f))
    );
  }
}

main().catch(console.error);
