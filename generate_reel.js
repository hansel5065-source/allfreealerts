/**
 * AllFreeAlerts — Instagram & Facebook Reel Generator
 * Stitches deal images into a 9:16 video with transitions, text overlays, and beat
 *
 * Usage: node generate_reel.js [--dry-run]
 * Requires: ffmpeg, python (for beat generation)
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──
const IG_USER_ID = '17841436221523604';
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN || '';
const FB_PAGE_ID = '1127348030451082';
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || '';
const API_VERSION = 'v25.0';
const SITE_BASE = 'https://allfreealerts.com';
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--preview');

const OUT_DIR = path.join(__dirname, 'tmp_videos');
const IMG_DIR = path.join(__dirname, 'site', 'social', 'generated');
const BEAT_FILE = path.join(OUT_DIR, 'beat.wav');
const REEL_FILE = path.join(OUT_DIR, 'reel.mp4');

// ── Brand ──
const COLORS = { teal: '#0ABAB5', orange: '#FF6F3C', gold: '#F5A623' };
const CAT_COLORS = { Sweepstakes: COLORS.teal, Freebies: COLORS.orange, Settlements: COLORS.gold };
const CAT_EMOJI = { Sweepstakes: '🎉', Freebies: '🎁', Settlements: '💰' };

function log(msg) { console.log(`[Reel] ${msg}`); }

// ── Load data ──
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

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'ig_fb_post_history.json'), 'utf8')); }
  catch { return { posted: [] }; }
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
      picks.push({ category: cat, item });
    }
  }
  return picks;
}

// ── Generate beat ──
function generateBeat() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(BEAT_FILE)) {
    const stat = fs.statSync(BEAT_FILE);
    const age = Date.now() - stat.mtimeMs;
    if (age < 86400000) { // reuse if less than 24h old
      log('Reusing existing beat');
      return;
    }
  }
  log('Generating beat...');
  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(pyCmd, [path.join(__dirname, 'generate_beat.py'), BEAT_FILE], {
    stdio: 'pipe', timeout: 30000
  });
  if (result.status !== 0) {
    log('Beat generation failed: ' + (result.stderr?.toString() || 'unknown error'));
    // Create silent audio as fallback
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 20 "${BEAT_FILE}"`, { stdio: 'pipe' });
  }
  log('Beat ready');
}

// ── Generate slide images (1080x1920 vertical) ──
function generateSlideHTML(item, category, slideNum, totalSlides) {
  const title = (item.title || '').slice(0, 70);
  const summary = (item.prize_summary || item.description || '').slice(0, 100);
  const color = CAT_COLORS[category] || COLORS.teal;
  const emoji = CAT_EMOJI[category] || '🔔';
  const catLabel = category === 'Freebies' ? 'FREE STUFF' : category.toUpperCase();

  // Determine if settlement has deadline
  const deadline = item.end_date || item.deadline || '';
  let deadlineHTML = '';
  if (deadline) {
    const d = new Date(deadline);
    if (!isNaN(d)) {
      const days = Math.max(0, Math.ceil((d - new Date()) / 86400000));
      if (days <= 14) {
        deadlineHTML = `<div class="deadline">⏰ ${days} days left</div>`;
      }
    }
  }

  return `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1080px;height:1920px;display:flex;justify-content:center;align-items:center;
      background:linear-gradient(160deg, #0e1628 0%, #1a1a2e 50%, #0e1628 100%);
      font-family:'Segoe UI',Arial,sans-serif;overflow:hidden}
    .slide{width:1080px;height:1920px;display:flex;flex-direction:column;justify-content:center;
      align-items:center;padding:80px 60px;position:relative}

    /* Decorative elements */
    .bg-circle{position:absolute;border-radius:50%;opacity:0.08}
    .bg-circle.c1{width:600px;height:600px;background:${color};top:-100px;right:-150px}
    .bg-circle.c2{width:400px;height:400px;background:${color};bottom:-50px;left:-100px}
    .bg-circle.c3{width:200px;height:200px;background:white;top:40%;left:10%}

    /* Top badge */
    .top-bar{position:absolute;top:80px;display:flex;align-items:center;gap:15px;z-index:2}
    .logo{font-size:28px;font-weight:900;color:white;letter-spacing:-0.5px}
    .logo span{color:${color}}
    .slide-num{background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);padding:6px 16px;
      border-radius:20px;font-size:18px;font-weight:600}

    /* Main content */
    .emoji{font-size:100px;margin-bottom:30px;z-index:1}
    .badge{background:${color};color:white;padding:14px 40px;border-radius:60px;font-size:26px;
      font-weight:800;letter-spacing:3px;margin-bottom:40px;z-index:1;
      box-shadow:0 8px 30px ${color}66}
    .title{font-size:52px;font-weight:800;color:white;text-align:center;line-height:1.25;z-index:1;
      margin-bottom:25px;text-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:900px}
    .sub{font-size:30px;color:rgba(255,255,255,0.75);text-align:center;z-index:1;line-height:1.5;
      max-width:850px}
    .deadline{margin-top:30px;background:rgba(255,59,48,0.2);border:2px solid rgba(255,59,48,0.4);
      color:#ff6b6b;padding:12px 30px;border-radius:40px;font-size:24px;font-weight:700;z-index:1}

    /* Bottom CTA */
    .cta{position:absolute;bottom:120px;z-index:2;display:flex;flex-direction:column;align-items:center;gap:15px}
    .cta-btn{background:${color};color:white;padding:18px 50px;border-radius:50px;font-size:28px;
      font-weight:800;box-shadow:0 8px 30px ${color}66}
    .cta-sub{color:rgba(255,255,255,0.5);font-size:20px;font-weight:500}

    /* Bottom brand */
    .brand{position:absolute;bottom:50px;font-size:22px;color:rgba(255,255,255,0.3);font-weight:600;z-index:2}
  </style></head><body>
  <div class="slide">
    <div class="bg-circle c1"></div>
    <div class="bg-circle c2"></div>
    <div class="bg-circle c3"></div>

    <div class="top-bar">
      <div class="logo">AllFree<span>Alerts</span></div>
      <div class="slide-num">${slideNum}/${totalSlides}</div>
    </div>

    <div class="emoji">${emoji}</div>
    <div class="badge">${catLabel} ALERT</div>
    <div class="title">${title}</div>
    ${summary ? `<div class="sub">${summary}</div>` : ''}
    ${deadlineHTML}

    <div class="cta">
      <div class="cta-btn">See Details →</div>
      <div class="cta-sub">Link in bio</div>
    </div>

    <div class="brand">allfreealerts.com</div>
  </div>
  </body></html>`;
}

// Intro slide
function generateIntroHTML(count) {
  return `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1080px;height:1920px;display:flex;justify-content:center;align-items:center;
      background:linear-gradient(160deg, #0e1628 0%, #1a1a2e 50%, #0e1628 100%);
      font-family:'Segoe UI',Arial,sans-serif;overflow:hidden}
    .slide{width:1080px;height:1920px;display:flex;flex-direction:column;justify-content:center;
      align-items:center;padding:80px 60px;position:relative}
    .bg-circle{position:absolute;border-radius:50%;opacity:0.1}
    .bg-circle.c1{width:800px;height:800px;background:${COLORS.teal};top:-200px;right:-200px}
    .bg-circle.c2{width:500px;height:500px;background:${COLORS.orange};bottom:-100px;left:-150px}
    .logo{font-size:52px;font-weight:900;color:white;letter-spacing:-1px;margin-bottom:20px;z-index:1}
    .logo span{color:${COLORS.teal}}
    .tagline{font-size:32px;color:rgba(255,255,255,0.6);font-weight:500;margin-bottom:60px;z-index:1}
    .big{font-size:120px;font-weight:900;color:white;z-index:1;margin-bottom:10px;
      text-shadow:0 4px 30px rgba(10,186,181,0.4)}
    .big-sub{font-size:36px;color:${COLORS.teal};font-weight:700;z-index:1;margin-bottom:60px}
    .today{font-size:28px;color:rgba(255,255,255,0.5);z-index:1}
    .swipe{position:absolute;bottom:120px;font-size:26px;color:rgba(255,255,255,0.4);z-index:1;
      display:flex;align-items:center;gap:10px}
  </style></head><body>
  <div class="slide">
    <div class="bg-circle c1"></div>
    <div class="bg-circle c2"></div>
    <div class="logo">AllFree<span>Alerts</span></div>
    <div class="tagline">Free Stuff, Found For You</div>
    <div class="big">${count}+</div>
    <div class="big-sub">Active Deals Right Now</div>
    <div class="today">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
    <div class="swipe">👇 Swipe for today's top picks</div>
  </div>
  </body></html>`;
}

// Outro/CTA slide
function generateOutroHTML() {
  return `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1080px;height:1920px;display:flex;justify-content:center;align-items:center;
      background:linear-gradient(160deg, #0e1628 0%, #1a1a2e 50%, #0e1628 100%);
      font-family:'Segoe UI',Arial,sans-serif;overflow:hidden}
    .slide{width:1080px;height:1920px;display:flex;flex-direction:column;justify-content:center;
      align-items:center;padding:80px 60px;position:relative}
    .bg-circle{position:absolute;border-radius:50%;opacity:0.1}
    .bg-circle.c1{width:700px;height:700px;background:${COLORS.teal};top:-100px;left:-200px}
    .bg-circle.c2{width:400px;height:400px;background:${COLORS.gold};bottom:-50px;right:-100px}
    .emoji{font-size:80px;margin-bottom:30px;z-index:1}
    .headline{font-size:48px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px}
    .sub{font-size:28px;color:rgba(255,255,255,0.6);text-align:center;z-index:1;margin-bottom:50px;line-height:1.5}
    .cta-btn{background:${COLORS.teal};color:white;padding:22px 60px;border-radius:60px;font-size:32px;
      font-weight:800;z-index:1;box-shadow:0 8px 30px rgba(10,186,181,0.4);margin-bottom:15px}
    .cta-small{font-size:22px;color:rgba(255,255,255,0.4);z-index:1}
    .handles{position:absolute;bottom:100px;z-index:1;display:flex;flex-direction:column;align-items:center;gap:8px}
    .handle{font-size:22px;color:rgba(255,255,255,0.5);font-weight:600}
  </style></head><body>
  <div class="slide">
    <div class="bg-circle c1"></div>
    <div class="bg-circle c2"></div>
    <div class="emoji">🔔</div>
    <div class="headline">Don't Miss Tomorrow's Deals</div>
    <div class="sub">Follow for daily sweepstakes,<br>free stuff, and settlements</div>
    <div class="cta-btn">Follow @allfreealerts</div>
    <div class="cta-small">Link in bio for all deals</div>
    <div class="handles">
      <div class="handle">📸 @allfreealerts</div>
      <div class="handle">🌐 allfreealerts.com</div>
    </div>
  </div>
  </body></html>`;
}

// ── Render slides with Puppeteer ──
async function renderSlides(picks) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const slides = [];
  const totalSlides = picks.length;
  const totalData = loadData();

  // Intro slide
  const introHTML = generateIntroHTML(totalData.length);
  const introFile = path.join(OUT_DIR, 'slide_intro.html');
  const introPNG = path.join(OUT_DIR, 'slide_intro.png');
  fs.writeFileSync(introFile, introHTML);
  await page.goto('file:///' + introFile.replace(/\\/g, '/'));
  await page.screenshot({ path: introPNG });
  fs.unlinkSync(introFile);
  slides.push(introPNG);
  log('  Rendered intro slide');

  // Deal slides
  for (let i = 0; i < picks.length; i++) {
    const { category, item } = picks[i];
    const html = generateSlideHTML(item, category, i + 1, totalSlides);
    const htmlFile = path.join(OUT_DIR, `slide_${i}.html`);
    const pngFile = path.join(OUT_DIR, `slide_${i}.png`);
    fs.writeFileSync(htmlFile, html);
    await page.goto('file:///' + htmlFile.replace(/\\/g, '/'));
    await page.screenshot({ path: pngFile });
    fs.unlinkSync(htmlFile);
    slides.push(pngFile);
    log(`  Rendered slide ${i + 1}: ${item.title.substring(0, 40)}...`);
  }

  // Outro slide
  const outroHTML = generateOutroHTML();
  const outroFile = path.join(OUT_DIR, 'slide_outro.html');
  const outroPNG = path.join(OUT_DIR, 'slide_outro.png');
  fs.writeFileSync(outroFile, outroHTML);
  await page.goto('file:///' + outroFile.replace(/\\/g, '/'));
  await page.screenshot({ path: outroPNG });
  fs.unlinkSync(outroFile);
  slides.push(outroPNG);
  log('  Rendered outro slide');

  await browser.close();
  return slides;
}

// ── Stitch video with FFmpeg ──
function stitchVideo(slides) {
  log('Stitching video...');
  const slideDuration = 5; // seconds per slide
  const totalDuration = slides.length * slideDuration;

  // Build FFmpeg filter for zoom + crossfade transitions
  let inputs = '';
  let filterParts = [];
  let lastStream = '';

  // Input files
  for (let i = 0; i < slides.length; i++) {
    inputs += ` -loop 1 -t ${slideDuration} -i "${slides[i]}"`;
  }

  // Scale each input + add slow zoom (Ken Burns)
  for (let i = 0; i < slides.length; i++) {
    const zoomDir = i % 2 === 0 ? '1+0.0008*on' : '1.15-0.0008*on';
    const xDir = i % 2 === 0 ? 'iw/2-(iw/zoom/2)' : 'iw/2-(iw/zoom/2)';
    const yDir = i % 2 === 0 ? 'ih/2-(ih/zoom/2)' : 'ih/2-(ih/zoom/2)';
    filterParts.push(`[${i}:v]scale=1080:1920,zoompan=z='${zoomDir}':x='${xDir}':y='${yDir}':d=${slideDuration * 30}:s=1080x1920:fps=30,setsar=1[v${i}]`);
  }

  // Crossfade transitions (0.5s each)
  const fadeDur = 0.5;
  if (slides.length === 1) {
    filterParts.push(`[v0]format=yuv420p[outv]`);
  } else {
    // Chain crossfades
    let prev = 'v0';
    for (let i = 1; i < slides.length; i++) {
      const out = i === slides.length - 1 ? 'outv' : `cf${i}`;
      const offset = i * slideDuration - fadeDur * i;
      filterParts.push(`[${prev}][v${i}]xfade=transition=fadeblack:duration=${fadeDur}:offset=${offset.toFixed(2)}[${out}]`);
      prev = out;
    }
  }

  const filter = filterParts.join(';');

  // Add audio (beat)
  const audioInput = fs.existsSync(BEAT_FILE) ? ` -i "${BEAT_FILE}"` : '';
  const audioMap = fs.existsSync(BEAT_FILE)
    ? `-map "[outv]" -map ${slides.length}:a -shortest`
    : `-map "[outv]"`;

  const cmd = `ffmpeg -y${inputs}${audioInput} -filter_complex "${filter}" ${audioMap} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -pix_fmt yuv420p -r 30 "${REEL_FILE}"`;

  try {
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });
    const size = (fs.statSync(REEL_FILE).size / 1024 / 1024).toFixed(1);
    log(`Reel generated: ${REEL_FILE} (${size} MB)`);
    return true;
  } catch (e) {
    log('FFmpeg error: ' + (e.stderr?.toString().split('\n').slice(-5).join('\n') || e.message));
    return false;
  }
}

// ── Build caption ──
function buildReelCaption(picks) {
  const lines = ["Today's top free stuff picks 👇\n"];
  for (const { category, item } of picks) {
    const emoji = CAT_EMOJI[category];
    lines.push(`${emoji} ${item.title.substring(0, 60)}`);
  }
  lines.push(`\n👉 Link in bio — allfreealerts.com`);
  lines.push(`📱 Follow @allfreealerts for daily finds!`);
  lines.push(`\n#freestuff #sweepstakes #giveaway #freebie #classaction #settlements #free #deals #win #contest`);
  return lines.join('\n');
}

// ── Meta Graph API helper ──
function graphAPI(endpoint, params, method = 'POST') {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const url = `https://graph.facebook.com/${API_VERSION}/${endpoint}`;

    if (method === 'GET') {
      https.get(url + '?' + body, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      }).on('error', reject);
      return;
    }

    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── Upload video to IG as Reel ──
async function postIGReel(videoUrl, caption) {
  log('Posting Reel to Instagram...');

  // Step 1: Create media container
  const container = await graphAPI(`${IG_USER_ID}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption,
    access_token: IG_ACCESS_TOKEN
  });

  if (container.error) {
    log('IG container error: ' + JSON.stringify(container.error));
    return null;
  }

  log(`  Container created: ${container.id}`);

  // Step 2: Wait for processing
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await graphAPI(`${container.id}`, { fields: 'status_code', access_token: IG_ACCESS_TOKEN }, 'GET');
    log(`  Status: ${status.status_code}`);
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR') {
      log('  Container processing failed');
      return null;
    }
  }

  // Step 3: Publish
  const result = await graphAPI(`${IG_USER_ID}/media_publish`, {
    creation_id: container.id,
    access_token: IG_ACCESS_TOKEN
  });

  if (result.id) {
    log(`  IG Reel published: ${result.id}`);
    return result.id;
  } else {
    log('  IG publish error: ' + JSON.stringify(result));
    return null;
  }
}

// ── Upload Reel to Facebook ──
// FB Reels require binary upload: init → upload binary to rupload URL → finish
async function postFBReel(videoFilePath, caption) {
  log('Posting Reel to Facebook...');

  // Step 1: Initialize upload
  const init = await graphAPI(`${FB_PAGE_ID}/video_reels`, {
    upload_phase: 'start',
    access_token: FB_PAGE_TOKEN
  });

  if (init.error) {
    log('FB init error: ' + JSON.stringify(init.error));
    return null;
  }

  const videoId = init.video_id;
  const uploadUrl = init.upload_url;
  log(`  FB upload initialized: ${videoId}`);

  // Step 2: Upload video binary to rupload URL
  const videoData = fs.readFileSync(videoFilePath);
  const uploaded = await new Promise((resolve, reject) => {
    const parsed = new URL(uploadUrl);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${FB_PAGE_TOKEN}`,
        'offset': '0',
        'file_size': videoData.length.toString(),
        'Content-Type': 'application/octet-stream',
        'Content-Length': videoData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(videoData);
    req.end();
  });

  if (!uploaded.success) {
    log('  FB binary upload failed: ' + JSON.stringify(uploaded));
    return null;
  }
  log('  FB binary upload successful');

  // Step 3: Wait for processing before publishing
  log('  Waiting for FB video processing...');
  let status = 'not_started';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const check = await graphAPI(`${videoId}`, { fields: 'status', access_token: FB_PAGE_TOKEN }, 'GET');
    status = check?.status?.processing_phase?.status || check?.status?.video_status || 'unknown';
    log(`  Processing status (${i + 1}/30): ${status}`);
    if (status === 'ready' || status === 'complete') break;
    if (status === 'error') { log('  FB processing error'); return null; }
  }

  // Step 3: Finish and publish
  const finish = await graphAPI(`${FB_PAGE_ID}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    title: "Today's Free Stuff Picks",
    description: caption,
    published: 'true',
    access_token: FB_PAGE_TOKEN
  });

  if (finish.success) {
    log(`  FB Reel published: ${videoId} (post: ${finish.post_id || 'processing'})`);
    return videoId;
  } else {
    log('  FB finish error: ' + JSON.stringify(finish));
    return null;
  }
}

// ── Main ──
async function main() {
  log(`=== AllFreeAlerts Reel Generator ===`);
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // Pick deals
  const picks = pickItems();
  if (picks.length === 0) {
    log('No deals to post!');
    return;
  }
  log(`Picked ${picks.length} deals:`);
  picks.forEach(p => log(`  ${p.category}: ${p.item.title.substring(0, 50)}`));

  // Generate beat
  generateBeat();

  // Render slides
  log('Rendering slides (1080x1920)...');
  const slides = await renderSlides(picks);
  log(`${slides.length} slides rendered`);

  // Stitch video
  const success = stitchVideo(slides);
  if (!success) {
    log('Failed to generate video!');
    return;
  }

  // Build caption
  const caption = buildReelCaption(picks);
  log('\n--- Caption ---');
  log(caption);
  log('--- End Caption ---\n');

  if (DRY_RUN) {
    log(`DRY RUN complete. Video saved to: ${REEL_FILE}`);
    log('Slide images in: ' + OUT_DIR);
    return;
  }

  // Deploy video to Cloudflare so IG/FB can access it via URL
  log('Deploying video to Cloudflare...');
  const videoDir = path.join(__dirname, 'site', 'social', 'generated');
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
  fs.copyFileSync(REEL_FILE, path.join(videoDir, 'reel.mp4'));

  execSync('npx wrangler pages deploy site/ --project-name=allfreealerts --commit-dirty=true', {
    stdio: 'inherit',
    env: { ...process.env }
  });

  log('Waiting 20s for CDN propagation...');
  await new Promise(r => setTimeout(r, 20000));

  const videoUrl = `${SITE_BASE}/social/generated/reel.mp4`;
  log(`Video URL: ${videoUrl}`);

  // Post to Instagram
  if (IG_ACCESS_TOKEN) {
    await postIGReel(videoUrl, caption);
  } else {
    log('Skipping IG (no access token)');
  }

  // Post to Facebook
  if (FB_PAGE_TOKEN) {
    await postFBReel(REEL_FILE, caption);
  } else {
    log('Skipping FB (no page token)');
  }

  // Update history
  const history = loadHistory();
  for (const p of picks) {
    if (!history.posted.includes(p.item.link)) {
      history.posted.push(p.item.link);
    }
  }
  if (history.posted.length > 500) history.posted = history.posted.slice(-500);
  fs.writeFileSync(path.join(__dirname, 'ig_fb_post_history.json'), JSON.stringify(history, null, 2));
  log('History updated');

  log('Done!');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
