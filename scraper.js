#!/usr/bin/env node
// FreeClaimSpot Standalone Scraper
// Run: node scraper.js
// Scrapes all 10 sources, deduplicates, saves JSON + CSV, sends Telegram summary

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const TELEGRAM_BOT_TOKEN = ''; // Fill in your bot token
const TELEGRAM_CHAT_ID = '674396484';
const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const CSV_FILE = path.join(DATA_DIR, 'results.csv');
const LOG_FILE = path.join(DATA_DIR, 'scraper.log');

// === UTILITIES ===
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/<!\[CDATA\[|\]\]>/g, '');
}

function fetchPage(url, timeout = 15000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchPage(resolved, timeout).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (d.includes('Just a moment') || d.includes('500 Server Error')) resolve(null);
        else resolve(d);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

function fetchJSON(url, timeout = 15000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location, timeout).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

function fetchNoRedirect(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.contestgirl.com/',
      }
    }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode, location: res.headers.location || null });
    });
    req.on('error', () => resolve({ statusCode: 0, location: null }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ statusCode: 0, location: null }); });
  });
}

const JUNK_DOMAINS = [
  'facebook.com', 'twitter.com', 'instagram.com', 'pinterest.com', 'youtube.com',
  'google.com', 'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com',
  'googleadservices.com', 'doubleclick.net', 'gstatic.com', 'googleapis.com',
  'linkedin.com', 'tiktok.com', 'reddit.com', 'apple.com/app', 'play.google.com',
  'amazon.com/gp/', 'amzn.to', 'gravatar.com', 'cloudflare.com',
  'shareaholic', 'addtoany', 'sharethis', 'disqus.com',
  'w.org', 'wordpress.org', 'schema.org', 'creativecommons.org',
  'feeds.feedburner', 'feedburner.com',
  'gmpg.org', 'hip.attn.tv', 'attn.tv', 'shophermedia.net', 'magik.ly',
  'apps.apple.com', 'itunes.apple.com',
  '.css', '.js', '.png', '.jpg', '.gif', '.svg', '.woff',
  'wp-content', 'wp-json', 'cdn.',
];

// US state names for settlement scope detection
const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
  'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
  'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
  'Wisconsin','Wyoming'
];

function detectScope(text) {
  const lower = (text || '').toLowerCase();
  for (const state of US_STATES) {
    if (lower.includes(state.toLowerCase())) return 'state-specific';
  }
  return 'nationwide';
}

function extractOutboundLink(html, excludeDomain) {
  const linkRegex = /href="(https?:\/\/[^"]+)"/g;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const url = m[1].toLowerCase();
    if (url.includes(excludeDomain)) continue;
    if (JUNK_DOMAINS.some(junk => url.includes(junk))) continue;
    return m[1];
  }
  return null;
}

async function resolveInBatches(items, resolver, batchSize) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(resolver));
  }
}

function parseRssItems(xml) {
  return (xml.match(/<item>([\s\S]*?)<\/item>/g) || []).map(item => ({
    title: (item.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '',
    link: (item.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1] || '',
    categories: (item.match(/<category[^>]*>([\s\S]*?)<\/category>/g) || [])
      .map(c => c.replace(/<\/?category[^>]*>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '')),
  }));
}

function escapeCsv(val) {
  if (!val) return '';
  const s = String(val).replace(/"/g, '""');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN) {
    log('Telegram: No bot token configured, skipping');
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { log(`Telegram: ${res.statusCode}`); resolve(); });
    });
    req.on('error', (e) => { log(`Telegram error: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

// === SCRAPERS ===

async function scrapeContestgirl() {
  log('Scraping Contestgirl (6 feeds)...');
  const items = [];
  const feeds = [
    { code: 's', category: 'Sweepstakes' },
    { code: 'd', category: 'Sweepstakes' },
    { code: 'w', category: 'Sweepstakes' },
    { code: 'o', category: 'Sweepstakes' },
    { code: 'g', category: 'Sweepstakes' },
    { code: 'f', category: 'Freebies' },
  ];
  for (const feed of feeds) {
    const html = await fetchPage(`https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=${feed.code}&s=_&sort=p`);
    if (!html) { log(`  CG feed=${feed.code}: FAILED`); continue; }
    const listingRegex = /<td class="padded"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
    let match, count = 0;
    while ((match = listingRegex.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/<a[^>]*href="\/sweepstakes\/countHits\.pl\?[^"]*"[^>]*rel="nofollow">([^<]+)<\/a><\/b>/);
      if (!titleMatch) continue;
      const linkMatch = block.match(/href="(\/sweepstakes\/countHits\.pl\?[^"]*)"/);
      const endDateMatch = block.match(/<b>End Date:<\/b>\s*([^<]+)/);
      const prizeMatch = block.match(/<div style="margin-top:6px;margin-bottom:4px;font-size:15px;">([^<]+)<\/div>/);
      const restrictMatch = block.match(/<b>Restrictions:&nbsp;<\/b><\/td><td[^>]*>\s*([^<]+)/);
      const redirectUrl = linkMatch ? 'https://www.contestgirl.com' + linkMatch[1] : '';
      count++;
      items.push({
        title: decodeEntities(titleMatch[1].replace(/--/g, ' - ').trim()),
        link: redirectUrl,
        source: 'contestgirl', category: feed.category,
        end_date: endDateMatch ? endDateMatch[1].trim() : '',
        prize_summary: prizeMatch ? prizeMatch[1].trim() : '',
        eligibility: restrictMatch ? restrictMatch[1].trim() : '',
      });
    }
    log(`  CG feed=${feed.code}: ${count} items`);
  }

  // Resolve redirects to get direct contest URLs
  log(`  Resolving ${items.length} CG redirect URLs...`);
  let resolved = 0;
  await resolveInBatches(items, async (item) => {
    if (!item.link) return;
    const resp = await fetchNoRedirect(item.link);
    if (resp.location) { item.link = resp.location; resolved++; }
  }, 10);
  log(`  CG resolved: ${resolved}/${items.length} direct URLs`);
  return items;
}

async function sweepstakesFanatics() {
  log('Scraping Sweepstakes Fanatics (RSS + article follow)...');
  const items = [];
  const xml = await fetchPage('https://sweepstakesfanatics.com/feed/');
  if (!xml) { log('  SF: FAILED to fetch RSS'); return items; }

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    if (rss.categories.some(c => c.toLowerCase().includes('expired'))) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'sweepstakesfanatics', category: 'Sweepstakes',
    });
  }
  log(`  SF: ${items.length} RSS items, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'sweepstakesfanatics.com');
    if (d) { item.link = d; direct++; }
  }, 10);
  log(`  SF: ${direct}/${items.length} direct links found`);
  // Only return items where we found a direct link (no middleman)
  return items.filter(i => i.link !== i.articleUrl).map(({ articleUrl, ...rest }) => rest);
}

async function freebieshark() {
  log('Scraping Freebie Shark (HTML + article follow)...');
  const items = [];
  const feeds = [
    { category: 'Freebies', url: 'https://freebieshark.com/' },
    { category: 'Sweepstakes', url: 'https://freebieshark.com/category/sweepstakes/' },
  ];
  for (const feed of feeds) {
    const html = await fetchPage(feed.url);
    if (!html) { log(`  FS ${feed.category}: FAILED`); continue; }
    const regex = /<h2 class="headline">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/g;
    let m, count = 0;
    while ((m = regex.exec(html)) !== null) {
      count++;
      items.push({
        title: decodeEntities(m[2].trim()),
        articleUrl: m[1],
        link: m[1],
        source: 'freebieshark', category: feed.category,
      });
    }
    log(`  FS ${feed.category}: ${count} items`);
  }
  log(`  FS: Following ${items.length} articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'freebieshark.com');
    if (d) { item.link = d; direct++; }
  }, 10);
  log(`  FS: ${direct}/${items.length} direct links found`);
  return items.map(({ articleUrl, ...rest }) => rest);
}

async function freeflys() {
  log('Scraping FreeFlys (RSS + article follow)...');
  const items = [];
  const xml = await fetchPage('https://www.freeflys.com/feed/');
  if (!xml) { log('  FF: FAILED (likely Cloudflare)'); return items; }

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'freeflys', category: 'Freebies',
    });
  }
  log(`  FF: ${items.length} RSS items`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'freeflys.com');
    if (d) { item.link = d; direct++; }
  }, 5);
  log(`  FF: ${direct}/${items.length} direct links found`);
  return items.map(({ articleUrl, ...rest }) => rest);
}

async function hip2save() {
  log('Scraping Hip2Save (RSS + article follow for direct links)...');
  const items = [];
  const xml = await fetchPage('https://hip2save.com/freebies/feed/');
  if (!xml) { log('  H2S: FAILED'); return items; }

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'hip2save', category: 'Freebies',
    });
  }
  log(`  H2S: ${items.length} RSS items, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    // Only extract links from the article content area
    const contentStart = html.indexOf('entry-content');
    if (contentStart === -1) return;
    const contentEnd = html.indexOf('</article', contentStart);
    const content = contentEnd > contentStart
      ? html.substring(contentStart, contentEnd)
      : html.substring(contentStart, contentStart + 10000);
    const d = extractOutboundLink(content, 'hip2save.com');
    if (d) { item.link = d; direct++; }
  }, 20);
  log(`  H2S: ${direct}/${items.length} direct links found`);
  // Only keep items with direct links (no middleman)
  return items.filter(i => i.link !== i.articleUrl).map(({ articleUrl, ...rest }) => rest);
}

async function classactionOrg() {
  log('Scraping ClassAction.org (settlements with deadlines)...');
  const items = [];
  const html = await fetchPage('https://www.classaction.org/settlements');
  if (!html) { log('  CA: FAILED'); return items; }

  const cardBlocks = html.split(/class="[^"]*settlement-card[^"]*"/);
  let skipped = 0;
  for (let i = 1; i < cardBlocks.length; i++) {
    const block = cardBlocks[i].substring(0, 3000);
    const prevEnd = cardBlocks[i - 1].slice(-200);
    const deadlineMatch = prevEnd.match(/data-deadline="(\d+)"/);
    const daysLeft = deadlineMatch ? parseInt(deadlineMatch[1]) : null;
    if (daysLeft === 9999 || daysLeft === null) { skipped++; continue; }

    const linkMatch = block.match(/<a\s+href="([^"]+)"\s+class="js-settlement-link[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!linkMatch) { skipped++; continue; }

    const payoutMatch = block.match(/Payout<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
    const deadlineDateMatch = block.match(/Deadline<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
    const proofMatch = block.match(/Required\?<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
    const descMatch = block.match(/<p class="f6 lh-copy[^"]*">([^<]+)<\/p>/);

    let deadlineDate = deadlineDateMatch ? deadlineDateMatch[1].trim() : '';
    if (deadlineDate) {
      const parsed = new Date(deadlineDate);
      if (!isNaN(parsed.getTime()) && parsed < new Date()) { skipped++; continue; }
    }

    const titleText = decodeEntities(linkMatch[2].trim());
    const descText = descMatch ? decodeEntities(descMatch[1].trim()) : '';
    items.push({
      title: titleText,
      link: linkMatch[1],
      source: 'classaction', category: 'Settlements',
      deadline: deadlineDate,
      payout: payoutMatch ? payoutMatch[1].trim() : '',
      proof_required: proofMatch ? proofMatch[1].trim() : '',
      description: descText,
      scope: detectScope(titleText + ' ' + descText),
    });
  }
  log(`  CA: ${items.length} active settlements (${skipped} skipped)`);
  return items;
}

async function sweetiesSweeps() {
  log('Scraping Sweeties Sweeps (WP REST API)...');
  const items = [];
  const posts = await fetchJSON('https://sweetiessweeps.com/wp-json/wp/v2/posts?per_page=50');
  if (!posts || !Array.isArray(posts)) { log('  SS: FAILED'); return items; }

  for (const post of posts) {
    const title = post.title?.rendered || '';
    const content = post.content?.rendered || '';
    if (!title) continue;
    const directLink = extractOutboundLink(content, 'sweetiessweeps.com');
    items.push({
      title: decodeEntities(title.trim()),
      link: directLink || post.link,
      source: 'sweetiessweeps', category: 'Sweepstakes',
    });
  }
  log(`  SS: ${items.length} items`);
  return items;
}

async function sweepsAdvantage() {
  log('Scraping Sweepstakes Advantage (4 category pages)...');
  const items = [];
  const pages = [
    'https://www.sweepsadvantage.com/daily-sweepstakes.html',
    'https://www.sweepsadvantage.com/one-entry-sweepstakes.html',
    'https://www.sweepsadvantage.com/instant-win-sweepstakes',
    'https://www.sweepsadvantage.com/cash-sweepstakes',
  ];
  const seen = new Set();
  for (const pageUrl of pages) {
    const html = await fetchPage(pageUrl);
    if (!html) { log(`  SA: FAILED ${pageUrl.split('/').pop()}`); continue; }

    // Pattern 1: image links with alt text
    const entryRe = /href="(https?:\/\/[^"]+)"[^>]*target="_blank"[^>]*rel="nofollow"[^>]*>[\s\S]*?alt="([^"]+)"/g;
    let m, count = 0;
    while ((m = entryRe.exec(html)) !== null) {
      const url = m[1];
      if (url.includes('sweepsadvantage') || url.includes('sweepstakesplus')) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      count++;
      items.push({
        title: decodeEntities(m[2].replace(/ Sweepstakes$/, '').trim()),
        link: url,
        source: 'sweepsadvantage', category: 'Sweepstakes',
      });
    }

    // Pattern 2: text links with nofollow
    const textRe = /href="(https?:\/\/[^"]+)"[^>]*rel="nofollow"[^>]*target="_blank"[^>]*>([^<]{10,})/g;
    while ((m = textRe.exec(html)) !== null) {
      const url = m[1];
      if (url.includes('sweepsadvantage') || url.includes('sweepstakesplus')) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      count++;
      items.push({
        title: decodeEntities(m[2].trim()),
        link: url,
        source: 'sweepsadvantage', category: 'Sweepstakes',
      });
    }

    // Pattern 3: links inside sweepstakes listing divs
    const listRe = /href="(https?:\/\/[^"]+)"[^>]*target="_blank"[^>]*>([^<]{5,})<\/a>/g;
    while ((m = listRe.exec(html)) !== null) {
      const url = m[1];
      if (url.includes('sweepsadvantage') || url.includes('sweepstakesplus')) continue;
      if (JUNK_DOMAINS.some(junk => url.toLowerCase().includes(junk))) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      count++;
      items.push({
        title: decodeEntities(m[2].trim()),
        link: url,
        source: 'sweepsadvantage', category: 'Sweepstakes',
      });
    }
    log(`  SA ${pageUrl.split('/').pop()}: ${count} items`);
  }
  log(`  SA total: ${items.length} items`);
  return items;
}

async function topClassActions() {
  log('Scraping Top Class Actions (RSS)...');
  const items = [];
  const xml = await fetchPage('https://topclassactions.com/feed/');
  if (!xml) { log('  TCA: FAILED'); return items; }

  // Only keep open settlements (skip news, investigations, lawsuits)
  const candidates = [];
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const link = rss.link.trim();
    const titleLower = rss.title.toLowerCase();
    // Must be an open settlement with "settlement" in title — skip news/investigations
    if (!titleLower.includes('settlement')) continue;
    if (titleLower.includes('investigation') || titleLower.includes('lawsuit filed') ||
        titleLower.includes('sued') || titleLower.includes('accused') ||
        titleLower.includes('alleges') || titleLower.includes('class action claims')) continue;
    candidates.push({ title: decodeEntities(rss.title.trim()), tcaLink: link });
  }
  log(`  TCA: ${candidates.length} settlement articles, following for claim URLs...`);

  // Follow each article page to extract the actual claim form URL
  const CLAIM_DOMAINS = /claim|filing|submit|epiq|gilardi|simpluris|angeion|jnd|kcc|rust|atticus|settlementadministrator|settlementonline|classactionsettlement|settlement/i;
  const BATCH = 10;
  let found = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    await Promise.all(batch.map(async (c) => {
      const html = await fetchPage(c.tcaLink);
      if (!html) return;
      // Find external links with claim/settlement keywords
      const linkRe = /href="(https?:\/\/[^"]+)"/gi;
      let m;
      const claimUrls = [];
      while ((m = linkRe.exec(html)) !== null) {
        const href = m[1];
        if (href.includes('topclassactions.com')) continue;
        if (href.includes('facebook.com') || href.includes('twitter.com') || href.includes('instagram.com') || href.includes('tiktok.com')) continue;
        if (CLAIM_DOMAINS.test(href)) claimUrls.push(href);
      }
      if (claimUrls.length > 0) {
        // Pick the most specific claim URL (prefer /claim, /file, /submit paths)
        const best = claimUrls.find(u => /\/claim|\/file|\/submit/i.test(u)) || claimUrls[0];
        items.push({
          title: c.title,
          link: best,
          source: 'topclassactions', category: 'Settlements',
          scope: detectScope(c.title),
        });
        found++;
      }
    }));
  }
  log(`  TCA: ${found}/${candidates.length} settlements with claim URLs`);
  return items;
}

async function ftcRefunds() {
  log('Scraping FTC Refunds...');
  const items = [];
  const html = await fetchPage('https://www.ftc.gov/enforcement/refunds');
  if (!html) { log('  FTC: FAILED'); return items; }

  const refundRe = /<a[^>]*href="(\/enforcement\/refunds\/[^"]+)"[^>]*>([^<]+)/g;
  let m;
  while ((m = refundRe.exec(html)) !== null) {
    const title = m[2].trim();
    if (title.length < 5) continue;
    items.push({
      title: decodeEntities(title),
      link: 'https://www.ftc.gov' + m[1],
      source: 'ftc', category: 'Settlements',
      scope: 'nationwide',
    });
  }
  log(`  FTC: ${items.length} refund cases`);
  return items;
}

// ContestListing.com - scrape listing pages, follow detail pages for direct entry links
async function contestListing() {
  log('Scraping ContestListing (pages 1-2, detail follow)...');
  const items = [];
  const seen = new Set();
  const pageUrls = [
    'https://www.contestlisting.com/',
    'https://www.contestlisting.com/?page=2',
  ];

  for (const pageUrl of pageUrls) {
    const html = await fetchPage(pageUrl);
    if (!html) { log(`  CL: FAILED ${pageUrl}`); continue; }

    // Each card: <a href="/slug/"> <div class="col-sm-2"> ... <p>Title</p> ... labels ... </div></div></div></a>
    const cardRe = /<a href="(\/[a-z0-9][a-z0-9\-]+-?(?:\d+)?\/)">[\s\S]*?<div class="col-sm-2"[\s\S]*?<p>([^<]+)<\/p>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/a>/g;
    let m, count = 0;
    while ((m = cardRe.exec(html)) !== null) {
      const slug = m[1];
      const title = decodeEntities(m[2].trim());
      if (seen.has(slug)) continue;
      if (title.length < 10) continue;

      // Extract country labels from the card block
      const cardBlock = m[0];
      const countryLabels = [];
      const countryRe = /label-warning[^>]*>([^<]+)</g;
      let cm;
      while ((cm = countryRe.exec(cardBlock)) !== null) {
        countryLabels.push(cm[1].trim());
      }
      const eligibility = countryLabels.join(', ');

      // Only include US or Worldwide entries
      const eligible = countryLabels.some(c =>
        c.toLowerCase().includes('united states') || c.toLowerCase().includes('worldwide')
      );
      if (!eligible) continue;

      seen.add(slug);
      count++;
      items.push({
        title,
        detailUrl: 'https://www.contestlisting.com' + slug,
        link: '', // will be resolved from detail page
        source: 'contestlisting', category: 'Sweepstakes',
        eligibility,
        end_date: '',
      });
    }
    log(`  CL page ${pageUrl.includes('page=2') ? '2' : '1'}: ${count} eligible items`);
  }

  // Follow detail pages to get direct entry links and deadlines
  log(`  CL: Following ${items.length} detail pages...`);
  let resolved = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.detailUrl);
    if (!html) return;

    // Extract direct entry link: <a target="_blank" href="EXTERNAL_URL" class="btn btn-success"
    const entryMatch = html.match(/<a[^>]*target="_blank"[^>]*href="(https?:\/\/[^"]+)"[^>]*class="btn btn-success"/);
    if (!entryMatch) {
      // Try alternate order: class before href
      const altMatch = html.match(/<a[^>]*class="btn btn-success"[^>]*href="(https?:\/\/[^"]+)"[^>]*target="_blank"/);
      if (altMatch) {
        item.link = altMatch[1].replace(/&amp;/g, '&');
        resolved++;
      }
    } else {
      item.link = entryMatch[1].replace(/&amp;/g, '&');
      resolved++;
    }

    // Extract deadline: Ending in X days <small>(on DATE)</small>
    const deadlineMatch = html.match(/Ending in \d+ days?\s*<small>\(on ([^)]+)\)<\/small>/);
    if (deadlineMatch) {
      item.end_date = deadlineMatch[1].trim();
    }

    // Extract image from detail page
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  CL: ${resolved}/${items.length} direct entry links found`);

  // Only keep items where we found a direct external link (no middleman)
  return items.filter(i => i.link && i.link.startsWith('http')).map(({ detailUrl, ...rest }) => rest);
}

// GiveawayBase - scrape active giveaways listing, follow detail pages for entry links
// NOTE: Site uses Cloudflare managed challenge. fetchPage() may get 403 in some environments.
// If it fails, it returns [] gracefully via the .catch() wrapper in main().
async function giveawayBase() {
  log('Scraping GiveawayBase (pages 1-3, detail follow)...');
  const items = [];
  const seen = new Set();
  const pageUrls = [
    'https://giveawaybase.com/category/active-giveaways/',
    'https://giveawaybase.com/category/active-giveaways/page/2/',
    'https://giveawaybase.com/category/active-giveaways/page/3/',
  ];

  for (const pageUrl of pageUrls) {
    const html = await fetchPage(pageUrl);
    if (!html) { log(`  GB: FAILED ${pageUrl}`); continue; }

    // Each listing: <article class="post-XXXX ..."> <header> <h2 class="entry-title"><a href="URL">Title</a></h2>
    const articleRe = /<article[^>]*class="[^"]*post[^"]*"[^>]*>[\s\S]*?<h2[^>]*class="entry-title"[^>]*>\s*<a[^>]*href="(https:\/\/giveawaybase\.com\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
    let m, count = 0;
    while ((m = articleRe.exec(html)) !== null) {
      const detailUrl = m[1].replace(/&amp;/g, '&');
      const title = decodeEntities(m[2].trim());
      if (seen.has(detailUrl)) continue;
      if (title.length < 10) continue;
      seen.add(detailUrl);
      count++;
      items.push({
        title,
        detailUrl,
        link: '', // will be resolved from detail page
        source: 'giveawaybase', category: 'Sweepstakes',
        eligibility: '',
        end_date: '',
      });
    }
    log(`  GB page ${pageUrl.includes('page/2') ? '2' : pageUrl.includes('page/3') ? '3' : '1'}: ${count} items`);
  }

  // Follow detail pages to get direct entry links, end dates, and eligibility
  log(`  GB: Following ${items.length} detail pages...`);
  let resolved = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.detailUrl);
    if (!html) return;

    // Extract eligibility: <h3>OPEN TO: WORLDWIDE</h3> or similar heading tag
    const openMatch = html.match(/<h[1-6][^>]*>[^<]*OPEN TO:\s*([^<]+)<\/h[1-6]>/i);
    if (openMatch) {
      item.eligibility = openMatch[1].trim();
    }

    // Only include US/Worldwide entries
    const elig = item.eligibility.toUpperCase();
    if (!elig.includes('WORLDWIDE') && !elig.includes('US') && !elig.includes('UNITED STATES')) {
      item.link = ''; // mark for removal
      return;
    }

    // Extract end date: <h3>GIVEAWAY END: April 28th, 2026</h3>
    const endMatch = html.match(/<h[1-6][^>]*>[^<]*GIVEAWAY END:\s*([^<]+)<\/h[1-6]>/i);
    if (endMatch) {
      item.end_date = endMatch[1].trim();
    }

    // Extract direct entry link: target="_blank" link that's NOT giveawaybase.com or social media
    // The entry link is typically in STEP 1 area, inside <a target="_blank" href="https://wn.nr/..." or "https://gleam.io/..."
    const linkRe = /<a[^>]*target="_blank"[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g;
    let lm;
    while ((lm = linkRe.exec(html)) !== null) {
      const url = lm[1].replace(/&amp;/g, '&').trim();
      const lower = url.toLowerCase();
      // Skip internal and social/ad links
      if (lower.includes('giveawaybase.com')) continue;
      if (lower.includes('facebook.com')) continue;
      if (lower.includes('twitter.com')) continue;
      if (lower.includes('instagram.com')) continue;
      if (lower.includes('pinterest.com')) continue;
      if (lower.includes('youtube.com')) continue;
      if (lower.includes('t.me/')) continue;
      if (lower.includes('binance.com')) continue;
      if (lower.includes('earnapp.com')) continue;
      if (lower.includes('proxyrack.com')) continue;
      if (lower.includes('honeygain.me')) continue;
      // Found the entry link (first external non-social link)
      item.link = url;
      resolved++;
      break;
    }

    // Extract image from detail page
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  GB: ${resolved}/${items.length} direct entry links found`);

  // Only keep items where we found a direct external link and eligibility passed
  return items.filter(i => i.link && i.link.startsWith('http')).map(({ detailUrl, ...rest }) => rest);
}

// Consumer-Action.org — removed: Cloudflare bot protection blocks non-browser requests, only had 2 settlements

// Settlemate.io — class action settlement directory
async function settlemate() {
  log('Scraping Settlemate.io (settlement directory)...');
  const items = [];
  const html = await fetchPage('https://www.settlemate.io/settlements');
  if (!html) { log('  SM: FAILED'); return items; }

  // Each listing row has a link to detail page with title, deadline, payout
  // Structure: <a href="/settlements/slug" ...> containing .blog-title-settlements and .text-block-86 (deadline)
  const seen = new Set();

  // Extract all settlement detail page links and titles
  const rowRe = /<a[^>]*href="(\/settlements\/[^"]+)"[^>]*>[\s\S]*?<div[^>]*class="[^"]*blog-title-settlements[^"]*"[^>]*>([^<]+)<\/div>[\s\S]*?<\/a>/g;
  let m;
  const detailItems = [];
  while ((m = rowRe.exec(html)) !== null) {
    const slug = m[1].trim();
    const title = decodeEntities(m[2].trim());
    if (seen.has(slug)) continue;
    seen.add(slug);
    if (title.length < 5) continue;
    detailItems.push({ slug, title });
  }

  // Also try a simpler regex to catch listings
  if (detailItems.length === 0) {
    const simpleRe = /href="(\/settlements\/[a-z0-9-]+)"[^>]*>/g;
    let sm;
    const slugs = new Set();
    while ((sm = simpleRe.exec(html)) !== null) {
      const slug = sm[1].trim();
      if (slug === '/settlements/' || slug === '/settlements') continue;
      slugs.add(slug);
    }
    for (const slug of slugs) {
      detailItems.push({ slug, title: '' });
    }
  }

  // Limit to 12 detail pages to avoid pipeline timeout
  const detailBatch = detailItems.slice(0, 12);
  log(`  SM: Found ${detailItems.length} settlement pages, following top ${detailBatch.length}...`);

  // Follow detail pages to get claim URLs, deadlines, and full titles
  await resolveInBatches(detailBatch, async (item) => {
    const detailHtml = await fetchPage(`https://www.settlemate.io${item.slug}`, 8000);
    if (!detailHtml) return;

    // Get title from detail page if missing
    if (!item.title) {
      const titleMatch = detailHtml.match(/<h1[^>]*>([^<]+)<\/h1>/);
      if (titleMatch) item.title = decodeEntities(titleMatch[1].trim());
    }

    // Get deadline from detail page
    const deadlineMatch = detailHtml.match(/deadline[:\s]*([A-Z][a-z]+ \d{1,2},?\s*\d{4})/i) ||
                          detailHtml.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (deadlineMatch) {
      const parsed = new Date(deadlineMatch[1]);
      if (!isNaN(parsed) && parsed <= new Date()) {
        item.expired = true; // mark for removal
        return;
      }
      if (!isNaN(parsed)) item.end_date = parsed.toISOString().split('T')[0];
    }

    // Extract claim form URL — external link that's not settlemate.io, social, or CDN
    const linkRe = /href="(https?:\/\/(?!www\.settlemate|settlemate\.io|web\.settlemate|cdn\.|apps\.apple|play\.google|facebook\.com|twitter\.com|instagram\.com|linkedin\.com|tiktok\.com)[^"]+)"/g;
    let lm;
    while ((lm = linkRe.exec(detailHtml)) !== null) {
      const url = lm[1].replace(/&amp;/g, '&').trim();
      // Prefer settlement/claim domain links
      if (url.includes('settlement') || url.includes('claim') || url.includes('filing')) {
        item.claimUrl = url;
        break;
      }
      if (!item.claimUrl) item.claimUrl = url; // fallback to first external link
    }

    // Extract image
    const img = extractImage(detailHtml);
    if (img) item.image = img;
  }, 5);

  // Build final items — only those with claim URLs and not expired
  for (const item of detailBatch) {
    if (item.expired) continue;
    if (!item.claimUrl || !item.title) continue;
    if (item.title.length < 10) continue;

    items.push({
      title: item.title,
      link: item.claimUrl,
      source: 'settlemate', category: 'Settlements',
      scope: detectScope(item.title),
      ...(item.end_date ? { end_date: item.end_date } : {}),
      ...(item.image ? { image: item.image } : {}),
    });
  }

  log(`  SM: ${items.length} settlements with claim URLs`);
  return items;
}

async function openClassActions() {
  log('Scraping OpenClassActions.com (settlement cards + detail follow)...');
  const items = [];
  const html = await fetchPage('https://openclassactions.com');
  if (!html) { log('  OCA: FAILED'); return items; }

  // Extract settlement cards from homepage: <a href="...settlements/SLUG.php"><div class="settlement-card">
  const cardRe = /<a[^>]*href="(https?:\/\/openclassactions\.com\/(?:settlements\/)?[^"]+\.php)"[^>]*>[\s\S]*?<h2[^>]*class="[^"]*settlement-card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<\/a>/g;
  let m;
  const candidates = [];
  const seen = new Set();
  while ((m = cardRe.exec(html)) !== null) {
    const detailUrl = m[1].trim();
    const title = decodeEntities(m[2].trim().replace(/<[^>]+>/g, ''));
    if (seen.has(detailUrl) || title.length < 10) continue;
    seen.add(detailUrl);
    candidates.push({ detailUrl, title });
  }
  log(`  OCA: ${candidates.length} settlement cards, following for claim URLs...`);

  // Follow each detail page to extract actual claim form URL
  let found = 0;
  await resolveInBatches(candidates, async (c) => {
    const detail = await fetchPage(c.detailUrl, 8000);
    if (!detail) return;

    // Claim form URL: <a class="btn" href="EXTERNAL_URL">File Your Claim</a>
    const btnMatch = detail.match(/<a[^>]*class="btn"[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    if (btnMatch && !btnMatch[1].includes('openclassactions.com')) {
      c.claimUrl = btnMatch[1].replace(/&amp;/g, '&');
    }
    // Fallback: "Claim Form Website: <a href="...">"
    if (!c.claimUrl) {
      const siteMatch = detail.match(/Claim Form Website[^<]*<a[^>]*href="(https?:\/\/[^"]+)"/i);
      if (siteMatch && !siteMatch[1].includes('openclassactions.com')) {
        c.claimUrl = siteMatch[1].replace(/&amp;/g, '&');
      }
    }
    // Extract deadline from detail page
    const deadlineMatch = detail.match(/Deadline[:\s]*([A-Z][a-z]+ \d{1,2},?\s*\d{4})/i)
      || detail.match(/Deadline[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (deadlineMatch) c.deadline = deadlineMatch[1];

    // Extract payout
    const payoutMatch = detail.match(/Without Proof[:\s]*(\$[\d,.]+)/i)
      || detail.match(/Estimated Payout[:\s]*(\$[\d,.]+)/i);
    if (payoutMatch) c.payout = payoutMatch[1];

    if (c.claimUrl) found++;
  }, 10);

  // Build final items — only those with actual claim URLs
  for (const c of candidates) {
    if (!c.claimUrl) continue;
    items.push({
      title: c.title,
      link: c.claimUrl,
      source: 'openclassactions', category: 'Settlements',
      scope: detectScope(c.title),
      ...(c.deadline ? { end_date: c.deadline } : {}),
      ...(c.payout ? { payout: c.payout } : {}),
    });
  }
  log(`  OCA: ${found}/${candidates.length} settlements with claim URLs`);
  return items;
}

async function claimDepot() {
  log('Scraping ClaimDepot.com (paginated settlement cards + detail follow)...');
  const items = [];
  const candidates = [];
  const seen = new Set();

  // Paginate through listings — 100 per page
  for (let page = 1; page <= 15; page++) {
    const url = page === 1
      ? 'https://www.claimdepot.com/settlements'
      : `https://www.claimdepot.com/settlements?0ff52671_page=${page}`;
    const html = await fetchPage(url);
    if (!html) break;

    // Extract cards: title, slug, status, deadline
    const cardRe = /<div[^>]*role="listitem"[^>]*class="[^"]*c-collection_item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g;
    let m;
    let pageCount = 0;
    // Simpler approach: extract title links and status
    const titleRe = /<a[^>]*fs-cmsfilter-field="name"[^>]*href="(\/settlements\/[^"]+)"[^>]*class="[^"]*c-title-3[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = titleRe.exec(html)) !== null) {
      const slug = m[1].trim();
      const title = decodeEntities(m[2].trim().replace(/<[^>]+>/g, ''));
      if (seen.has(slug) || title.length < 10) continue;
      seen.add(slug);
      candidates.push({ slug, title });
      pageCount++;
    }
    if (pageCount === 0) break;
    log(`  CD: page ${page}: ${pageCount} items`);
  }

  // Filter: only follow detail pages to get claim URLs for open settlements
  log(`  CD: ${candidates.length} total items, following for claim URLs...`);

  let found = 0;
  await resolveInBatches(candidates, async (c) => {
    const detail = await fetchPage(`https://www.claimdepot.com${c.slug}`, 8000);
    if (!detail) return;

    // Check status — only keep "Open for Claims"
    const statusMatch = detail.match(/summary-status[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (statusMatch) {
      const status = statusMatch[1].trim().toLowerCase();
      if (!status.includes('open')) return; // skip non-open settlements
    }

    // Claim form URL: <a class="primary-button-4" target="_blank" href="EXTERNAL">
    const btnMatch = detail.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*primary-button-4[^"]*"[^>]*target="_blank"/i)
      || detail.match(/<a[^>]*class="[^"]*primary-button-4[^"]*"[^>]*target="_blank"[^>]*href="(https?:\/\/[^"]+)"/i)
      || detail.match(/<a[^>]*class="[^"]*primary-button-4[^"]*"[^>]*href="(https?:\/\/[^"]+)"[^>]*target="_blank"/i);
    if (btnMatch) {
      const claimUrl = (btnMatch[1] || btnMatch[2]).replace(/&amp;/g, '&');
      if (!claimUrl.includes('claimdepot.com')) {
        c.claimUrl = claimUrl;
      }
    }

    // Fallback: Settlement Website link in sidebar
    if (!c.claimUrl) {
      const siteMatch = detail.match(/Settlement Website[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"/i);
      if (siteMatch && !siteMatch[1].includes('claimdepot.com')) {
        c.claimUrl = siteMatch[1].replace(/&amp;/g, '&');
      }
    }

    // Extract deadline
    const deadlineMatch = detail.match(/Claim Deadline[\s\S]*?case-title-data[^>]*>([\s\S]*?)<\/div>/i);
    if (deadlineMatch) c.deadline = deadlineMatch[1].trim();

    // Extract payout
    const payoutMatch = detail.match(/Estimated Payout[\s\S]*?case-title-data[^>]*>([\s\S]*?)<\/div>/i);
    if (payoutMatch) c.payout = payoutMatch[1].trim();

    if (c.claimUrl) found++;
  }, 10);

  // Build final items
  for (const c of candidates) {
    if (!c.claimUrl) continue;
    items.push({
      title: c.title,
      link: c.claimUrl,
      source: 'claimdepot', category: 'Settlements',
      scope: detectScope(c.title),
      ...(c.deadline ? { end_date: c.deadline } : {}),
      ...(c.payout ? { payout: c.payout } : {}),
    });
  }
  log(`  CD: ${found}/${candidates.length} settlements with claim URLs`);
  return items;
}

// === NEW SOURCES ===

// UltraContest - scrape category pages for direct contest links
async function ultraContest() {
  log('Scraping UltraContest (category pages)...');
  const items = [];
  const pages = [
    'https://ultracontest.com/contests/win-cash-sweepstakes',
    'https://ultracontest.com/contests/win-instantly-sweepstakes',
    'https://ultracontest.com/contests/win-a-vacation-sweepstakes',
    'https://ultracontest.com/contests/win-a-car-sweepstakes',
    'https://ultracontest.com/contests/win-a-house-sweepstakes',
  ];
  const seen = new Set();
  for (const pageUrl of pages) {
    const html = await fetchPage(pageUrl);
    if (!html) { log(`  UC: FAILED ${pageUrl.split('/').pop()}`); continue; }
    // Each contest card has: h5.contest-card-title > a with title, then btn target=_blank with entry link
    // Split by contest-card blocks
    const cardRe = /contest-card-title">\s*<a[^>]*href="[^"]*">\s*([^<]+)<\/a>[\s\S]*?<a[^>]*href="(https?:\/\/(?!ultracontest)[^"]+)"[^>]*class="btn[^"]*"[^>]*target="_blank"[^>]*>\s*enter contest/gi;
    let m, count = 0;
    while ((m = cardRe.exec(html)) !== null) {
      const title = m[1].trim();
      const url = m[2].replace(/&amp;/g, '&');
      if (seen.has(url)) continue;
      if (JUNK_DOMAINS.some(junk => url.toLowerCase().includes(junk))) continue;
      if (title.length < 10) continue;
      seen.add(url);
      count++;
      items.push({
        title: decodeEntities(title),
        link: url,
        source: 'ultracontest', category: 'Sweepstakes',
      });
    }
    log(`  UC ${pageUrl.split('/').pop()}: ${count} direct links`);
  }
  log(`  UC total: ${items.length} items (all direct)`);
  return items;
}

// I Love Giveaways - RSS + article follow for direct links
async function iLoveGiveaways() {
  log('Scraping I Love Giveaways (RSS + article follow)...');
  const items = [];
  const xml = await fetchPage('https://ilovegiveaways.com/feed/');
  if (!xml) { log('  ILG: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'ilovegiveaways', category: 'Sweepstakes',
    });
  }
  log(`  ILG: ${items.length} RSS items, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'ilovegiveaways.com');
    if (d) { item.link = d; direct++; }
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  ILG: ${direct}/${items.length} direct links found`);
  // Only keep items with direct links (no middleman)
  return items.filter(i => i.link !== i.articleUrl).map(({ articleUrl, ...rest }) => rest);
}

// Free Stuff Finder - RSS filtered for free samples only
async function freeStuffFinder() {
  log('Scraping Free Stuff Finder (RSS, free samples only)...');
  const items = [];
  const xml = await fetchPage('https://www.freestufffinder.com/feed/');
  if (!xml) { log('  FSF: FAILED'); return items; }
  const freeKeywords = ['free ', 'free!', 'freebie', 'sample', 'gratis', '$0', 'no cost', 'complimentary'];
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const tl = rss.title.toLowerCase();
    // Only keep items that are actually free
    if (!freeKeywords.some(k => tl.includes(k))) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'freestufffinder', category: 'Freebies',
    });
  }
  log(`  FSF: ${items.length} free items from RSS, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'freestufffinder.com');
    if (d) { item.link = d; direct++; }
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  FSF: ${direct}/${items.length} direct links found`);
  // Only keep items with direct links
  return items.filter(i => i.link !== i.articleUrl).map(({ articleUrl, ...rest }) => rest);
}

async function heyItsFree() {
  log('Scraping HeyItsFree (RSS)...');
  const items = [];
  const xml = await fetchPage('https://www.heyitsfree.net/feed/');
  if (!xml) { log('  HIF: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'heyitsfree', category: 'Freebies',
    });
  }
  log(`  HIF: ${items.length} RSS items, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'heyitsfree.net');
    if (d) { item.link = d; direct++; }
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  HIF: ${direct}/${items.length} direct links found`);
  return items.map(({ articleUrl, ...rest }) => rest);
}

async function onlineSweepstakes() {
  log('Scraping Online-Sweepstakes.com...');
  const items = [];
  const pages = [
    'https://www.online-sweepstakes.com/sweepstakes/',
    'https://www.online-sweepstakes.com/instant-win/',
  ];
  for (const pageUrl of pages) {
    const html = await fetchPage(pageUrl);
    if (!html) { log(`  OS: FAILED ${pageUrl.split('/').pop() || 'main'}`); continue; }
    // Match sweepstakes listing links
    const re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*target="_blank"[^>]*>([^<]{10,})<\/a>/g;
    let m, count = 0;
    const seen = new Set();
    while ((m = re.exec(html)) !== null) {
      const url = m[1];
      if (url.includes('online-sweepstakes.com')) continue;
      if (JUNK_DOMAINS.some(junk => url.toLowerCase().includes(junk))) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      count++;
      items.push({
        title: decodeEntities(m[2].trim()),
        link: url,
        source: 'onlinesweeps', category: 'Sweepstakes',
      });
    }
    log(`  OS ${pageUrl.includes('instant') ? 'instant-win' : 'sweeps'}: ${count} items`);
  }
  return items;
}

async function theFreebieGuy() {
  log('Scraping The Freebie Guy (RSS)...');
  const items = [];
  const xml = await fetchPage('https://thefreebieguy.com/feed/');
  if (!xml) { log('  TFG: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'thefreebieguy', category: 'Freebies',
    });
  }
  log(`  TFG: ${items.length} RSS items, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'thefreebieguy.com');
    if (d) { item.link = d; direct++; }
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  TFG: ${direct}/${items.length} direct links found`);
  return items.map(({ articleUrl, ...rest }) => rest);
}

async function yoFreeSamples() {
  log('Scraping YoFreeSamples (RSS)...');
  const items = [];
  const xml = await fetchPage('https://yofreesamples.com/feed/');
  if (!xml) { log('  YFS: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'yofreesamples', category: 'Freebies',
    });
  }
  log(`  YFS: ${items.length} RSS items, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'yofreesamples.com');
    if (d) { item.link = d; direct++; }
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  YFS: ${direct}/${items.length} direct links found`);
  return items.map(({ articleUrl, ...rest }) => rest);
}

async function giveawayFrenzy() {
  log('Scraping Giveaway Frenzy (RSS)...');
  const items = [];
  const xml = await fetchPage('https://giveawayfrenzy.com/feed/');
  if (!xml) { log('  GF: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title.trim()),
      articleUrl: rss.link.trim(),
      link: rss.link.trim(),
      source: 'giveawayfrenzy', category: 'Sweepstakes',
    });
  }
  log(`  GF: ${items.length} RSS items, following articles...`);
  let direct = 0;
  await resolveInBatches(items, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const d = extractOutboundLink(html, 'giveawayfrenzy.com');
    if (d) { item.link = d; direct++; }
    const img = extractImage(html);
    if (img) item.image = img;
  }, 10);
  log(`  GF: ${direct}/${items.length} direct links found`);
  return items.map(({ articleUrl, ...rest }) => rest);
}

// === IMAGE EXTRACTION ===
function extractImage(html) {
  // Try og:image first (most reliable)
  const og = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (og && og[1].startsWith('http')) return og[1];

  // Try twitter:image
  const tw = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
  if (tw && tw[1].startsWith('http')) return tw[1];

  return null;
}

async function fetchImages(items) {
  log(`Fetching images for ${items.length} items...`);
  let found = 0;
  await resolveInBatches(items, async (item) => {
    if (item.image) return; // already has one
    try {
      const html = await fetchPage(item.link, 8000);
      if (!html) return;
      const img = extractImage(html);
      if (img) { item.image = img; found++; }
    } catch (e) {}
  }, 15);
  log(`  Images found: ${found}/${items.length}`);
}

// === MAIN ===
async function main() {
  const startTime = Date.now();
  log('========================================');
  log('AllFreeAlerts Scraper - Starting');
  log('========================================');

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load existing results for deduplication
  let existing = [];
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
      log(`Loaded ${existing.length} existing entries for dedup`);
    } catch (e) { log('Could not load existing results, starting fresh'); }
  }
  const existingLinks = new Set(existing.map(e => e.link));

  // Scrape all sources in parallel where possible
  const [cg, sf, fs_, ff, h2s, ca, ss, sa, tca, ftc, hif, tfg, yfs, gf, uc, ilg, fsf, cl, gb, sm, oca, cd] = await Promise.all([
    scrapeContestgirl().catch(e => { log(`CG ERROR: ${e.message}`); return []; }),
    sweepstakesFanatics().catch(e => { log(`SF ERROR: ${e.message}`); return []; }),
    freebieshark().catch(e => { log(`FS ERROR: ${e.message}`); return []; }),
    freeflys().catch(e => { log(`FF ERROR: ${e.message}`); return []; }),
    hip2save().catch(e => { log(`H2S ERROR: ${e.message}`); return []; }),
    classactionOrg().catch(e => { log(`CA ERROR: ${e.message}`); return []; }),
    sweetiesSweeps().catch(e => { log(`SS ERROR: ${e.message}`); return []; }),
    sweepsAdvantage().catch(e => { log(`SA ERROR: ${e.message}`); return []; }),
    topClassActions().catch(e => { log(`TCA ERROR: ${e.message}`); return []; }),
    ftcRefunds().catch(e => { log(`FTC ERROR: ${e.message}`); return []; }),
    heyItsFree().catch(e => { log(`HIF ERROR: ${e.message}`); return []; }),
    // onlineSweepstakes — removed: JS-rendered site, can't scrape server-side
    theFreebieGuy().catch(e => { log(`TFG ERROR: ${e.message}`); return []; }),
    yoFreeSamples().catch(e => { log(`YFS ERROR: ${e.message}`); return []; }),
    giveawayFrenzy().catch(e => { log(`GF ERROR: ${e.message}`); return []; }),
    ultraContest().catch(e => { log(`UC ERROR: ${e.message}`); return []; }),
    iLoveGiveaways().catch(e => { log(`ILG ERROR: ${e.message}`); return []; }),
    freeStuffFinder().catch(e => { log(`FSF ERROR: ${e.message}`); return []; }),
    contestListing().catch(e => { log(`CL ERROR: ${e.message}`); return []; }),
    giveawayBase().catch(e => { log(`GB ERROR: ${e.message}`); return []; }),
    settlemate().catch(e => { log(`SM ERROR: ${e.message}`); return []; }),
    openClassActions().catch(e => { log(`OCA ERROR: ${e.message}`); return []; }),
    claimDepot().catch(e => { log(`CD ERROR: ${e.message}`); return []; }),
  ]);

  const allScraped = [...cg, ...sf, ...fs_, ...ff, ...h2s, ...ca, ...ss, ...sa, ...tca, ...ftc, ...hif, ...tfg, ...yfs, ...gf, ...uc, ...ilg, ...fsf, ...cl, ...gb, ...sm, ...oca, ...cd];

  // Clean + Deduplicate
  const BAD_LINK_DOMAINS = ['facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com/', 'youtube.com', 'x.com/'];
  const newItems = [];
  const seenLinks = new Set();
  const seenTitles = new Set();
  // Also build title set from existing items for cross-source dedup
  for (const e of existing) {
    if (e.title) seenTitles.add(e.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
  }
  for (const item of allScraped) {
    if (!item.link || !item.title) continue;
    if (item.title.length < 10) continue; // skip broken short titles
    const link = item.link.trim();
    if (!link.startsWith('http')) continue;
    if (BAD_LINK_DOMAINS.some(d => link.includes(d))) continue; // skip social media links
    if (existingLinks.has(link)) continue;
    if (seenLinks.has(link)) continue;
    // Title-based dedup: catch same contest from different sources
    const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenTitles.has(normTitle)) continue;
    seenLinks.add(link);
    seenTitles.add(normTitle);
    item.date_found = new Date().toISOString().split('T')[0];
    newItems.push(item);
  }

  // Fetch images for new items
  await fetchImages(newItems);

  // Count by source
  const counts = {};
  for (const item of allScraped) {
    counts[item.source] = (counts[item.source] || 0) + 1;
  }
  const newCounts = {};
  for (const item of newItems) {
    newCounts[item.source] = (newCounts[item.source] || 0) + 1;
  }

  // Count direct vs middleman links
  let directCount = 0, middlemanCount = 0;
  const middlemanDomains = ['contestgirl.com/sweepstakes/countHits', 'sweepstakesfanatics.com', 'freebieshark.com', 'freeflys.com', 'hip2save.com', 'topclassactions.com', 'settlemate.io'];
  for (const item of newItems) {
    if (middlemanDomains.some(d => item.link.includes(d))) middlemanCount++;
    else directCount++;
  }

  log('');
  log('========================================');
  log('RESULTS SUMMARY');
  log('========================================');
  log(`Total scraped: ${allScraped.length}`);
  log(`New items: ${newItems.length} (${existing.length} already known)`);
  log(`Direct links: ${directCount} | Middleman: ${middlemanCount}`);
  log('');
  log('By source (total / new):');
  for (const src of Object.keys(counts).sort()) {
    log(`  ${src}: ${counts[src]} total / ${newCounts[src] || 0} new`);
  }

  // Merge with existing and save
  const allResults = [...existing, ...newItems];
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(allResults, null, 2));
  log(`\nSaved ${allResults.length} total entries to ${RESULTS_FILE}`);

  // Save CSV
  const csvHeaders = ['title', 'link', 'source', 'category', 'date_found', 'end_date', 'deadline', 'payout', 'proof_required', 'prize_summary', 'eligibility', 'description', 'image'];
  const csvRows = [csvHeaders.join(',')];
  for (const item of allResults) {
    csvRows.push(csvHeaders.map(h => escapeCsv(item[h] || '')).join(','));
  }
  fs.writeFileSync(CSV_FILE, csvRows.join('\n'), 'utf8');
  log(`Saved CSV to ${CSV_FILE}`);

  // Copy data to site folder for the website (strip source + encode for anti-scraping)
  const SITE_DATA = path.join(__dirname, 'site', 'data.json');
  try {
    const publicData = allResults.map(({ source, ...rest }) => rest);
    const jsonStr = JSON.stringify(publicData);
    // XOR encode with rotating key to prevent plain-text scraping
    const key = 'aFa2026xK';
    const encoded = Buffer.from(jsonStr).map((b, i) => b ^ key.charCodeAt(i % key.length));
    fs.writeFileSync(SITE_DATA, encoded.toString('base64'), 'utf8');
    log(`Wrote ${publicData.length} items to site folder (encoded, source stripped)`);
  } catch (e) { log(`Could not write to site: ${e.message}`); }

  // Send Telegram summary
  if (newItems.length > 0) {
    const catCounts = {};
    for (const item of newItems) {
      catCounts[item.category] = (catCounts[item.category] || 0) + 1;
    }

    let msg = `<b>AllFreeAlerts Daily Scan</b>\n`;
    msg += `Found <b>${newItems.length}</b> new items!\n\n`;

    for (const [cat, count] of Object.entries(catCounts)) {
      const emoji = cat === 'Sweepstakes' ? '🎰' : cat === 'Freebies' ? '🎁' : '⚖️';
      msg += `${emoji} <b>${cat}:</b> ${count}\n`;
    }
    msg += `\n📊 Direct links: ${directCount} | Middleman: ${middlemanCount}`;
    msg += `\n\n<b>Sources:</b>\n`;
    for (const src of Object.keys(newCounts).sort()) {
      msg += `• ${src}: ${newCounts[src]}\n`;
    }

    // Show a few highlights
    const settlements = newItems.filter(i => i.category === 'Settlements' && i.payout).slice(0, 3);
    if (settlements.length > 0) {
      msg += `\n<b>Top Settlements:</b>\n`;
      for (const s of settlements) {
        msg += `• ${s.title} — ${s.payout}`;
        if (s.deadline) msg += ` (deadline: ${s.deadline})`;
        msg += `\n`;
      }
    }

    const sweeps = newItems.filter(i => i.category === 'Sweepstakes' && i.prize_summary).slice(0, 3);
    if (sweeps.length > 0) {
      msg += `\n<b>Top Sweepstakes:</b>\n`;
      for (const s of sweeps) {
        msg += `• ${s.title} — ${s.prize_summary}\n`;
      }
    }

    // Telegram messages have a 4096 char limit
    if (msg.length > 4000) msg = msg.substring(0, 4000) + '...';
    await sendTelegram(msg);
  } else {
    log('No new items, skipping Telegram');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\nDone in ${elapsed}s`);
  process.exit(0);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
