/**
 * AllFreeAlerts — YouTube Shorts Autoposter
 * Uploads the daily reel video as a YouTube Short
 *
 * Usage: node youtube_shorts_autoposter.js [--dry-run]
 * Requires: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN env vars
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN || '';
const DRY_RUN = process.argv.includes('--dry-run');

const DATA_FILE = path.join(__dirname, 'data', 'results.json');
const VIDEO_FILE = path.join(__dirname, 'tmp_videos', 'reel.mp4');
const HISTORY_FILE = path.join(__dirname, 'youtube_post_history.json');

function log(msg) { console.log(`[YT Shorts] ${msg}`); }

// ── Get fresh access token from refresh token ──
function getAccessToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const t = JSON.parse(data);
          if (t.access_token) resolve(t.access_token);
          else reject(new Error('No access token: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Load deal data ──
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return { posted: [] }; }
}

// ── Pick deals for caption (same logic as reel) ──
function pickItems() {
  const data = loadData();
  const history = loadHistory();
  const postedLinks = new Set(history.posted || []);
  const picks = [];

  for (const cat of ['Sweepstakes', 'Freebies', 'Settlements']) {
    let catItems = data.filter(i => i.category === cat && !postedLinks.has(i.link));
    if (cat === 'Settlements') {
      catItems = catItems.filter(i => !i.scope || i.scope === 'nationwide');
    }
    if (catItems.length > 0) {
      // Day-based seed for consistency
      const day = Math.floor(Date.now() / 86400000);
      const idx = (day * 7 + picks.length * 13) % catItems.length;
      picks.push({ category: cat, item: catItems[idx] });
    }
  }
  return picks;
}

// ── Build YouTube title + description ──
function buildMetadata(picks) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const title = `Free Stuff Today — ${today} #shorts`;

  const lines = [`Today's top free stuff picks:\n`];
  const emojis = { Sweepstakes: '🎉', Freebies: '🎁', Settlements: '💰' };
  for (const { category, item } of picks) {
    lines.push(`${emojis[category]} ${item.title.substring(0, 60)}`);
  }
  lines.push(`\n👉 All deals: https://allfreealerts.com`);
  lines.push(`📸 Instagram: https://instagram.com/allfreealerts`);
  lines.push(`👤 Facebook: https://facebook.com/allfreealerts`);
  lines.push(`🐦 X/Twitter: https://x.com/allfreealerts`);
  lines.push(`🦋 Bluesky: https://bsky.app/profile/allfreealerts.bsky.social`);
  lines.push(`\n#freestuff #sweepstakes #giveaway #freebie #classaction #settlements #free #deals`);

  return { title: title.substring(0, 100), description: lines.join('\n') };
}

// ── Upload video to YouTube as a Short ──
async function uploadShort(accessToken, videoPath, title, description) {
  const videoData = fs.readFileSync(videoPath);
  const fileSize = videoData.length;

  log(`Uploading ${(fileSize / 1024 / 1024).toFixed(1)} MB video...`);

  // Step 1: Initialize resumable upload
  const metadata = JSON.stringify({
    snippet: {
      title: title,
      description: description,
      categoryId: '22', // People & Blogs
      tags: ['free stuff', 'sweepstakes', 'giveaway', 'freebie', 'class action', 'settlements', 'deals', 'allfreealerts']
    },
    status: {
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
      shorts: { isShort: true }
    }
  });

  const initUrl = '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

  const uploadUri = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: initUrl,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': fileSize.toString(),
        'X-Upload-Content-Type': 'video/mp4',
        'Content-Length': Buffer.byteLength(metadata)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const loc = res.headers.location;
          if (loc) resolve(loc);
          else reject(new Error('No upload URI in response'));
        } else {
          reject(new Error(`Init failed (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(metadata);
    req.end();
  });

  log('Upload URI received, uploading video data...');

  // Step 2: Upload the actual video
  const result = await new Promise((resolve, reject) => {
    const parsed = new URL(uploadUri);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(videoData);
    req.end();
  });

  return result;
}

// ── Main ──
async function main() {
  log('=== YouTube Shorts Autoposter ===');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  if (!DRY_RUN && (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN)) {
    log('ERROR: Missing YouTube credentials (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)');
    process.exit(1);
  }

  if (!fs.existsSync(VIDEO_FILE)) {
    log(`ERROR: Video not found at ${VIDEO_FILE}`);
    log('Run generate_reel.js first to create the video');
    process.exit(1);
  }

  // Pick deals and build metadata
  const picks = pickItems();
  if (picks.length === 0) {
    log('No deals to post!');
    return;
  }

  log(`Picked ${picks.length} deals:`);
  picks.forEach(p => log(`  ${p.category}: ${p.item.title.substring(0, 50)}`));

  const { title, description } = buildMetadata(picks);
  log(`\nTitle: ${title}`);
  log(`\n--- Description ---\n${description}\n--- End ---`);

  if (DRY_RUN) {
    log('DRY RUN complete. Would upload: ' + VIDEO_FILE);
    return;
  }

  // Get access token
  log('Getting YouTube access token...');
  const accessToken = await getAccessToken();
  log('Access token received');

  // Upload
  const result = await uploadShort(accessToken, VIDEO_FILE, title, description);

  if (result.status === 200 && result.body.id) {
    log(`YouTube Short published: https://youtube.com/shorts/${result.body.id}`);

    // Update history
    const history = loadHistory();
    for (const p of picks) {
      if (!history.posted.includes(p.item.link)) {
        history.posted.push(p.item.link);
      }
    }
    history.lastPosted = new Date().toISOString();
    history.lastVideoId = result.body.id;
    if (history.posted.length > 500) history.posted = history.posted.slice(-500);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    log('History updated');
  } else {
    log(`Upload failed (${result.status}): ${JSON.stringify(result.body)}`);
    process.exit(1);
  }

  log('Done!');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
