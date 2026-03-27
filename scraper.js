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

    items.push({
      title: decodeEntities(linkMatch[2].trim()),
      link: linkMatch[1],
      source: 'classaction', category: 'Settlements',
      deadline: deadlineDate,
      payout: payoutMatch ? payoutMatch[1].trim() : '',
      proof_required: proofMatch ? proofMatch[1].trim() : '',
      description: descMatch ? decodeEntities(descMatch[1].trim()) : '',
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

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const titleLower = rss.title.toLowerCase();
    if (titleLower.includes('settlement') || titleLower.includes('class action') ||
        titleLower.includes('refund') || titleLower.includes('claim')) {
      items.push({
        title: decodeEntities(rss.title.trim()),
        link: rss.link.trim(),
        source: 'topclassactions', category: 'Settlements',
      });
    }
  }
  log(`  TCA: ${items.length} settlement articles`);
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
    });
  }
  log(`  FTC: ${items.length} refund cases`);
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
    // Find "enter contest" links - these are direct external links
    const re = /href="(https?:\/\/[^"]+)"[^>]*>\s*enter contest/gi;
    let m, count = 0;
    while ((m = re.exec(html)) !== null) {
      const url = m[1].replace(/&amp;/g, '&');
      if (seen.has(url)) continue;
      if (JUNK_DOMAINS.some(junk => url.toLowerCase().includes(junk))) continue;
      seen.add(url);
      count++;
      // Try to find a title near this link (look backwards in HTML for heading text)
      const before = html.substring(Math.max(0, m.index - 500), m.index);
      const titleMatch = before.match(/<(?:h[234]|strong|b)[^>]*>([^<]{10,})<\/(?:h[234]|strong|b)>/g);
      const title = titleMatch ? titleMatch[titleMatch.length-1].replace(/<[^>]+>/g, '').trim() : '';
      items.push({
        title: title.length >= 10 ? decodeEntities(title) : 'Sweepstakes Entry',
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
  const [cg, sf, fs_, ff, h2s, ca, ss, sa, tca, ftc, hif, os, tfg, yfs, gf, uc, ilg, fsf] = await Promise.all([
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
    onlineSweepstakes().catch(e => { log(`OS ERROR: ${e.message}`); return []; }),
    theFreebieGuy().catch(e => { log(`TFG ERROR: ${e.message}`); return []; }),
    yoFreeSamples().catch(e => { log(`YFS ERROR: ${e.message}`); return []; }),
    giveawayFrenzy().catch(e => { log(`GF ERROR: ${e.message}`); return []; }),
    ultraContest().catch(e => { log(`UC ERROR: ${e.message}`); return []; }),
    iLoveGiveaways().catch(e => { log(`ILG ERROR: ${e.message}`); return []; }),
    freeStuffFinder().catch(e => { log(`FSF ERROR: ${e.message}`); return []; }),
  ]);

  const allScraped = [...cg, ...sf, ...fs_, ...ff, ...h2s, ...ca, ...ss, ...sa, ...tca, ...ftc, ...hif, ...os, ...tfg, ...yfs, ...gf, ...uc, ...ilg, ...fsf];

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
  const middlemanDomains = ['contestgirl.com/sweepstakes/countHits', 'sweepstakesfanatics.com', 'freebieshark.com', 'freeflys.com', 'hip2save.com', 'topclassactions.com'];
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

  // Copy data to site folder for the website
  const SITE_DATA = path.join(__dirname, 'site', 'data.json');
  try {
    fs.copyFileSync(RESULTS_FILE, SITE_DATA);
    log(`Copied data to site folder`);
  } catch (e) { log(`Could not copy to site: ${e.message}`); }

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
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
