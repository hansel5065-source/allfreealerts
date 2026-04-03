#!/usr/bin/env node
/**
 * generate_content_kit.js — Daily Content Kit Email for AllFreeAlerts
 *
 * Generates a single email with copy-paste ready content for every platform:
 *   - X/Twitter (5 tweets for Buffer)
 *   - Reddit (3 subreddit posts)
 *   - Facebook Groups (1 general post)
 *   - TikTok caption (for manual reel upload)
 *
 * Sends via Brevo SMTP API to contact@allfreealerts.com
 *
 * Usage:
 *   node generate_content_kit.js              # Send email
 *   node generate_content_kit.js --dry-run    # Print HTML to console + save to file
 *   node generate_content_kit.js --preview    # Same as --dry-run
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ── Config ──
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('--preview');
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_NAME = 'AllFreeAlerts';
const SENDER_EMAIL = 'hansel5065@gmail.com';
const SITE_URL = 'https://allfreealerts.com';
const SOCIAL_IMG_BASE = 'https://allfreealerts.com/social';
const HISTORY_FILE = path.join(__dirname, 'content_kit_history.json');
const DATA_FILE = path.join(__dirname, 'data', 'results.json');

// ── Brand ──
const COLORS = {
  teal: '#0ABAB5',
  orange: '#FF6F3C',
  gold: '#F5A623',
};

// ── Helpers ──

function log(msg) {
  console.log(`[ContentKit] ${msg}`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractValue(text) {
  if (!text) return 0;
  const matches = text.match(/\$[\d,]+/g);
  if (!matches) return 0;
  return Math.max(...matches.map(m => parseInt(m.replace(/[$,]/g, ''), 10)));
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

// ── History / Dedup ──

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return { used: [] };
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  log(`Saved history (${history.used.length} entries)`);
}

// ── Deal Loading & Selection ──

function loadDeals() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Pick deals intelligently:
 *  - Prefer items found today, then recent
 *  - Skip already-used deals (from history)
 *  - Settlements must be nationwide for social posts
 */
function pickDeals(allDeals, history, count, category) {
  const todayStr = today();
  const usedSet = new Set(history.used || []);

  let pool = allDeals.filter(d => d.category === category);

  // Settlements: only nationwide
  if (category === 'Settlements') {
    pool = pool.filter(d => !d.scope || d.scope === 'nationwide');
  }

  // Filter out already-used
  const unused = pool.filter(d => !usedSet.has(d.link));

  // Sort: today first, then by date_found desc, then by value desc
  unused.sort((a, b) => {
    const aToday = a.date_found === todayStr ? 1 : 0;
    const bToday = b.date_found === todayStr ? 1 : 0;
    if (bToday !== aToday) return bToday - aToday;
    const dateA = a.date_found || '';
    const dateB = b.date_found || '';
    if (dateB !== dateA) return dateB.localeCompare(dateA);
    return extractValue(b.prize_summary) - extractValue(a.prize_summary);
  });

  // If not enough unused, allow reuse of older ones
  let picks = unused.slice(0, count);
  if (picks.length < count) {
    const reuse = pool
      .filter(d => !picks.find(p => p.link === d.link))
      .sort((a, b) => {
        const dateA = a.date_found || '';
        const dateB = b.date_found || '';
        return dateB.localeCompare(dateA);
      });
    picks = picks.concat(reuse.slice(0, count - picks.length));
  }

  return picks;
}

// ── Tweet Generation ──

// Each hook is a full tweet TEMPLATE with {title} and {link} placeholders
// Day-based rotation ensures variety across days
const SWEEPSTAKES_TWEETS = [
  '🎉 Someone\'s winning this and it might as well be you\n\n{title}\n\n{link}\n\n#sweepstakes #giveaway #win',
  'POV: you entered a free sweepstakes and actually won 👀\n\n{title}\n\n{link}\n\n#sweepstakes #free #contest',
  'This costs $0 to enter. Your odds are better than you think.\n\n🏆 {title}\n\n{link}\n\n#giveaway #win #sweepstakes',
  'Free to enter. Life-changing to win.\n\n{title}\n\n{link}\n\nMore daily finds at allfreealerts.com 🔍',
  'Most people will scroll past this. The ones who don\'t might win.\n\n🎉 {title}\n\n{link}\n\n#sweepstakes #free',
  'Your daily reminder that free stuff exists\n\n{title}\n\n{link}\n\n#giveaway #contest #win #sweepstakes',
  'Companies literally give away money and nobody enters 🤦\n\n{title}\n\n{link}\n\n#sweepstakes #free #giveaway',
  'Imagine winning this tomorrow\n\n{title}\n\n{link}\n\nWe find these daily → allfreealerts.com',
];

const FREEBIE_TWEETS = [
  'This is free. Actually free. Not "free with purchase" free.\n\n🎁 {title}\n\n{link}\n\n#freestuff #freebie',
  'If you\'re not getting free stuff in 2026, you\'re doing it wrong\n\n{title}\n\n{link}\n\n#free #freestuff #deals',
  'Your wallet called. It said thank you.\n\n🆓 {title}\n\n{link}\n\n#freebie #freestuff #savemoney',
  '$0.00. That\'s the price. Go get it.\n\n{title}\n\n{link}\n\nMore at allfreealerts.com 🔍',
  'Tell me you love free stuff without telling me you love free stuff\n\n🎁 {title}\n\n{link}\n\n#free #freebie',
  'The only thing better than a deal is a FREE deal\n\n{title}\n\n{link}\n\n#freestuff #samples #free',
  'Add to cart ✅ Total: $0.00 ✅ Regrets: none ✅\n\n{title}\n\n{link}\n\n#freebie #freestuff #deals',
  'Brands are literally giving this away and most people have no idea\n\n🎁 {title}\n\n{link}\n\n#free #freebie',
];

const SETTLEMENT_TWEETS = [
  'Companies got caught. Now they owe you money.\n\n💰 {title}\n\n{link}\n\n#classaction #settlement #freemoney',
  'Check if you\'re owed money from this settlement (takes 2 min)\n\n{title}\n\n{link}\n\n#settlement #claimit',
  'Stop leaving free money on the table\n\n💸 {title}\n\n{link}\n\n#classaction #settlement #freemoney',
  'This settlement is paying out. Are you on the list?\n\n{title}\n\n{link}\n\nMore at allfreealerts.com',
  'You might be owed money and not even know it\n\n💰 {title}\n\n{link}\n\n#classaction #freemoney #settlement',
  'Real money. Real claims. No catch.\n\n{title}\n\n{link}\n\n#settlement #classaction #claimit',
  'Companies don\'t advertise when they owe you money. We do.\n\n💰 {title}\n\n{link}\n\n#settlement #freemoney',
  '2 minutes to file. Could be worth hundreds.\n\n{title}\n\n{link}\n\nWe find these daily → allfreealerts.com',
];

const TWEET_POOLS = { Sweepstakes: SWEEPSTAKES_TWEETS, Freebies: FREEBIE_TWEETS, Settlements: SETTLEMENT_TWEETS };

function generateTweet(deal, hookIndex) {
  const pool = TWEET_POOLS[deal.category] || FREEBIE_TWEETS;
  const day = Math.floor(Date.now() / 86400000);
  const template = pool[(day + hookIndex * 3) % pool.length];
  const title = truncate(deal.title, 80);

  let tweet = template.replace('{title}', title).replace('{link}', deal.link);

  // Safety: trim to 280
  if (tweet.length > 280) {
    const shorter = truncate(deal.title, 50);
    tweet = template.replace('{title}', shorter).replace('{link}', deal.link);
  }
  if (tweet.length > 280) {
    tweet = tweet.slice(0, 277) + '...';
  }
  return tweet;
}

function getCategoryImage(category, index) {
  const slug = category.toLowerCase();
  const num = (index % 3) + 1;
  return `${SOCIAL_IMG_BASE}/${slug}_${num}.png`;
}

// ── Reddit Post Generation ──

const REDDIT_FREEBIE_INTROS = [
  'Found this one today — completely free, no strings.',
  'Spotted this. Legit free, direct link to the source.',
  'This one just went live. Get it before it\'s gone.',
  'No purchase necessary, no credit card needed.',
];

const REDDIT_SWEEP_INTROS = [
  'Free to enter, found this one today.',
  'Just went live — legit sweepstakes, direct entry link.',
  'Official entry page, no sign up for a newsletter first.',
  'Found this today. Easy entry, no hoops to jump through.',
];

const REDDIT_SETTLE_INTROS = [
  'Claims are open now. Takes a couple minutes to file.',
  'If this applies to you, don\'t leave money on the table.',
  'Claims are open — deadline below. Pretty straightforward.',
  'Just found this one. No proof of purchase required for the base payment.',
];

function generateRedditFreebie(deal) {
  const day = Math.floor(Date.now() / 86400000);
  const intro = REDDIT_FREEBIE_INTROS[day % REDDIT_FREEBIE_INTROS.length];
  const body = deal.prize_summary || deal.description || '';
  return {
    subreddit: 'r/freebies',
    title: deal.title,
    body: `${intro}\n\n${truncate(body, 200)}\n\nLink: ${deal.link}`,
  };
}

function generateRedditSweepstakes(deal) {
  const day = Math.floor(Date.now() / 86400000);
  const intro = REDDIT_SWEEP_INTROS[day % REDDIT_SWEEP_INTROS.length];
  const value = extractValue(deal.prize_summary);
  const valueStr = value > 0 ? ` (worth $${value.toLocaleString()})` : '';
  return {
    subreddit: 'r/sweepstakes',
    title: `${deal.title}${valueStr}`,
    body: `${intro}\n\n${truncate(deal.prize_summary || deal.description || '', 200)}\n\nEnter here: ${deal.link}${deal.end_date ? `\n\nEnds: ${deal.end_date}` : ''}`,
  };
}

function generateRedditSettlement(deal) {
  const day = Math.floor(Date.now() / 86400000);
  const intro = REDDIT_SETTLE_INTROS[day % REDDIT_SETTLE_INTROS.length];
  return {
    subreddit: 'r/classaction',
    title: deal.title,
    body: `${intro}\n\n${truncate(deal.description || deal.prize_summary || '', 300)}\n\nFile your claim: ${deal.link}${deal.deadline ? `\n\nDeadline: ${deal.deadline}` : ''}`,
  };
}

// ── Facebook Group Post ──

const FB_GROUP_OPENERS = [
  'Just dropped 🔥 Here\'s what I found today:',
  'Daily deal drop! These are the ones worth your time today:',
  'Happy {weekday}! Here are today\'s best free finds:',
  'You\'re going to want to save this one 📌',
  'The internet is giving away free stuff again and I\'m here for it:',
  'OK these are actually good today 👇',
  'Three things that cost $0 right now:',
];

const FB_GROUP_CLOSERS = [
  'I post these every day — follow along so you never miss one 🙌\n\n📱 allfreealerts.com — 700+ deals updated daily',
  'New ones every single day 👉 allfreealerts.com\n\nFollow @allfreealerts on IG, FB, TikTok, and YouTube for daily alerts!',
  'This is what I do — I find free stuff so you don\'t have to 😄\n\n🔍 allfreealerts.com for the full list',
  'Bookmark allfreealerts.com — we add new deals every morning ☀️\n\nAlso on IG, TikTok, YouTube @allfreealerts',
];

function generateFBGroupPost(sweepDeal, freebieDeal, settlementDeal) {
  const day = Math.floor(Date.now() / 86400000);
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  let opener = FB_GROUP_OPENERS[day % FB_GROUP_OPENERS.length].replace('{weekday}', weekday);
  const closer = FB_GROUP_CLOSERS[day % FB_GROUP_CLOSERS.length];

  let post = `${opener}\n\n`;

  if (sweepDeal) {
    const value = extractValue(sweepDeal.prize_summary);
    const valueStr = value > 0 ? ` — worth $${value.toLocaleString()}!` : '';
    post += `🎉 SWEEPSTAKES: ${sweepDeal.title}${valueStr}\nFree to enter → ${sweepDeal.link}\n\n`;
  }
  if (freebieDeal) {
    post += `🎁 FREEBIE: ${freebieDeal.title}\nGrab it here → ${freebieDeal.link}\n\n`;
  }
  if (settlementDeal) {
    post += `💰 SETTLEMENT: ${settlementDeal.title}\nFile your claim → ${settlementDeal.link}\n\n`;
  }

  post += closer;
  return post;
}

// ── TikTok Caption ──

const TIKTOK_HOOKS = [
  'POV: you find out companies owe you money and there\'s free stuff everywhere 🤯',
  'Stop scrolling — this free stuff won\'t last 👇',
  'Things that are FREE right now that nobody is talking about:',
  'I find free stuff every day so you don\'t have to. Here\'s today\'s drop:',
  'The internet is literally giving away free money and products 👀',
  'If you\'re not claiming free stuff in 2026 you\'re missing out fr',
  'Today\'s free stuff lineup is actually insane 🔥',
  'FREE. STUFF. DAILY. Here\'s what I found today:',
];

function generateTikTokCaption(sweepDeal, freebieDeal, settlementDeal) {
  const day = Math.floor(Date.now() / 86400000);
  const hook = TIKTOK_HOOKS[day % TIKTOK_HOOKS.length];

  let caption = `${hook}\n\n`;

  if (sweepDeal) {
    const value = extractValue(sweepDeal.prize_summary);
    caption += value > 0
      ? `🎉 Win $${value.toLocaleString()} — ${sweepDeal.title}\n`
      : `🎉 ${sweepDeal.title}\n`;
  }
  if (freebieDeal) {
    caption += `🎁 ${freebieDeal.title}\n`;
  }
  if (settlementDeal) {
    caption += `💰 ${settlementDeal.title}\n`;
  }

  caption += `\n🔗 allfreealerts.com for ALL the deals (link in bio)\n\n`;
  caption += `Follow @allfreealerts — we post new free stuff every single day\n\n`;
  caption += `#freestuff #giveaway #freebie #settlement #classaction #freemoney #free #sweepstakes #deals #savemoney #frugal #win #contest #fyp #viral #lifehack #moneytok`;

  if (caption.length > 2200) {
    caption = caption.slice(0, 2197) + '...';
  }
  return caption;
}

// ── Deal Image Generation (Puppeteer) ──

const IMG_DIR = path.join(__dirname, 'site', 'social', 'content-kit');

function generateImageHTML(item, category) {
  const title = escapeHtml((item.title || '').slice(0, 80));
  const summary = escapeHtml((item.prize_summary || '').slice(0, 100));

  const templates = {
    Sweepstakes: { gradient: 'linear-gradient(135deg,#0ABAB5 0%,#087f7b 50%,#065a57 100%)', emoji: '🎉', badge: 'SWEEPSTAKES ALERT', badgeBg: '#FF6F3C', sub: summary || 'Enter now for a chance to win!' },
    Freebies: { gradient: 'linear-gradient(135deg,#FF6F3C 0%,#e85525 50%,#c44218 100%)', emoji: '🎁', badge: 'FREE STUFF ALERT', badgeBg: '#ffffff', badgeColor: '#FF6F3C', sub: 'No purchase necessary. No credit card.' },
    Settlements: { gradient: 'linear-gradient(135deg,#F5A623 0%,#e8950f 50%,#c47e0a 100%)', emoji: '💰', badge: '⚠️ SETTLEMENT ALERT', badgeBg: '#ff3333', sub: summary || 'You may be owed money. Check if you qualify.' },
  };
  const t = templates[category] || templates.Freebies;

  return `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:#0e1628}
    .card{width:1080px;height:1080px;background:${t.gradient};display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif}
    .card::before{content:'';position:absolute;top:-100px;right:-100px;width:400px;height:400px;border-radius:50%;background:rgba(255,255,255,0.1)}
    .emoji{font-size:80px;margin-bottom:30px;z-index:1}
    .badge{background:${t.badgeBg};color:${t.badgeColor || 'white'};padding:10px 30px;border-radius:50px;font-size:24px;font-weight:800;letter-spacing:2px;margin-bottom:30px;z-index:1}
    .title{font-size:46px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px;text-shadow:0 2px 10px rgba(0,0,0,0.2)}
    .sub{font-size:28px;color:rgba(255,255,255,0.9);text-align:center;z-index:1;line-height:1.4}
    .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;background:rgba(0,0,0,0.3);padding:12px 30px;border-radius:50px;z-index:1}
    .brand span{color:#0ABAB5}
  </style></head><body><div class="card">
    <div class="emoji">${t.emoji}</div>
    <div class="badge">${t.badge}</div>
    <div class="title">${title}</div>
    <div class="sub">${t.sub}</div>
    <div class="brand">All<span>Free</span>Alerts.com</div>
  </div></body></html>`;
}

async function generateTweetImages(tweetDeals) {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch { log('Puppeteer not available — skipping image generation'); return []; }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080 });

  const imagePaths = [];
  for (let i = 0; i < tweetDeals.length; i++) {
    const deal = tweetDeals[i];
    const html = generateImageHTML(deal, deal.category);
    const htmlFile = path.join(IMG_DIR, `tweet_${i}.html`);
    const pngFile = path.join(IMG_DIR, `tweet_${i}.png`);

    fs.writeFileSync(htmlFile, html);
    await page.goto('file:///' + htmlFile.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
    await page.screenshot({ path: pngFile, type: 'png' });
    fs.unlinkSync(htmlFile);
    imagePaths.push(pngFile);
    log(`  Image ${i + 1}: ${deal.title.substring(0, 40)}...`);
  }

  await browser.close();
  return imagePaths;
}

function deployImages() {
  try {
    execSync('npx wrangler pages deploy site/ --project-name=allfreealerts --commit-dirty=true', {
      stdio: 'inherit', env: { ...process.env }
    });
    log('Images deployed to Cloudflare');
    return true;
  } catch (e) {
    log('Cloudflare deploy failed: ' + e.message);
    return false;
  }
}

// ── HTML Email Generation ──

function buildEmailHtml(tweets, tweetDeals, tweetImageUrls, redditPosts, fbPost, tikTokCaption, dateStr) {
  const platformSection = (icon, name, color, content) => `
    <tr><td style="padding:0 0 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;border:1px solid #e8e8e8;overflow:hidden;">
        <tr><td style="background:${color};padding:14px 20px;">
          <h2 style="margin:0;font-size:18px;color:#ffffff;font-weight:700;">${icon} ${escapeHtml(name)}</h2>
        </td></tr>
        <tr><td style="padding:20px;">
          ${content}
        </td></tr>
      </table>
    </td></tr>`;

  const copyBlock = (text, note) => {
    const escaped = escapeHtml(text);
    return `
      <div style="background:#f8f9fa;border:1px solid #e2e2e2;border-radius:6px;padding:14px 16px;margin-bottom:12px;font-family:'Courier New',Courier,monospace;font-size:13px;line-height:1.6;color:#333333;white-space:pre-wrap;word-break:break-word;">${escaped}</div>
      ${note ? `<p style="margin:0 0 16px 0;font-size:12px;color:#888;">${escapeHtml(note)}</p>` : ''}`;
  };

  // -- Tweets section --
  let tweetContent = '<p style="margin:0 0 12px 0;font-size:13px;color:#666;">5 tweets ready for Buffer. Copy the text + save the image below each tweet.</p>';
  tweets.forEach((tweet, i) => {
    const imgUrl = tweetImageUrls[i] || getCategoryImage(tweetDeals[i].category, i);
    tweetContent += `<p style="margin:16px 0 4px 0;font-size:12px;font-weight:700;color:#1DA1F2;">Tweet ${i + 1} — ${escapeHtml(tweetDeals[i].category)}</p>`;
    tweetContent += copyBlock(tweet);
    tweetContent += `<p style="margin:4px 0 4px 0;font-size:12px;color:#888;">Image for this tweet:</p>`;
    tweetContent += `<a href="${imgUrl}" download style="display:inline-block;margin-bottom:16px;"><img src="${imgUrl}" alt="Tweet ${i+1} image" style="width:200px;height:200px;border-radius:8px;border:1px solid #ddd;"/></a>`;
    tweetContent += `<p style="margin:0 0 16px 0;font-size:11px;color:#aaa;">Right-click image → Save, or <a href="${imgUrl}" style="color:#1DA1F2;">download here</a></p>`;
  });

  // -- Reddit section --
  let redditContent = '<p style="margin:0 0 12px 0;font-size:13px;color:#666;">3 subreddit posts. Use the title as your post title, body as the text body.</p>';
  redditPosts.forEach(rp => {
    redditContent += `<p style="margin:16px 0 4px 0;font-size:12px;font-weight:700;color:#FF4500;">${escapeHtml(rp.subreddit)}</p>`;
    redditContent += `<p style="margin:0 0 4px 0;font-size:12px;color:#888;">Title:</p>`;
    redditContent += copyBlock(rp.title);
    redditContent += `<p style="margin:0 0 4px 0;font-size:12px;color:#888;">Body:</p>`;
    redditContent += copyBlock(rp.body);
  });

  // -- FB Groups section --
  let fbContent = '<p style="margin:0 0 12px 0;font-size:13px;color:#666;">Post this to deal-sharing Facebook Groups. Attach the category images if desired.</p>';
  fbContent += copyBlock(fbPost, `Suggested images: ${SOCIAL_IMG_BASE}/sweepstakes_1.png, ${SOCIAL_IMG_BASE}/freebies_1.png, ${SOCIAL_IMG_BASE}/settlements_1.png`);

  // -- TikTok section --
  let tikTokContent = '<p style="margin:0 0 12px 0;font-size:13px;color:#666;">Paste this as the caption when uploading the reel video to TikTok.</p>';
  tikTokContent += `<p style="margin:0 0 8px 0;font-size:13px;font-weight:700;color:#333;">📥 Download today's videos:</p>`;
  tikTokContent += `<p style="margin:0 0 4px 0;font-size:13px;"><a href="${SITE_URL}/social/generated/reel.mp4" style="color:#0ABAB5;font-weight:600;">🎵 Music Reel (reel.mp4)</a></p>`;
  tikTokContent += `<p style="margin:0 0 16px 0;font-size:13px;"><a href="${SITE_URL}/social/generated/voice_reel.mp4" style="color:#0ABAB5;font-weight:600;">🔊 Voice Reel (voice_reel.mp4)</a></p>`;
  tikTokContent += `<p style="margin:0 0 8px 0;font-size:11px;color:#999;">Videos are generated at 4:13pm (music) and 6:30pm (voice). Links will have today's videos after those times.</p>`;
  tikTokContent += copyBlock(tikTokCaption);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AllFreeAlerts — Daily Content Kit</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">

        <!-- HEADER -->
        <tr><td style="background:linear-gradient(135deg,${COLORS.teal} 0%,#089E9A 100%);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="margin:0 0 4px 0;font-size:26px;color:#ffffff;font-weight:800;letter-spacing:-0.5px;">AllFreeAlerts</h1>
          <p style="margin:0 0 2px 0;font-size:13px;color:rgba(255,255,255,0.85);">Free Stuff, Found For You</p>
          <p style="margin:8px 0 0 0;font-size:16px;color:#ffffff;font-weight:700;">Daily Content Kit</p>
        </td></tr>

        <!-- DATE -->
        <tr><td style="background:#ffffff;padding:12px 24px;border-bottom:1px solid #eee;text-align:center;">
          <p style="margin:0;font-size:13px;color:#888;">${escapeHtml(dateStr)}</p>
        </td></tr>

        <!-- INSTRUCTIONS -->
        <tr><td style="background:#ffffff;padding:16px 24px 20px 24px;border-bottom:1px solid #eee;">
          <p style="margin:0;font-size:14px;color:#555;line-height:1.6;">Your daily content is ready. Each section has copy-paste blocks — just select the text, copy, and paste into the platform. Image URLs are included where needed.</p>
        </td></tr>

        <!-- BODY -->
        <tr><td style="background:#f0f0f0;padding:20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">

            ${platformSection('🐦', 'X / Twitter — 5 Tweets for Buffer', '#1DA1F2', tweetContent)}
            ${platformSection('🤖', 'Reddit — 3 Subreddit Posts', '#FF4500', redditContent)}
            ${platformSection('👥', 'Facebook Groups — 1 Post', '#1877F2', fbContent)}
            ${platformSection('🎵', 'TikTok — Reel Caption', '#000000', tikTokContent)}

          </table>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="padding:20px;text-align:center;border-radius:0 0 12px 12px;background:#ffffff;">
          <p style="margin:0 0 6px 0;font-size:12px;color:#aaa;">This kit was generated from today's deals on <a href="${SITE_URL}" style="color:${COLORS.teal};text-decoration:none;">allfreealerts.com</a></p>
          <p style="margin:0;font-size:12px;color:#aaa;">@allfreealerts on Instagram, Facebook, X, TikTok, Bluesky, YouTube</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Brevo Email Sending ──

function sendEmail(subject, htmlContent) {
  return new Promise((resolve, reject) => {
    if (!BREVO_API_KEY) {
      return reject(new Error('BREVO_API_KEY environment variable is not set'));
    }
    const body = JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: 'hansel5065@gmail.com', name: SENDER_NAME }],
      subject,
      htmlContent,
    });
    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(responseBody); } catch { parsed = responseBody; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`Brevo API ${res.statusCode}: ${JSON.stringify(parsed)}`));
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
  log('Starting Daily Content Kit generation...');

  // Load data
  const allDeals = loadDeals();
  log(`Loaded ${allDeals.length} deals from results.json`);

  const history = loadHistory();
  log(`History has ${(history.used || []).length} previously used deals`);

  // Pick deals for each section
  const sweepPicks = pickDeals(allDeals, history, 3, 'Sweepstakes');
  const freebiePicks = pickDeals(allDeals, history, 3, 'Freebies');
  const settlementPicks = pickDeals(allDeals, history, 3, 'Settlements');

  log(`Picked: ${sweepPicks.length} sweepstakes, ${freebiePicks.length} freebies, ${settlementPicks.length} settlements`);

  if (sweepPicks.length === 0 && freebiePicks.length === 0 && settlementPicks.length === 0) {
    log('No deals available — skipping content kit generation.');
    return;
  }

  // -- 5 Tweets (mix of categories, round-robin) --
  const tweetPool = [];
  const maxLen = Math.max(sweepPicks.length, freebiePicks.length, settlementPicks.length);
  for (let i = 0; i < maxLen; i++) {
    if (sweepPicks[i]) tweetPool.push(sweepPicks[i]);
    if (freebiePicks[i]) tweetPool.push(freebiePicks[i]);
    if (settlementPicks[i]) tweetPool.push(settlementPicks[i]);
  }
  const tweetDeals = tweetPool.slice(0, 5);
  const tweets = tweetDeals.map((deal, i) => generateTweet(deal, i));
  log(`Generated ${tweets.length} tweets`);

  // -- 3 Reddit posts --
  const redditPosts = [];
  if (freebiePicks[0]) redditPosts.push(generateRedditFreebie(freebiePicks[0]));
  if (sweepPicks[0]) redditPosts.push(generateRedditSweepstakes(sweepPicks[0]));
  if (settlementPicks[0]) redditPosts.push(generateRedditSettlement(settlementPicks[0]));
  log(`Generated ${redditPosts.length} Reddit posts`);

  // -- Facebook Group post --
  const fbPost = generateFBGroupPost(sweepPicks[0], freebiePicks[0], settlementPicks[0]);
  log('Generated Facebook Group post');

  // -- TikTok caption --
  const tikTokCaption = generateTikTokCaption(sweepPicks[0], freebiePicks[0], settlementPicks[0]);
  log('Generated TikTok caption');

  // -- Generate deal-specific images --
  let tweetImageUrls = [];
  if (!DRY_RUN) {
    log('Generating tweet images...');
    const imagePaths = await generateTweetImages(tweetDeals);
    if (imagePaths.length > 0 && process.env.CLOUDFLARE_API_TOKEN) {
      log('Deploying images to Cloudflare...');
      deployImages();
      // Wait for CDN propagation
      log('Waiting 10s for CDN...');
      await new Promise(r => setTimeout(r, 10000));
      tweetImageUrls = tweetDeals.map((_, i) => `${SITE_URL}/social/content-kit/tweet_${i}.png`);
    } else if (imagePaths.length > 0) {
      log('No CLOUDFLARE_API_TOKEN — images generated locally but not deployed');
    }
  }

  // -- Build email HTML --
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const emailHtml = buildEmailHtml(tweets, tweetDeals, tweetImageUrls, redditPosts, fbPost, tikTokCaption, dateStr);
  const subject = `Daily Content Kit — ${dateStr}`;

  if (DRY_RUN) {
    log('DRY RUN — saving to content_kit_preview.html');
    const previewPath = path.join(__dirname, 'content_kit_preview.html');
    fs.writeFileSync(previewPath, emailHtml);
    log(`Preview saved to ${previewPath}`);
    console.log('\n--- EMAIL SUBJECT ---');
    console.log(subject);
    console.log('\n--- TWEETS ---');
    tweets.forEach((t, i) => {
      console.log(`\nTweet ${i + 1} (${tweetDeals[i].category}, ${t.length} chars):`);
      console.log(t);
      console.log(`Image: ${getCategoryImage(tweetDeals[i].category, i)}`);
    });
    console.log('\n--- REDDIT ---');
    redditPosts.forEach(rp => {
      console.log(`\n${rp.subreddit}:`);
      console.log(`Title: ${rp.title}`);
      console.log(`Body: ${rp.body}`);
    });
    console.log('\n--- FACEBOOK GROUP ---');
    console.log(fbPost);
    console.log('\n--- TIKTOK CAPTION ---');
    console.log(tikTokCaption);
  } else {
    // Send email
    if (!BREVO_API_KEY) {
      log('WARNING: BREVO_API_KEY is not set. Cannot send email.');
      log('Use --dry-run to preview the content kit locally.');
      const previewPath = path.join(__dirname, 'content_kit_preview.html');
      fs.writeFileSync(previewPath, emailHtml);
      log(`Saved preview to ${previewPath} instead.`);
    } else {
      try {
        const result = await sendEmail(subject, emailHtml);
        log(`Email sent successfully! Message ID: ${result.messageId || JSON.stringify(result)}`);
      } catch (err) {
        log(`ERROR sending email: ${err.message}`);
        const previewPath = path.join(__dirname, 'content_kit_preview.html');
        fs.writeFileSync(previewPath, emailHtml);
        log(`Saved preview to ${previewPath} as fallback.`);
      }
    }
  }

  // Update history with the deals we used
  const usedLinks = [
    ...tweetDeals.map(d => d.link),
    ...(freebiePicks[0] ? [freebiePicks[0].link] : []),
    ...(sweepPicks[0] ? [sweepPicks[0].link] : []),
    ...(settlementPicks[0] ? [settlementPicks[0].link] : []),
  ];
  const uniqueUsed = [...new Set(usedLinks)];
  history.used = [...new Set([...(history.used || []), ...uniqueUsed])];

  // Keep history manageable — cap at 500 most recent entries
  if (history.used.length > 500) {
    history.used = history.used.slice(history.used.length - 500);
  }

  history.lastRun = today();
  saveHistory(history);

  log('Done!');
}

main().catch(err => {
  console.error(`[ContentKit] Fatal error: ${err.message}`);
  process.exit(1);
});
