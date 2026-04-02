/**
 * AllFreeAlerts — TikTok Autoposter
 * Uploads the daily reel video to TikTok
 *
 * Usage: node tiktok_autoposter.js [--dry-run]
 * Requires: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN env vars
 *
 * Note: Unaudited apps post as SELF_ONLY (private). After TikTok audit, posts go PUBLIC_TO_EVERYONE.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
let REFRESH_TOKEN = process.env.TIKTOK_REFRESH_TOKEN || '';
const DRY_RUN = process.argv.includes('--dry-run');

const DATA_FILE = path.join(__dirname, 'data', 'results.json');
const VIDEO_FILE = path.join(__dirname, 'tmp_videos', 'reel.mp4');
const HISTORY_FILE = path.join(__dirname, 'tiktok_post_history.json');
const TOKEN_FILE = path.join(__dirname, 'tiktok_token_cache.json');

function log(msg) { console.log(`[TikTok] ${msg}`); }

// ── HTTP helper ──
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Load cached refresh token (TikTok tokens are single-use) ──
function loadCachedToken() {
  try {
    const cache = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (cache.refresh_token) return cache.refresh_token;
  } catch {}
  return REFRESH_TOKEN; // fall back to env var
}

function saveCachedToken(refreshToken) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: refreshToken, updated: new Date().toISOString() }));
  log('New refresh token cached');
}

// ── Refresh access token ──
async function getAccessToken() {
  const currentToken = loadCachedToken();
  const body = new URLSearchParams({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: currentToken
  }).toString();

  const res = await httpRequest({
    hostname: 'open.tiktokapis.com',
    path: '/v2/oauth/token/',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);

  const t = res.body.data || res.body;
  if (t.access_token) {
    // Save the NEW refresh token (old one is now invalid)
    if (t.refresh_token) saveCachedToken(t.refresh_token);
    log('Access token refreshed');
    return t.access_token;
  }
  throw new Error('Token refresh failed: ' + JSON.stringify(res.body));
}

// ── Query creator info (get allowed privacy levels) ──
async function getCreatorInfo(accessToken) {
  const res = await httpRequest({
    hostname: 'open.tiktokapis.com',
    path: '/v2/post/publish/creator_info/query/',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    }
  }, '{}');

  log('Creator info: ' + JSON.stringify(res.body));
  return res.body.data || res.body;
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
      const day = Math.floor(Date.now() / 86400000);
      const idx = (day * 7 + picks.length * 13) % catItems.length;
      picks.push({ category: cat, item: catItems[idx] });
    }
  }
  return picks;
}

// ── Build TikTok caption ──
function buildCaption(picks) {
  const lines = [];
  const emojis = { Sweepstakes: '🎉', Freebies: '🎁', Settlements: '💰' };
  for (const { category, item } of picks) {
    lines.push(`${emojis[category]} ${item.title.substring(0, 60)}`);
  }
  lines.push('');
  lines.push('👉 allfreealerts.com');
  lines.push('📸 @allfreealerts');
  lines.push('');
  lines.push('#freestuff #sweepstakes #giveaway #freebie #classaction #settlements #free #deals #money #savings');

  // TikTok caption max 2200 chars
  return lines.join('\n').substring(0, 2200);
}

// ── Upload video to TikTok (push_by_file) ──
async function uploadVideo(accessToken, videoPath, caption) {
  const videoData = fs.readFileSync(videoPath);
  const fileSize = videoData.length;
  const chunkSize = fileSize; // Single chunk upload

  log(`Video size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

  // Step 1: Initialize upload
  const initBody = JSON.stringify({
    post_info: {
      title: caption.substring(0, 150),
      description: caption,
      privacy_level: 'SELF_ONLY', // Private until app is audited
      disable_comment: false,
      auto_add_music: false,
      brand_organic_toggle: true
    },
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: fileSize,
      chunk_size: chunkSize,
      total_chunk_count: 1
    },
    post_mode: 'DIRECT_POST',
    media_type: 'VIDEO'
  });

  log('Initializing upload...');
  const initRes = await httpRequest({
    hostname: 'open.tiktokapis.com',
    path: '/v2/post/publish/video/init/',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'Content-Length': Buffer.byteLength(initBody)
    }
  }, initBody);

  if (initRes.body.error?.code !== 'ok' && initRes.status !== 200) {
    throw new Error('Init failed: ' + JSON.stringify(initRes.body));
  }

  const uploadUrl = initRes.body.data?.upload_url;
  const publishId = initRes.body.data?.publish_id;

  if (!uploadUrl) {
    throw new Error('No upload URL returned: ' + JSON.stringify(initRes.body));
  }

  log(`Upload URL received, publish_id: ${publishId}`);

  // Step 2: Upload video data
  log('Uploading video...');
  const parsed = new URL(uploadUrl);
  const uploadRes = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize,
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`
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

  log(`Upload response: ${uploadRes.status}`);

  return { publishId, initRes: initRes.body, uploadRes };
}

// ── Check publish status ──
async function checkPublishStatus(accessToken, publishId) {
  const body = JSON.stringify({ publish_id: publishId });
  const res = await httpRequest({
    hostname: 'open.tiktokapis.com',
    path: '/v2/post/publish/status/fetch/',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  return res.body;
}

// ── Main ──
async function main() {
  log('=== TikTok Autoposter ===');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  if (!DRY_RUN && (!CLIENT_KEY || !CLIENT_SECRET || !REFRESH_TOKEN)) {
    log('ERROR: Missing TikTok credentials (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN)');
    process.exit(1);
  }

  if (!fs.existsSync(VIDEO_FILE)) {
    log(`ERROR: Video not found at ${VIDEO_FILE}`);
    log('Run generate_reel.js first to create the video');
    process.exit(1);
  }

  // Pick deals and build caption
  const picks = pickItems();
  if (picks.length === 0) {
    log('No deals to post!');
    return;
  }

  log(`Picked ${picks.length} deals:`);
  picks.forEach(p => log(`  ${p.category}: ${p.item.title.substring(0, 50)}`));

  const caption = buildCaption(picks);
  log(`\n--- Caption ---\n${caption}\n--- End ---`);

  if (DRY_RUN) {
    log('DRY RUN complete. Would upload: ' + VIDEO_FILE);
    return;
  }

  // Get access token
  log('Refreshing access token...');
  const accessToken = await getAccessToken();

  // Query creator info
  const creatorInfo = await getCreatorInfo(accessToken);
  log('Privacy options: ' + JSON.stringify(creatorInfo.privacy_level_options || []));

  // Upload video
  const result = await uploadVideo(accessToken, VIDEO_FILE, caption);

  if (result.publishId) {
    log(`Video uploaded! Publish ID: ${result.publishId}`);

    // Wait and check status
    log('Waiting 10s for processing...');
    await new Promise(r => setTimeout(r, 10000));

    const status = await checkPublishStatus(accessToken, result.publishId);
    log('Publish status: ' + JSON.stringify(status));

    // Update history
    const history = loadHistory();
    for (const p of picks) {
      if (!history.posted.includes(p.item.link)) {
        history.posted.push(p.item.link);
      }
    }
    history.lastPosted = new Date().toISOString();
    history.lastPublishId = result.publishId;
    if (history.posted.length > 500) history.posted = history.posted.slice(-500);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    log('History updated');
  } else {
    log('Upload may have failed: ' + JSON.stringify(result));
    process.exit(1);
  }

  log('Done!');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
