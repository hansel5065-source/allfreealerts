/**
 * AllFreeAlerts — X/Twitter Auto-Poster with Auto-Generated Images
 * Posts 2-3 tweets per day from scraped data with branded graphics
 * Uses X API v2 with OAuth 1.0a
 *
 * Usage: node x_autoposter.js [--dry-run]
 * GitHub Actions: runs daily after scraper
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── API Credentials ──
const CREDENTIALS = {
  apiKey: process.env.X_API_KEY || 'hcHHkgItx9BJSC0lDzOxrBzKY',
  apiSecret: process.env.X_API_SECRET || 'koo2rgcY5oghVHxTP6p01WNLtP22eitnp1kvMYO40Bmb0qZazP',
  accessToken: process.env.X_ACCESS_TOKEN || '2037735445518229504-FI76g7VEpXu6LOn55wQ36OFnglh0yA',
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || '95iYsY2WZFcRSGmCpshYnnoY2Zpsy2XgGrYkHk2NJkwN4'
};

// ── Brand Colors ──
const COLORS = {
  teal: '#0ABAB5',
  orange: '#FF6F3C',
  gold: '#F5A623',
  dark: '#0e1628',
  darkBlue: '#162038',
  red: '#ff3333'
};

// ── Image Templates (HTML for each category) ──
function generateImageHTML(item, category) {
  const title = (item.title || '').slice(0, 80);
  const summary = (item.prize_summary || '').slice(0, 100);

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

  // General
  const count = getItemCount();
  return `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
    .card{width:1080px;height:1080px;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);
      display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
      font-family:'Segoe UI',Arial,sans-serif}
    .items{z-index:1;width:100%;margin-bottom:40px}
    .item{display:flex;align-items:center;margin-bottom:24px;font-size:38px;color:white;font-weight:600}
    .icon{width:70px;height:70px;border-radius:16px;display:flex;align-items:center;justify-content:center;
      font-size:36px;margin-right:24px;flex-shrink:0}
    .i1{background:${COLORS.teal}} .i2{background:${COLORS.orange}} .i3{background:${COLORS.gold}}
    .title{font-size:48px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px}
    .hl{color:${COLORS.teal}}
    .sub{font-size:28px;color:rgba(255,255,255,0.7);text-align:center;z-index:1}
    .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
      background:rgba(10,186,181,0.3);padding:12px 30px;border-radius:50px;z-index:1}
    .brand span{color:${COLORS.orange}}
  </style></head><body><div class="card">
    <div class="items">
      <div class="item"><div class="icon i1">🎁</div> Free Samples</div>
      <div class="item"><div class="icon i2">🎉</div> Sweepstakes</div>
      <div class="item"><div class="icon i3">💰</div> Settlement Payouts</div>
    </div>
    <div class="title">${count} <span class="hl">free things</span><br>on one website.</div>
    <div class="sub">Updated daily. Completely free.</div>
    <div class="brand">All<span>Free</span>Alerts.com</div>
  </div></body></html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Generate PNG from HTML using Puppeteer ──
async function generateImage(item, category, index) {
  const tmpDir = path.join(__dirname, 'tmp_images');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const htmlPath = path.join(tmpDir, `tweet_${index}.html`);
  const pngPath = path.join(tmpDir, `tweet_${index}.png`);

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
    console.log(`🖼️  Image generated: tweet_${index}.png`);
    return pngPath;
  } catch (e) {
    console.log(`⚠️  Puppeteer not available, posting without image: ${e.message}`);
    return null;
  }
}

// ── Tweet Templates ──
const TEMPLATES = {
  sweepstakes: [
    (item) => `🎉 SWEEPSTAKES ALERT\n\n${item.title}\n\n${item.prize_summary ? item.prize_summary.slice(0, 100) + '...' : 'Enter now for a chance to win!'}\n\n${item.end_date ? '⏰ Ends: ' + item.end_date + '\n' : ''}👉 allfreealerts.com\n\n#sweepstakes #giveaway #win #free #allfreealerts`,
    (item) => `Win something amazing today! 🏆\n\n${item.title}\n\n${item.end_date ? 'Deadline: ' + item.end_date + '\n' : ''}Find it on 👉 allfreealerts.com\n\n#entertowin #sweepstakes #contest #free`,
    (item) => `Don't miss this one 👀\n\n${item.title}\n\n${item.prize_summary ? item.prize_summary.slice(0, 120) : 'Free to enter!'}\n\n👉 allfreealerts.com\n\n#giveaway #sweepstakes #win #allfreealerts`
  ],
  freebies: [
    (item) => `🆓 FREE STUFF ALERT\n\n${item.title}\n\nNo purchase necessary. Get yours before it's gone!\n\n👉 allfreealerts.com\n\n#freestuff #freebie #freesample #allfreealerts`,
    (item) => `This is completely FREE 👇\n\n${item.title}\n\nNo credit card. No catch.\n\nFind it at 👉 allfreealerts.com\n\n#free #freebie #freesample #freestuff`,
    (item) => `Today's freebie find 🎁\n\n${item.title}\n\nGrab it while supplies last 👉 allfreealerts.com\n\n#freebies #freestuff #savemoney #allfreealerts`
  ],
  settlements: [
    (item) => `💰 CLASS ACTION ALERT\n\n${item.title}\n\n${item.prize_summary ? item.prize_summary.slice(0, 100) + '...' : 'You may be owed money!'}\n\nFile your claim 👉 allfreealerts.com\n\n#classaction #settlement #freemoney #allfreealerts`,
    (item) => `You might be owed money 💵\n\n${item.title}\n\nCheck if you qualify 👉 allfreealerts.com\n\n#settlement #classaction #moneytok #allfreealerts`,
    (item) => `Don't leave money on the table!\n\n${item.title}\n\n${item.prize_summary ? item.prize_summary.slice(0, 100) : 'Check if you qualify.'}\n\n👉 allfreealerts.com\n\n#classaction #freemoney #settlement`
  ],
  general: [
    () => `🔥 ${getItemCount()} free things on ONE website right now.\n\nSweepstakes. Freebies. Settlement payouts.\n\nUpdated daily. Completely free.\n\n👉 allfreealerts.com\n\n#freestuff #sweepstakes #freebies #settlements #allfreealerts`,
    () => `You're leaving free money on the table every single month.\n\nFree samples. Sweepstakes. Class action settlements.\n\nWe find them so you don't have to.\n\n👉 allfreealerts.com\n\n#free #savemoney #freemoney #allfreealerts`,
    () => `Most people don't know this, but companies that lose class action lawsuits have to pay you money.\n\nThe catch? You have to file a claim before the deadline.\n\nWe track every open settlement:\n👉 allfreealerts.com\n\n#classaction #freemoney #allfreealerts`
  ]
};

// ── History tracking (avoid duplicate tweets) ──
const HISTORY_FILE = path.join(__dirname, 'x_post_history.json');

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return { posted: [], lastGeneral: 0 };
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ── Load scraped data ──
function loadData() {
  const dataFile = path.join(__dirname, 'site', 'data.json');
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (e) {
    console.error('Could not load data.json:', e.message);
    return [];
  }
}

function getItemCount() {
  return loadData().length;
}

// ── Pick items to tweet ──
function pickItems() {
  const data = loadData();
  const history = loadHistory();
  const postedLinks = new Set(history.posted || []);

  const today = new Date().toISOString().split('T')[0];
  const categories = ['Sweepstakes', 'Freebies', 'Settlements'];
  const tweets = [];

  for (const cat of categories) {
    const catItems = data.filter(i =>
      i.category === cat && !postedLinks.has(i.link)
    );

    const newItems = catItems.filter(i => i.date_found === today);
    const pool = newItems.length > 0 ? newItems : catItems;

    if (pool.length > 0) {
      const item = pool[Math.floor(Math.random() * pool.length)];
      const templateKey = cat.toLowerCase();
      const templates = TEMPLATES[templateKey] || TEMPLATES.freebies;
      const template = templates[Math.floor(Math.random() * templates.length)];

      let text = template(item);
      if (text.length > 280) text = text.slice(0, 277) + '...';
      tweets.push({ text, link: item.link, type: cat, item });
    }
  }

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  if (dayOfYear % 3 === 0) {
    const genTemplates = TEMPLATES.general;
    const template = genTemplates[dayOfYear % genTemplates.length];
    let text = template();
    if (text.length > 280) text = text.slice(0, 277) + '...';
    tweets.push({ text, link: null, type: 'general', item: null });
  }

  return tweets;
}

// ── OAuth 1.0a Signature ──
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/\*/g, '%2A')
    .replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k =>
    `${percentEncode(k)}=${percentEncode(params[k])}`
  ).join('&');
  const baseString = `${method}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function generateOAuthHeader(method, url) {
  const oauthParams = {
    oauth_consumer_key: CREDENTIALS.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: CREDENTIALS.accessToken,
    oauth_version: '1.0'
  };
  const signature = generateOAuthSignature(method, url, oauthParams, CREDENTIALS.apiSecret, CREDENTIALS.accessTokenSecret);
  oauthParams.oauth_signature = signature;
  return 'OAuth ' + Object.keys(oauthParams).sort().map(k =>
    `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`
  ).join(', ');
}

// ── Upload Media to X (v1.1 media upload) ──
function uploadMedia(imagePath) {
  return new Promise((resolve, reject) => {
    const imageData = fs.readFileSync(imagePath);
    const base64 = imageData.toString('base64');

    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');

    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="media_data"\r\n\r\n`,
      `${base64}\r\n`,
      `--${boundary}--\r\n`
    ];
    const body = bodyParts.join('');

    const authHeader = generateOAuthHeader('POST', url);

    const options = {
      hostname: 'upload.twitter.com',
      path: '/1.1/media/upload.json',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          console.log(`📤 Image uploaded! Media ID: ${result.media_id_string}`);
          resolve(result.media_id_string);
        } else {
          console.error(`❌ Media upload failed (${res.statusCode}): ${data}`);
          resolve(null); // Don't fail, just post without image
        }
      });
    });

    req.on('error', (e) => { console.error('Upload error:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── Post Tweet (with optional media) ──
function postTweet(text, mediaId) {
  return new Promise((resolve, reject) => {
    const url = 'https://api.x.com/2/tweets';
    const payload = { text };
    if (mediaId) {
      payload.media = { media_ids: [mediaId] };
    }
    const body = JSON.stringify(payload);
    const authHeader = generateOAuthHeader('POST', url);

    const options = {
      hostname: 'api.x.com',
      path: '/2/tweets',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          const result = JSON.parse(data);
          console.log(`✅ Tweet posted! ID: ${result.data.id}${mediaId ? ' (with image)' : ''}`);
          resolve(result);
        } else {
          console.error(`❌ Failed (${res.statusCode}): ${data}`);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──
async function main() {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--preview');

  console.log('🐦 AllFreeAlerts X Auto-Poster (with Images)');
  console.log('==============================================');
  if (dryRun) console.log('🔍 DRY RUN MODE — nothing will be posted\n');
  else console.log('🚀 LIVE MODE — tweets will be posted with images\n');

  const tweets = pickItems();
  console.log(`📝 ${tweets.length} tweets ready\n`);

  if (tweets.length === 0) {
    console.log('No new items to tweet. Done!');
    return;
  }

  const history = loadHistory();

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log(`\n--- Tweet ${i + 1} of ${tweets.length} (${tweet.type}) ---`);
    console.log(tweet.text);
    console.log(`(${tweet.text.length} chars)\n`);

    if (!dryRun) {
      try {
        // Step 1: Generate branded image
        const item = tweet.item || { title: '', prize_summary: '' };
        const imagePath = await generateImage(item, tweet.type, i);

        // Step 2: Upload image to X
        let mediaId = null;
        if (imagePath) {
          mediaId = await uploadMedia(imagePath);
        }

        // Step 3: Post tweet with image
        await postTweet(tweet.text, mediaId);

        if (tweet.link) {
          history.posted.push(tweet.link);
        }
        if (history.posted.length > 500) {
          history.posted = history.posted.slice(-500);
        }
      } catch (err) {
        console.error(`Failed to post tweet ${i + 1}:`, err.message);
      }

      if (i < tweets.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      // In dry run, still generate image to preview
      const item = tweet.item || { title: '', prize_summary: '' };
      const imagePath = await generateImage(item, tweet.type, i);
      if (imagePath) console.log(`🖼️  Preview image: ${imagePath}`);
    }
  }

  if (!dryRun) {
    saveHistory(history);
    console.log('\n✅ Done! History saved.');
  } else {
    console.log('\n📋 Preview complete. Images in tmp_images/ folder.');
  }

  // Cleanup tmp images
  const tmpDir = path.join(__dirname, 'tmp_images');
  if (fs.existsSync(tmpDir) && !dryRun) {
    fs.readdirSync(tmpDir).forEach(f => fs.unlinkSync(path.join(tmpDir, f)));
    fs.rmdirSync(tmpDir);
  }
}

main().catch(console.error);
