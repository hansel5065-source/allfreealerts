/**
 * AllFreeAlerts — Voice-Over Reel Generator
 * Generates a Reel with TTS voice narration synced to slides + cinematic beat
 * Posts to Instagram + Facebook as Reels
 *
 * Pipeline: pick deals → render slides → TTS segments → beat → stitch video → mix audio → post
 *
 * Usage: node generate_voice_reel.js [--dry-run]
 * Requires: ffmpeg, python3, edge-tts (pip install edge-tts), numpy, scipy, puppeteer
 */

const { execSync } = require('child_process');
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
const BEAT_FILE = path.join(OUT_DIR, 'beat.wav');
const VOICE_REEL_FILE = path.join(OUT_DIR, 'voice_reel.mp4');

// ── Brand ──
const TEAL = '#0ABAB5';
const ORANGE = '#FF6F3C';
const GOLD = '#F5A623';

const DAY_SEED = Math.floor(Date.now() / 86400000);

// ── Voice rotation ──
const VOICES = ['en-US-GuyNeural', 'en-US-AriaNeural'];
const VOICE = VOICES[DAY_SEED % VOICES.length];
const VOICE_TAG = VOICE.split('-').pop().replace('Neural', '');
const VOICE_RATE = '+5%';

// ── Rotating intros & outros ──
function getIntros(total) {
  return [
    "Here are 3 deals you need to know about today.",
    "We check hundreds of sources every day so you don't have to. Here are today's highlights.",
    "Free stuff, found for you. Let's get into today's picks.",
  ];
}

function getOutros(total) {
  return [
    `These are just 3 picks, but we have over ${total} active deals on our site right now. Check them all at allfreealerts dot com. Follow us so you never miss a deal.`,
    `That's just a taste. There are over ${total} deals waiting for you at allfreealerts dot com. Follow for daily updates.`,
    `Want more? We have over ${total} active deals at allfreealerts dot com. Hit follow and check them out. New picks every single day.`,
  ];
}

// ── Theme rotation ──
const THEMES = [
  { name: 'midnight', bg: 'linear-gradient(160deg, #0e1628 0%, #1a1a2e 50%, #0e1628 100%)' },
  { name: 'sunset', bg: 'linear-gradient(160deg, #1a0a2e 0%, #2d1b4e 40%, #1a0a2e 100%)' },
  { name: 'ocean', bg: 'linear-gradient(160deg, #0a1628 0%, #0d2137 50%, #0a1628 100%)' },
  { name: 'forest', bg: 'linear-gradient(160deg, #0a1a14 0%, #0d2e1f 50%, #0a1a14 100%)' },
  { name: 'ember', bg: 'linear-gradient(160deg, #1a0f0a 0%, #2e1810 50%, #1a0f0a 100%)' },
];

function log(msg) { console.log(`[VoiceReel] ${msg}`); }

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

// ── Pick deals (day-based seed for consistency between slides + voice) ──
function pickDeals() {
  const data = loadData();
  const history = loadHistory();
  const postedLinks = new Set(history.posted || []);

  const sweeps = data.filter(d => d.category === 'Sweepstakes' && !postedLinks.has(d.link));
  const freebies = data.filter(d => d.category === 'Freebies' && !postedLinks.has(d.link));
  const settlements = data.filter(d => d.category === 'Settlements' && !postedLinks.has(d.link) && (!d.scope || d.scope === 'nationwide'));

  const pick = (arr, offset) => arr.length > 0 ? arr[(DAY_SEED + offset) % arr.length] : null;

  return {
    sweep: pick(sweeps, 3),   // offset 3 to differ from image-only reel picks
    freebie: pick(freebies, 4),
    settle: pick(settlements, 5),
    total: data.length
  };
}

// ── Clean title for voice (strip "Brand - " prefix) ──
function voiceTitle(t) {
  if (!t) return 'an amazing deal';
  return t.includes(' - ') ? t.split(' - ').slice(1).join(' - ').trim() : t;
}

// ── Render 5 Puppeteer slides ──
async function renderSlides(picks) {
  const puppeteer = require('puppeteer');
  const theme = THEMES[DAY_SEED % THEMES.length];
  const bg = theme.bg;
  const sub = 'rgba(255,255,255,0.6)';

  const slideData = [
    {
      name: 'voice_slide_intro',
      html: `<div style="width:1080px;height:1920px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:60px;">
        <div style="font-size:120px;margin-bottom:30px;">🔔</div>
        <div style="font-size:64px;font-weight:bold;color:${TEAL};text-align:center;line-height:1.3;margin-bottom:40px;">Today's Top<br>Free Stuff</div>
        <div style="font-size:36px;color:${sub};text-align:center;">We found ${picks.total}+ deals so you don't have to</div>
        <div style="margin-top:60px;padding:16px 40px;background:${ORANGE};border-radius:40px;font-size:32px;font-weight:bold;color:white;">Here are 3 highlights</div>
      </div>`
    },
    {
      name: 'voice_slide_sweep',
      html: `<div style="width:1080px;height:1920px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:60px;">
        <div style="background:${GOLD};color:#1a1a2e;padding:12px 36px;border-radius:30px;font-size:28px;font-weight:bold;margin-bottom:40px;">🎰 SWEEPSTAKES</div>
        <div style="font-size:48px;font-weight:bold;color:white;text-align:center;line-height:1.3;margin-bottom:30px;max-width:900px;">${picks.sweep?.title || 'Win Big Today'}</div>
        <div style="font-size:32px;color:${TEAL};margin-bottom:20px;">💰 FREE TO ENTER</div>
        <div style="font-size:28px;color:${sub};text-align:center;max-width:800px;">Link in bio → allfreealerts.com</div>
      </div>`
    },
    {
      name: 'voice_slide_freebie',
      html: `<div style="width:1080px;height:1920px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:60px;">
        <div style="background:${TEAL};color:white;padding:12px 36px;border-radius:30px;font-size:28px;font-weight:bold;margin-bottom:40px;">🎁 FREEBIE</div>
        <div style="font-size:48px;font-weight:bold;color:white;text-align:center;line-height:1.3;margin-bottom:30px;max-width:900px;">${picks.freebie?.title || 'Free Sample Alert'}</div>
        <div style="font-size:32px;color:${ORANGE};margin-bottom:20px;">🆓 100% FREE</div>
        <div style="font-size:28px;color:${sub};text-align:center;max-width:800px;">Grab it before it's gone!</div>
      </div>`
    },
    {
      name: 'voice_slide_settle',
      html: `<div style="width:1080px;height:1920px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:60px;">
        <div style="background:${ORANGE};color:white;padding:12px 36px;border-radius:30px;font-size:28px;font-weight:bold;margin-bottom:40px;">⚖️ SETTLEMENT</div>
        <div style="font-size:48px;font-weight:bold;color:white;text-align:center;line-height:1.3;margin-bottom:30px;max-width:900px;">${picks.settle?.title || 'Claim Your Money'}</div>
        <div style="font-size:32px;color:${GOLD};margin-bottom:20px;">💵 CLAIM NOW</div>
        <div style="font-size:28px;color:${sub};text-align:center;max-width:800px;">No proof of purchase needed for most</div>
      </div>`
    },
    {
      name: 'voice_slide_outro',
      html: `<div style="width:1080px;height:1920px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:60px;">
        <div style="font-size:100px;margin-bottom:30px;">🚀</div>
        <div style="font-size:52px;font-weight:bold;color:white;text-align:center;line-height:1.3;margin-bottom:30px;">Want all ${picks.total}+ deals?</div>
        <div style="background:${TEAL};padding:20px 50px;border-radius:40px;font-size:36px;font-weight:bold;color:white;margin-bottom:40px;">allfreealerts.com</div>
        <div style="font-size:30px;color:${sub};text-align:center;">Follow @allfreealerts for daily updates<br>New deals posted every single day 🔔</div>
      </div>`
    }
  ];

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  const slideFiles = [];
  for (const slide of slideData) {
    const filePath = path.join(OUT_DIR, `${slide.name}.png`);
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;">${slide.html}</body></html>`);
    await page.screenshot({ path: filePath, type: 'png' });
    slideFiles.push(filePath);
    log(`  Rendered ${slide.name}.png`);
  }

  await browser.close();
  return slideFiles;
}

// ── Generate TTS voice segments ──
function generateVoiceSegments(picks) {
  const intros = getIntros(picks.total);
  const outros = getOutros(picks.total);
  const introIdx = DAY_SEED % intros.length;
  const outroIdx = DAY_SEED % outros.length;

  const sweepText = voiceTitle(picks.sweep?.title);
  const freeText = voiceTitle(picks.freebie?.title);
  const settleText = voiceTitle(picks.settle?.title);

  const segments = [
    { name: 'intro', text: intros[introIdx] },
    { name: 'sweep', text: `First up, a sweepstakes. ${sweepText}. Completely free to enter, no purchase necessary.` },
    { name: 'freebie', text: `Next, a freebie. ${freeText}. Get it while it lasts.` },
    { name: 'settle', text: `And finally, a settlement. ${settleText}. You might be owed money and not even know it. Check if you qualify.` },
    { name: 'outro', text: outros[outroIdx] },
  ];

  log(`Voice: ${VOICE} | Rate: ${VOICE_RATE}`);
  log(`Intro variant: ${introIdx + 1}/${intros.length} | Outro variant: ${outroIdx + 1}/${outros.length}`);

  const durations = {};

  for (const seg of segments) {
    const outFile = path.join(OUT_DIR, `seg_${VOICE_TAG}_${seg.name}.mp3`);
    // Generate TTS segment
    execSync(
      `python -m edge_tts --voice "${VOICE}" --rate "${VOICE_RATE}" --text "${seg.text.replace(/"/g, '\\"')}" --write-media "${outFile}"`,
      { stdio: 'pipe', timeout: 30000 }
    );

    // Get duration with ffprobe
    const durOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${outFile}"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    const dur = parseFloat(durOutput);
    durations[seg.name] = dur;
    log(`  ${seg.name}: ${dur.toFixed(2)}s — "${seg.text.substring(0, 60)}..."`);
  }

  // Concatenate all segments into one voice file
  const listFile = path.join(OUT_DIR, `seg_${VOICE_TAG}_list.txt`);
  const listContent = segments.map(s => `file 'seg_${VOICE_TAG}_${s.name}.mp3'`).join('\n');
  fs.writeFileSync(listFile, listContent);

  const fullVoice = path.join(OUT_DIR, `voice_${VOICE_TAG}_synced.mp3`);
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${fullVoice}"`,
    { stdio: 'pipe', timeout: 30000 }
  );

  const totalDur = Object.values(durations).reduce((a, b) => a + b, 0);
  log(`Total voice: ${totalDur.toFixed(1)}s | File: ${fullVoice}`);

  return { durations, voiceFile: fullVoice, totalDuration: totalDur };
}

// ── Generate beat ──
function generateBeat(minDuration) {
  if (fs.existsSync(BEAT_FILE)) {
    const stat = fs.statSync(BEAT_FILE);
    const age = Date.now() - stat.mtimeMs;
    if (age < 86400000) {
      log('Reusing existing beat');
      return;
    }
  }
  log('Generating beat...');
  execSync(`python generate_beat.py`, { stdio: 'pipe', timeout: 30000 });
  log('Beat generated');
}

// ── Stitch video with per-segment slide durations + mix audio ──
function stitchVideo(slideFiles, durations, voiceFile) {
  const segNames = ['intro', 'sweep', 'freebie', 'settle', 'outro'];

  // Build FFmpeg inputs for slides
  let inputs = '';
  let filterParts = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const dur = durations[segNames[i]];
    inputs += ` -loop 1 -t ${dur.toFixed(3)} -i "${slideFiles[i]}"`;
    // Scale + Ken Burns zoom
    const zoomDir = i % 2 === 0 ? '1+0.0008*on' : '1.15-0.0008*on';
    filterParts.push(`[${i}:v]scale=1080:1920,zoompan=z='${zoomDir}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(dur * 30)}:s=1080x1920:fps=30,setsar=1[v${i}]`);
  }

  // Crossfade transitions
  const fadeDur = 0.3;
  let prev = 'v0';
  let cumOffset = durations[segNames[0]];
  for (let i = 1; i < slideFiles.length; i++) {
    const out = i === slideFiles.length - 1 ? 'outv' : `cf${i}`;
    const offset = cumOffset - fadeDur;
    filterParts.push(`[${prev}][v${i}]xfade=transition=fadeblack:duration=${fadeDur}:offset=${offset.toFixed(3)}[${out}]`);
    prev = out;
    cumOffset += durations[segNames[i]] - fadeDur;
  }

  const filter = filterParts.join(';');

  // First pass: video only
  const videoOnly = path.join(OUT_DIR, 'voice_reel_video.mp4');
  const videoCmd = `ffmpeg -y${inputs} -filter_complex "${filter}" -map "[outv]" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r 30 "${videoOnly}"`;
  execSync(videoCmd, { stdio: 'pipe', timeout: 300000 });
  log('Video stitched');

  // Loop beat to match voice duration
  const totalDur = Object.values(durations).reduce((a, b) => a + b, 0);
  const beatLoop = path.join(OUT_DIR, `beat_loop_${VOICE_TAG}.wav`);
  execSync(
    `ffmpeg -y -stream_loop -1 -i "${BEAT_FILE}" -t ${Math.ceil(totalDur) + 1} "${beatLoop}"`,
    { stdio: 'pipe', timeout: 30000 }
  );

  // Mix: video + voice + beat
  const beatVol = '0.25';
  const mixCmd = `ffmpeg -y -i "${videoOnly}" -i "${voiceFile}" -i "${beatLoop}" -filter_complex "[1:a]volume=1.0[voice];[2:a]volume=${beatVol}[beat];[voice][beat]amix=inputs=2:duration=first[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart "${VOICE_REEL_FILE}"`;
  execSync(mixCmd, { stdio: 'pipe', timeout: 300000 });

  const size = (fs.statSync(VOICE_REEL_FILE).size / 1024 / 1024).toFixed(1);
  log(`Voice reel complete: ${VOICE_REEL_FILE} (${size} MB)`);
  return true;
}

// ── Build caption ──
function buildCaption(picks) {
  const lines = ["🎙️ Listen up — today's top free stuff picks 👇\n"];
  if (picks.sweep) lines.push(`🎉 ${picks.sweep.title.substring(0, 60)}`);
  if (picks.freebie) lines.push(`🎁 ${picks.freebie.title.substring(0, 60)}`);
  if (picks.settle) lines.push(`💰 ${picks.settle.title.substring(0, 60)}`);
  lines.push(`\n👉 Link in bio — allfreealerts.com`);
  lines.push(`📱 Follow @allfreealerts for daily finds!`);
  lines.push(`\n👤 facebook.com/allfreealerts`);
  lines.push(`🐦 @allfreealerts on X`);
  lines.push(`🦋 @allfreealerts.bsky.social`);
  lines.push(`\n#freestuff #sweepstakes #giveaway #freebie #classaction #settlements #free #deals #voiceover`);
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

// ── Post Reel to Instagram ──
async function postIGReel(videoUrl, caption) {
  log('Posting voice reel to Instagram...');
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

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await graphAPI(`${container.id}`, { fields: 'status_code', access_token: IG_ACCESS_TOKEN }, 'GET');
    log(`  Status: ${status.status_code}`);
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR') { log('  Container processing failed'); return null; }
  }

  const result = await graphAPI(`${IG_USER_ID}/media_publish`, {
    creation_id: container.id,
    access_token: IG_ACCESS_TOKEN
  });

  if (result.id) { log(`  IG Reel published: ${result.id}`); return result.id; }
  else { log('  IG publish error: ' + JSON.stringify(result)); return null; }
}

// ── Post Reel to Facebook (binary upload) ──
async function postFBReel(videoFilePath, caption) {
  log('Posting voice reel to Facebook...');

  const init = await graphAPI(`${FB_PAGE_ID}/video_reels`, {
    upload_phase: 'start',
    access_token: FB_PAGE_TOKEN
  });

  if (init.error) { log('FB init error: ' + JSON.stringify(init.error)); return null; }
  const videoId = init.video_id;
  const uploadUrl = init.upload_url;
  log(`  FB upload initialized: ${videoId}`);

  const videoData = fs.readFileSync(videoFilePath);
  const uploaded = await new Promise((resolve, reject) => {
    const parsed = new URL(uploadUrl);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
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
    req.write(videoData); req.end();
  });

  if (!uploaded.success) { log('  FB binary upload failed: ' + JSON.stringify(uploaded)); return null; }
  log('  FB binary upload successful');

  log('  Waiting for FB video processing...');
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const check = await graphAPI(`${videoId}`, { fields: 'status,published', access_token: FB_PAGE_TOKEN }, 'GET');
    const raw = JSON.stringify(check?.status || check);
    log(`  Processing check (${i + 1}/30): ${raw}`);
    const vs = check?.status?.video_status || check?.status?.processing_phase?.status || check?.status;
    if (vs === 'ready' || vs === 'complete' || check?.status?.uploading_phase?.status === 'complete') { ready = true; break; }
    if (vs === 'error') { log('  FB processing error'); return null; }
  }
  if (!ready) log('  Warning: proceeding to finish without confirmed processing completion');

  const finish = await graphAPI(`${FB_PAGE_ID}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    title: "🎙️ Today's Free Stuff Picks",
    description: caption,
    video_state: 'PUBLISHED',
    access_token: FB_PAGE_TOKEN
  });

  if (finish.success) { log(`  FB Reel published: ${videoId}`); return videoId; }
  else { log('  FB finish error: ' + JSON.stringify(finish)); return null; }
}

// ── Main ──
async function main() {
  log('=== AllFreeAlerts Voice-Over Reel Generator ===');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log(`Voice: ${VOICE} (${VOICE_TAG}) | Rate: ${VOICE_RATE}`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Pick deals
  const picks = pickDeals();
  if (!picks.sweep && !picks.freebie && !picks.settle) {
    log('No deals available to post!');
    return;
  }
  log(`Deals: ${picks.sweep?.title?.substring(0, 40)} | ${picks.freebie?.title?.substring(0, 40)} | ${picks.settle?.title?.substring(0, 40)}`);

  // 2. Render slides
  log('\nRendering slides...');
  const slideFiles = await renderSlides(picks);

  // 3. Generate TTS voice segments
  log('\nGenerating voice segments...');
  const voice = generateVoiceSegments(picks);

  // 4. Generate beat
  log('\nGenerating beat...');
  generateBeat(voice.totalDuration);

  // 5. Stitch video + mix audio
  log('\nStitching video...');
  const success = stitchVideo(slideFiles, voice.durations, voice.voiceFile);
  if (!success) {
    log('Failed to generate voice reel!');
    return;
  }

  // 6. Build caption
  const caption = buildCaption(picks);
  log('\n--- Caption ---');
  log(caption);
  log('--- End Caption ---\n');

  if (DRY_RUN) {
    log(`DRY RUN complete. Voice reel saved to: ${VOICE_REEL_FILE}`);
    return;
  }

  // 7. Deploy video to Cloudflare
  log('Deploying voice reel to Cloudflare...');
  const videoDir = path.join(__dirname, 'site', 'social', 'generated');
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
  fs.copyFileSync(VOICE_REEL_FILE, path.join(videoDir, 'voice_reel.mp4'));

  execSync('npx wrangler pages deploy site/ --project-name=allfreealerts --commit-dirty=true', {
    stdio: 'inherit',
    env: { ...process.env }
  });

  log('Waiting 20s for CDN propagation...');
  await new Promise(r => setTimeout(r, 20000));

  const videoUrl = `${SITE_BASE}/social/generated/voice_reel.mp4`;
  log(`Video URL: ${videoUrl}`);

  // 8. Post to IG + FB
  if (IG_ACCESS_TOKEN) {
    await postIGReel(videoUrl, caption);
  } else {
    log('Skipping IG (no access token)');
  }

  if (FB_PAGE_TOKEN) {
    await postFBReel(VOICE_REEL_FILE, caption);
  } else {
    log('Skipping FB (no page token)');
  }

  // 9. Update history
  const history = loadHistory();
  for (const item of [picks.sweep, picks.freebie, picks.settle]) {
    if (item && !history.posted.includes(item.link)) {
      history.posted.push(item.link);
    }
  }
  if (history.posted.length > 500) history.posted = history.posted.slice(-500);
  fs.writeFileSync(path.join(__dirname, 'ig_fb_post_history.json'), JSON.stringify(history, null, 2));
  log('History updated. Done!');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
