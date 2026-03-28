#!/usr/bin/env node
// LTD Deals Scraper - Aggregates SaaS lifetime deals and software discounts
// Run: node sites/ltd-deals/scraper.js
// Sources: AppSumo, PitchGround, StackSocial, Dealify, DealMirror, SaaSMantra, RocketHub, SaaS Pirate, Product Hunt, NachoNacho, Starter Story, Reddit r/SaaS, Reddit r/AppSumo

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const BASE_DIR = path.join(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const SITE_DIR = path.join(BASE_DIR, 'site');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const SITE_DATA_FILE = path.join(SITE_DIR, 'data.json');
const LOG_FILE = path.join(DATA_DIR, 'scraper.log');
const TODAY = new Date().toISOString().slice(0, 10);

// Ensure directories exist
[DATA_DIR, SITE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// === UTILITIES ===
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/&nbsp;/g, ' ')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .trim();
}

function stripTags(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').trim();
}

function fetchPage(url, timeout = 20000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Host': parsed.hostname,
        'Connection': 'keep-alive',
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
        if (d.includes('Just a moment') && d.includes('challenge-platform')) {
          log(`  Cloudflare block detected for ${parsed.hostname}`);
          resolve(null);
        } else if (res.statusCode >= 400) {
          log(`  HTTP ${res.statusCode} for ${url}`);
          resolve(null);
        } else {
          resolve(d);
        }
      });
    });
    req.on('error', (e) => { log(`  Fetch error ${parsed.hostname}: ${e.message}`); resolve(null); });
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

function fetchJSON(url, timeout = 20000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Host': parsed.hostname,
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

function guessCategory(title, description) {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/\bai\b|artificial intelligence|machine learning|chatbot|gpt|llm/.test(text)) return 'AI';
  if (/marketing|seo|email marketing|social media|ads|crm|lead/.test(text)) return 'Marketing';
  if (/design|graphic|photo|video|image|ui\/ux|canva|edit/.test(text)) return 'Design';
  if (/develop|code|api|hosting|deploy|devops|database|git|programming|ide/.test(text)) return 'Development';
  if (/project management|productivity|automation|workflow|task|note|calendar/.test(text)) return 'Productivity';
  if (/business|finance|accounting|invoice|hr|erp|analytics/.test(text)) return 'Business';
  return 'Other';
}

function cleanPrice(priceStr) {
  if (!priceStr) return '';
  const match = priceStr.match(/\$[\d,.]+/);
  return match ? match[0] : priceStr.replace(/[^\d.$,]/g, '').trim();
}

function calcDiscount(price, originalPrice) {
  if (!price || !originalPrice) return '';
  const p = parseFloat(price.replace(/[$,]/g, ''));
  const o = parseFloat(originalPrice.replace(/[$,]/g, ''));
  if (!p || !o || o <= p) return '';
  return Math.round(((o - p) / o) * 100) + '%';
}

// === SCRAPERS ===

// 1. AppSumo - Try their API endpoint first, fall back to HTML scraping
async function scrapeAppSumo() {
  log('Scraping AppSumo...');
  const items = [];

  // AppSumo has a public API for browsing products
  const apiUrl = 'https://appsumo.com/api/v2/products/?ordering=-start_date&page_size=40&taxon_slug=deals';
  const data = await fetchJSON(apiUrl);

  if (data && data.results && Array.isArray(data.results)) {
    for (const product of data.results) {
      const title = product.public_name || product.name || '';
      const description = product.tagline || product.short_description || '';
      const price = product.plans && product.plans[0] ? '$' + product.plans[0].price : (product.starting_price ? '$' + product.starting_price : '');
      const originalPrice = product.plans && product.plans[0] && product.plans[0].original_price ? '$' + product.plans[0].original_price : '';
      const slug = product.slug || '';
      const link = slug ? `https://appsumo.com/products/${slug}/` : '';
      const image = product.icon_url || product.featured_image_url || product.image_url || '';

      if (!title || !link) continue;
      items.push({
        title: decodeEntities(title),
        description: decodeEntities(stripTags(description)).slice(0, 200),
        price: cleanPrice(price),
        original_price: cleanPrice(originalPrice),
        discount: calcDiscount(price, originalPrice),
        category: guessCategory(title, description),
        link,
        image,
        source: 'appsumo',
        date_found: TODAY,
        expires: '',
      });
    }
    log(`  AppSumo API: ${items.length} deals`);
    if (items.length > 0) return items;
  }

  // Fallback: scrape the HTML browse page
  log('  AppSumo API failed or empty, trying HTML...');
  const html = await fetchPage('https://appsumo.com/browse/?orderBy=most-recent');
  if (!html) { log('  AppSumo HTML: FAILED'); return items; }

  // Look for Next.js __NEXT_DATA__ or inline JSON data
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const products = nextData?.props?.pageProps?.products || nextData?.props?.pageProps?.initialProducts || [];
      for (const p of products) {
        const title = p.public_name || p.name || '';
        const link = p.slug ? `https://appsumo.com/products/${p.slug}/` : '';
        if (!title || !link) continue;
        items.push({
          title: decodeEntities(title),
          description: decodeEntities(stripTags(p.tagline || p.short_description || '')).slice(0, 200),
          price: cleanPrice(p.starting_price ? '$' + p.starting_price : ''),
          original_price: '',
          discount: '',
          category: guessCategory(title, p.tagline || ''),
          link,
          image: p.icon_url || p.featured_image_url || '',
          source: 'appsumo',
          date_found: TODAY,
          expires: '',
        });
      }
      log(`  AppSumo NEXT_DATA: ${items.length} deals`);
      if (items.length > 0) return items;
    } catch (e) { /* continue to regex fallback */ }
  }

  // Regex fallback for product cards
  const cardRegex = /<a[^>]*href="(\/products\/[^"]+\/?)"[^>]*>[\s\S]*?<(?:h[23]|div)[^>]*class="[^"]*(?:product-name|card-title|product__name)[^"]*"[^>]*>([^<]+)<\/(?:h[23]|div)>/g;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    const link = 'https://appsumo.com' + m[1];
    const title = decodeEntities(m[2]);
    if (!title) continue;
    items.push({
      title,
      description: '',
      price: '',
      original_price: '',
      discount: '',
      category: guessCategory(title, ''),
      link,
      image: '',
      source: 'appsumo',
      date_found: TODAY,
      expires: '',
    });
  }

  // Also try broader pattern for any links to /products/
  if (items.length === 0) {
    const linkRegex = /href="(\/products\/([a-z0-9-]+)\/?)"[^>]*>/g;
    const seen = new Set();
    while ((m = linkRegex.exec(html)) !== null) {
      const slug = m[2];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      items.push({
        title,
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: guessCategory(title, ''),
        link: 'https://appsumo.com' + m[1],
        image: '',
        source: 'appsumo',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  log(`  AppSumo HTML: ${items.length} deals`);
  return items;
}

// 2. PitchGround
async function scrapePitchGround() {
  log('Scraping PitchGround...');
  const items = [];

  // Try multiple URLs - PitchGround may have changed their structure
  let html = await fetchPage('https://pitchground.com/deals/');
  if (!html) html = await fetchPage('https://pitchground.com/marketplace/');
  if (!html) html = await fetchPage('https://pitchground.com/');
  if (!html) { log('  PitchGround: FAILED'); return items; }

  // Look for JSON-LD or embedded data
  const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonLdMatches) {
    try {
      const content = block.replace(/<\/?script[^>]*>/g, '');
      const data = JSON.parse(content);
      if (data['@type'] === 'ItemList' && data.itemListElement) {
        for (const el of data.itemListElement) {
          const item = el.item || el;
          items.push({
            title: decodeEntities(item.name || ''),
            description: decodeEntities(stripTags(item.description || '')).slice(0, 200),
            price: item.offers?.price ? '$' + item.offers.price : '',
            original_price: '',
            discount: '',
            category: guessCategory(item.name || '', item.description || ''),
            link: item.url || '',
            image: item.image || '',
            source: 'pitchground',
            date_found: TODAY,
            expires: '',
          });
        }
      }
    } catch (e) { /* skip invalid JSON-LD */ }
  }

  if (items.length > 0) {
    log(`  PitchGround JSON-LD: ${items.length} deals`);
    return items;
  }

  // Try to find product cards in HTML
  // Pattern: product card with image, title, price, link
  const cardRegex = /<div[^>]*class="[^"]*(?:deal-card|product-card|deals-item)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let cardMatch;
  while ((cardMatch = cardRegex.exec(html)) !== null) {
    const card = cardMatch[1];
    const titleM = card.match(/<(?:h[234]|a)[^>]*>([^<]{3,80})<\/(?:h[234]|a)>/);
    const linkM = card.match(/href="(https?:\/\/pitchground\.com\/[^"]+)"/);
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const priceM = card.match(/\$\d[\d,.]*/) ;
    if (titleM) {
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: priceM ? cleanPrice(priceM[0]) : '',
        original_price: '',
        discount: '',
        category: guessCategory(titleM[1], ''),
        link: linkM ? linkM[1] : '',
        image: imgM ? imgM[1] : '',
        source: 'pitchground',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Broader fallback: find deal links (try multiple URL patterns)
  if (items.length === 0) {
    const dealLinkRegex = /href="(https?:\/\/pitchground\.com\/(?:deals?|marketplace|products?)\/([a-z0-9-]+)\/?)"[^>]*>/gi;
    const seen = new Set();
    let lm;
    while ((lm = dealLinkRegex.exec(html)) !== null) {
      const slug = lm[2];
      if (seen.has(slug) || slug === '' || slug === 'deals' || slug === 'marketplace') continue;
      seen.add(slug);
      items.push({
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: 'Other',
        link: lm[1],
        image: '',
        source: 'pitchground',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Also try generic link+title pair extraction
  if (items.length === 0) {
    const anchorRegex = /<a[^>]*href="(https?:\/\/pitchground\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const seen = new Set();
    let am;
    while ((am = anchorRegex.exec(html)) !== null) {
      const link = am[1];
      const text = stripTags(am[2]).trim();
      if (!text || text.length < 3 || text.length > 100 || seen.has(link)) continue;
      if (/\.(css|js|png|jpg|svg|ico)/.test(link)) continue;
      if (/deals\/?$|marketplace\/?$|login|signup|register|cart|checkout|about|contact|blog|faq|terms|privacy/i.test(link)) continue;
      seen.add(link);
      items.push({
        title: decodeEntities(text),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: guessCategory(text, ''),
        link,
        image: '',
        source: 'pitchground',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  log(`  PitchGround: ${items.length} deals`);
  return items;
}

// 3. StackSocial
async function scrapeStackSocial() {
  log('Scraping StackSocial...');
  const items = [];

  const html = await fetchPage('https://stacksocial.com/collections/apps-software');
  if (!html) { log('  StackSocial: FAILED'); return items; }

  // StackSocial often has product data in script tags or structured HTML
  // Look for JSON data in script
  const scriptDataMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/) ||
                           html.match(/window\.products\s*=\s*(\[[\s\S]*?\]);?\s*<\/script>/);
  if (scriptDataMatch) {
    try {
      const data = JSON.parse(scriptDataMatch[1]);
      const products = data.products || data.collection?.products || data;
      if (Array.isArray(products)) {
        for (const p of products) {
          items.push({
            title: decodeEntities(p.title || p.name || ''),
            description: decodeEntities(stripTags(p.description || p.short_description || '')).slice(0, 200),
            price: p.price ? cleanPrice('$' + (p.price / 100 || p.price)) : '',
            original_price: p.compare_at_price ? cleanPrice('$' + (p.compare_at_price / 100 || p.compare_at_price)) : '',
            discount: '',
            category: guessCategory(p.title || '', p.description || ''),
            link: p.url ? (p.url.startsWith('http') ? p.url : 'https://stacksocial.com' + p.url) : '',
            image: p.image || p.featured_image || '',
            source: 'stacksocial',
            date_found: TODAY,
            expires: '',
          });
        }
      }
    } catch (e) { /* continue to HTML parsing */ }
  }

  if (items.length > 0) {
    items.forEach(i => { if (i.price && i.original_price) i.discount = calcDiscount(i.price, i.original_price); });
    log(`  StackSocial JSON: ${items.length} deals`);
    return items;
  }

  // HTML parsing - StackSocial uses a grid of product cards
  // Try Shopify-style product JSON
  const shopifyMatch = html.match(/var meta = ({[\s\S]*?});/) || html.match(/"products":\s*(\[[\s\S]*?\])\s*[,}]/);
  if (shopifyMatch) {
    try {
      const data = JSON.parse(shopifyMatch[1]);
      const products = Array.isArray(data) ? data : data.products || [];
      for (const p of products) {
        const price = p.price ? '$' + (Number(p.price) / 100).toFixed(2) : '';
        const origPrice = p.compare_at_price ? '$' + (Number(p.compare_at_price) / 100).toFixed(2) : '';
        items.push({
          title: decodeEntities(p.title || ''),
          description: '',
          price: cleanPrice(price),
          original_price: cleanPrice(origPrice),
          discount: calcDiscount(price, origPrice),
          category: guessCategory(p.title || '', ''),
          link: p.url ? 'https://stacksocial.com' + p.url : '',
          image: p.featured_image || '',
          source: 'stacksocial',
          date_found: TODAY,
          expires: '',
        });
      }
    } catch (e) { /* continue */ }
  }

  if (items.length > 0) {
    log(`  StackSocial Shopify: ${items.length} deals`);
    return items;
  }

  // Regex fallback for product cards
  const productRegex = /<div[^>]*class="[^"]*product-card[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*product-card|$)/g;
  let pm;
  while ((pm = productRegex.exec(html)) !== null) {
    const card = pm[1];
    const titleM = card.match(/<(?:h[234]|a|span)[^>]*class="[^"]*(?:product-title|product-name|card-title)[^"]*"[^>]*>([^<]+)/);
    const linkM = card.match(/href="(\/[^"]*deal[^"]*|\/[^"]*product[^"]*)"/) || card.match(/href="(\/[a-z0-9-]+)"/);
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const priceM = card.match(/class="[^"]*(?:sale-price|deal-price|price)[^"]*"[^>]*>\s*\$?([\d,.]+)/);
    const origM = card.match(/class="[^"]*(?:original-price|compare-price|retail)[^"]*"[^>]*>\s*\$?([\d,.]+)/);
    const discountM = card.match(/(\d+)%\s*off/i);

    if (titleM) {
      const price = priceM ? '$' + priceM[1] : '';
      const origPrice = origM ? '$' + origM[1] : '';
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: cleanPrice(price),
        original_price: cleanPrice(origPrice),
        discount: discountM ? discountM[1] + '%' : calcDiscount(price, origPrice),
        category: guessCategory(titleM[1], ''),
        link: linkM ? 'https://stacksocial.com' + linkM[1] : '',
        image: imgM ? imgM[1] : '',
        source: 'stacksocial',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Broader link-based fallback
  if (items.length === 0) {
    const linkRegex = /href="(\/sales\/([a-z0-9-]+))"[^>]*>/g;
    const seen = new Set();
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) {
      const slug = lm[2];
      if (seen.has(slug)) continue;
      seen.add(slug);
      items.push({
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: guessCategory(slug, ''),
        link: 'https://stacksocial.com' + lm[1],
        image: '',
        source: 'stacksocial',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  log(`  StackSocial: ${items.length} deals`);
  return items;
}

// 4. Dealify
async function scrapeDealify() {
  log('Scraping Dealify...');
  const items = [];

  // Try multiple URL patterns
  let html = await fetchPage('https://dealify.com/deals/');
  if (!html) html = await fetchPage('https://dealify.com/lifetime-deals/');
  if (!html) html = await fetchPage('https://dealify.com/shop/');
  if (!html) html = await fetchPage('https://dealify.com/');
  if (!html) { log('  Dealify: FAILED'); return items; }

  // Dealify is WordPress/WooCommerce - look for product data
  // Try WooCommerce REST-like JSON in page
  const wooMatch = html.match(/var wc_products\s*=\s*(\[[\s\S]*?\]);/);
  if (wooMatch) {
    try {
      const products = JSON.parse(wooMatch[1]);
      for (const p of products) {
        items.push({
          title: decodeEntities(p.name || p.title || ''),
          description: decodeEntities(stripTags(p.short_description || p.description || '')).slice(0, 200),
          price: p.price ? '$' + p.price : '',
          original_price: p.regular_price ? '$' + p.regular_price : '',
          discount: '',
          category: guessCategory(p.name || '', p.short_description || ''),
          link: p.permalink || '',
          image: p.image || '',
          source: 'dealify',
          date_found: TODAY,
          expires: '',
        });
      }
    } catch (e) { /* continue */ }
  }

  if (items.length > 0) {
    items.forEach(i => { if (i.price && i.original_price) i.discount = calcDiscount(i.price, i.original_price); });
    log(`  Dealify WC: ${items.length} deals`);
    return items;
  }

  // HTML product card extraction
  // Dealify uses product listing grids; try various WooCommerce patterns
  const productBlockRegex = /<(?:li|div|article)[^>]*class="[^"]*(?:product|deal|post)[^"]*"[^>]*>([\s\S]*?)(?=<(?:li|div|article)[^>]*class="[^"]*(?:product|deal|post)[^"]*"|<\/(?:ul|section|main)>)/g;
  let bm;
  while ((bm = productBlockRegex.exec(html)) !== null) {
    const block = bm[1];
    const titleM = block.match(/<(?:h[234])[^>]*>\s*(?:<a[^>]*>)?\s*([^<]{3,100})\s*(?:<\/a>)?\s*<\/h[234]>/);
    const linkM = block.match(/href="(https?:\/\/dealify\.com\/[^"]+)"/);
    const imgM = block.match(/<img[^>]*src="([^"]+)"/);
    const priceM = block.match(/class="[^"]*(?:price|amount)[^"]*"[^>]*>[^<]*?\$?([\d,.]+)/);
    const origM = block.match(/<del[^>]*>[^<]*?\$?([\d,.]+)/);
    const catM = block.match(/class="[^"]*(?:category|tag)[^"]*"[^>]*>([^<]+)/);

    if (titleM) {
      const price = priceM ? '$' + priceM[1] : '';
      const origPrice = origM ? '$' + origM[1] : '';
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: cleanPrice(price),
        original_price: cleanPrice(origPrice),
        discount: calcDiscount(price, origPrice),
        category: catM ? catM[1].trim() : guessCategory(titleM[1], ''),
        link: linkM ? linkM[1] : '',
        image: imgM ? imgM[1] : '',
        source: 'dealify',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Broader fallback
  if (items.length === 0) {
    const linkRegex = /href="(https?:\/\/dealify\.com\/deals?\/([a-z0-9-]+)\/?)"[^>]*>/g;
    const seen = new Set();
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) {
      const slug = lm[2];
      if (seen.has(slug) || slug === 'deals' || slug === '' || slug.length < 3) continue;
      seen.add(slug);
      items.push({
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: 'Other',
        link: lm[1],
        image: '',
        source: 'dealify',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Also try WooCommerce price patterns: <span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>59</bdi></span>
  if (items.length === 0) {
    // Try a more generic approach: find all deal links with surrounding context
    const anchorRegex = /<a[^>]*href="(https?:\/\/dealify\.com\/deal[s]?\/[a-z0-9-]+\/?)"[^>]*>([\s\S]*?)<\/a>/g;
    const seen = new Set();
    let am;
    while ((am = anchorRegex.exec(html)) !== null) {
      const link = am[1];
      const text = stripTags(am[2]).trim();
      if (seen.has(link) || !text || text.length < 3 || text.length > 100) continue;
      seen.add(link);
      items.push({
        title: decodeEntities(text),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: guessCategory(text, ''),
        link,
        image: '',
        source: 'dealify',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  log(`  Dealify: ${items.length} deals`);
  return items;
}

// 5. DealMirror
async function scrapeDealMirror() {
  log('Scraping DealMirror...');
  const items = [];

  const html = await fetchPage('https://dealmirror.com/product-category/lifetime-deals/');
  if (!html) { log('  DealMirror: FAILED'); return items; }

  // DealMirror is WooCommerce-based
  // Try to find product blocks
  const productRegex = /<li[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let pm;
  while ((pm = productRegex.exec(html)) !== null) {
    const block = pm[1];
    const titleM = block.match(/<(?:h[234])[^>]*class="[^"]*(?:product-title|entry-title|woocommerce-loop-product__title)[^"]*"[^>]*>([^<]+)<\/h[234]>/) ||
                   block.match(/<(?:h[234])[^>]*>\s*([^<]{3,100})\s*<\/h[234]>/);
    const linkM = block.match(/href="(https?:\/\/dealmirror\.com\/[^"]+)"/);
    const imgM = block.match(/<img[^>]*src="([^"]+)"/) || block.match(/data-src="([^"]+)"/);
    // WooCommerce price patterns
    const insertionMatch = block.match(/<ins[^>]*>[\s\S]*?\$\s*([\d,.]+)[\s\S]*?<\/ins>/);
    const deletionMatch = block.match(/<del[^>]*>[\s\S]*?\$\s*([\d,.]+)[\s\S]*?<\/del>/);
    const singlePriceM = block.match(/class="[^"]*amount[^"]*"[^>]*>\s*\$?\s*([\d,.]+)/);

    const price = insertionMatch ? '$' + insertionMatch[1].trim() : (singlePriceM ? '$' + singlePriceM[1].trim() : '');
    const origPrice = deletionMatch ? '$' + deletionMatch[1].trim() : '';

    if (titleM) {
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: cleanPrice(price),
        original_price: cleanPrice(origPrice),
        discount: calcDiscount(price, origPrice),
        category: guessCategory(titleM[1], ''),
        link: linkM ? linkM[1] : '',
        image: imgM ? imgM[1] : '',
        source: 'dealmirror',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Broader fallback with generic product pattern
  if (items.length === 0) {
    const titleLinkRegex = /<a[^>]*href="(https?:\/\/dealmirror\.com\/product\/([a-z0-9-]+)\/?)"[^>]*>([\s\S]*?)<\/a>/g;
    const seen = new Set();
    let lm;
    while ((lm = titleLinkRegex.exec(html)) !== null) {
      const slug = lm[2];
      const text = stripTags(lm[3]).trim();
      if (seen.has(slug) || !slug || slug.length < 3) continue;
      seen.add(slug);
      const title = text && text.length > 2 && text.length < 100 ? text : slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      items.push({
        title: decodeEntities(title),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: guessCategory(title, ''),
        link: lm[1],
        image: '',
        source: 'dealmirror',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Try paginated results (page 2)
  if (items.length > 0) {
    const html2 = await fetchPage('https://dealmirror.com/product-category/lifetime-deals/page/2/');
    if (html2) {
      const productRegex2 = /<li[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
      let pm2;
      const existingTitles = new Set(items.map(i => i.title.toLowerCase()));
      while ((pm2 = productRegex2.exec(html2)) !== null) {
        const block = pm2[1];
        const titleM = block.match(/<(?:h[234])[^>]*>([^<]{3,100})<\/h[234]>/);
        const linkM = block.match(/href="(https?:\/\/dealmirror\.com\/[^"]+)"/);
        const imgM = block.match(/<img[^>]*src="([^"]+)"/);
        const insertionMatch = block.match(/<ins[^>]*>[\s\S]*?\$\s*([\d,.]+)[\s\S]*?<\/ins>/);
        const deletionMatch = block.match(/<del[^>]*>[\s\S]*?\$\s*([\d,.]+)[\s\S]*?<\/del>/);
        const singlePriceM = block.match(/class="[^"]*amount[^"]*"[^>]*>\s*\$?\s*([\d,.]+)/);
        const price = insertionMatch ? '$' + insertionMatch[1].trim() : (singlePriceM ? '$' + singlePriceM[1].trim() : '');
        const origPrice = deletionMatch ? '$' + deletionMatch[1].trim() : '';
        if (titleM && !existingTitles.has(decodeEntities(titleM[1]).toLowerCase())) {
          items.push({
            title: decodeEntities(titleM[1]),
            description: '',
            price: cleanPrice(price),
            original_price: cleanPrice(origPrice),
            discount: calcDiscount(price, origPrice),
            category: guessCategory(titleM[1], ''),
            link: linkM ? linkM[1] : '',
            image: imgM ? imgM[1] : '',
            source: 'dealmirror',
            date_found: TODAY,
            expires: '',
          });
        }
      }
    }
  }

  log(`  DealMirror: ${items.length} deals`);
  return items;
}

// 6. SaaSMantra
async function scrapeSaaSMantra() {
  log('Scraping SaaSMantra...');
  const items = [];

  const html = await fetchPage('https://www.saasmantra.com/deals/');
  if (!html) { log('  SaaSMantra: FAILED'); return items; }

  // Try JSON-LD
  const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonLdMatches) {
    try {
      const content = block.replace(/<\/?script[^>]*>/g, '');
      const data = JSON.parse(content);
      if (data['@type'] === 'ItemList' && data.itemListElement) {
        for (const el of data.itemListElement) {
          const item = el.item || el;
          if (!item.name) continue;
          items.push({
            title: decodeEntities(item.name),
            description: decodeEntities(stripTags(item.description || '')).slice(0, 200),
            price: item.offers?.price ? '$' + item.offers.price : '',
            original_price: '',
            discount: '',
            category: guessCategory(item.name, item.description || ''),
            link: item.url || '',
            image: item.image || '',
            source: 'saasmantra',
            date_found: TODAY,
            expires: '',
          });
        }
      }
    } catch (e) { /* skip */ }
  }

  if (items.length > 0) {
    log(`  SaaSMantra JSON-LD: ${items.length} deals`);
    return items;
  }

  // HTML card extraction - try common patterns
  const cardRegex = /<div[^>]*class="[^"]*(?:deal|product|card|entry|post)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:deal|product|card|entry|post)[^"]*"|<\/(?:section|main|div class="row))/g;
  let cm;
  while ((cm = cardRegex.exec(html)) !== null) {
    const card = cm[1];
    const titleM = card.match(/<(?:h[234])[^>]*>\s*(?:<a[^>]*>)?\s*([^<]{3,100})\s*(?:<\/a>)?\s*<\/h[234]>/);
    const linkM = card.match(/href="(https?:\/\/(?:www\.)?saasmantra\.com\/[^"]+)"/);
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const priceM = card.match(/\$\s*([\d,.]+)/);
    if (titleM) {
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: priceM ? '$' + priceM[1] : '',
        original_price: '',
        discount: '',
        category: guessCategory(titleM[1], ''),
        link: linkM ? linkM[1] : '',
        image: imgM ? imgM[1] : '',
        source: 'saasmantra',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Broader link fallback
  if (items.length === 0) {
    const linkRegex = /href="(https?:\/\/(?:www\.)?saasmantra\.com\/(?:deals?|product)\/([a-z0-9-]+)\/?)"[^>]*>/gi;
    const seen = new Set();
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) {
      const slug = lm[2];
      if (seen.has(slug) || !slug || slug.length < 3 || slug === 'deals') continue;
      seen.add(slug);
      items.push({
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: 'Other',
        link: lm[1],
        image: '',
        source: 'saasmantra',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  log(`  SaaSMantra: ${items.length} deals`);
  return items;
}

// 7. RocketHub
async function scrapeRocketHub() {
  log('Scraping RocketHub...');
  const items = [];

  // Try multiple URLs
  const urls = [
    'https://www.rockethub.com/deals',
    'https://www.rockethub.com/deals/lifetime',
  ];

  for (const url of urls) {
    const html = await fetchPage(url);
    if (!html) continue;

    // Card-based extraction
    const cardRegex = /<div[^>]*class="[^"]*(?:deal|product|card|item)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:deal|product|card|item)[^"]*"|<\/(?:section|main)>)/g;
    let cm;
    while ((cm = cardRegex.exec(html)) !== null) {
      const card = cm[1];
      const titleM = card.match(/<(?:h[234])[^>]*>\s*(?:<a[^>]*>)?\s*([^<]{3,100})\s*(?:<\/a>)?\s*<\/h[234]>/);
      const linkM = card.match(/href="(https?:\/\/(?:www\.)?rockethub\.com\/[^"]+)"/);
      const imgM = card.match(/<img[^>]*src="([^"]+)"/);
      const priceM = card.match(/\$\s*([\d,.]+)/);
      if (titleM) {
        items.push({
          title: decodeEntities(titleM[1]),
          description: '',
          price: priceM ? '$' + priceM[1] : '',
          original_price: '',
          discount: '',
          category: guessCategory(titleM[1], ''),
          link: linkM ? linkM[1] : '',
          image: imgM ? imgM[1] : '',
          source: 'rockethub',
          date_found: TODAY,
          expires: '',
        });
      }
    }

    // Link-based fallback
    if (items.length === 0) {
      const linkRegex = /href="(https?:\/\/(?:www\.)?rockethub\.com\/(?:deals?|product)\/([a-z0-9-]+)\/?)"[^>]*>/gi;
      const seen = new Set();
      let lm;
      while ((lm = linkRegex.exec(html)) !== null) {
        const slug = lm[2];
        if (seen.has(slug) || !slug || slug.length < 3 || slug === 'deals' || slug === 'lifetime') continue;
        seen.add(slug);
        items.push({
          title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: '',
          price: '',
          original_price: '',
          discount: '',
          category: 'Other',
          link: lm[1],
          image: '',
          source: 'rockethub',
          date_found: TODAY,
          expires: '',
        });
      }
    }

    if (items.length > 0) break;
  }

  log(`  RocketHub: ${items.length} deals`);
  return items;
}

// 8. SaaS Pirate
async function scrapeSaaSPirate() {
  log('Scraping SaaS Pirate...');
  const items = [];

  const html = await fetchPage('https://saaspirate.com/');
  if (!html) { log('  SaaS Pirate: FAILED'); return items; }

  // Try to find deal cards
  const cardRegex = /<div[^>]*class="[^"]*(?:deal|product|card|item|listing)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:deal|product|card|item|listing)[^"]*"|<\/(?:section|main)>)/g;
  let cm;
  while ((cm = cardRegex.exec(html)) !== null) {
    const card = cm[1];
    const titleM = card.match(/<(?:h[234])[^>]*>\s*(?:<a[^>]*>)?\s*([^<]{3,100})\s*(?:<\/a>)?\s*<\/h[234]>/);
    const linkM = card.match(/href="(https?:\/\/(?:www\.)?saaspirate\.com\/[^"]+)"/);
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const priceM = card.match(/\$\s*([\d,.]+)/);
    if (titleM) {
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: priceM ? '$' + priceM[1] : '',
        original_price: '',
        discount: '',
        category: guessCategory(titleM[1], ''),
        link: linkM ? linkM[1] : '',
        image: imgM ? imgM[1] : '',
        source: 'saaspirate',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Broader fallback - find deal/product links
  if (items.length === 0) {
    const linkRegex = /href="(https?:\/\/(?:www\.)?saaspirate\.com\/(?:deals?|products?|lifetime)\/([a-z0-9-]+)\/?)"[^>]*>/gi;
    const seen = new Set();
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) {
      const slug = lm[2];
      if (seen.has(slug) || !slug || slug.length < 3) continue;
      seen.add(slug);
      items.push({
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: 'Other',
        link: lm[1],
        image: '',
        source: 'saaspirate',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Also try finding any links that contain "deal" in anchor text
  if (items.length === 0) {
    const anchorRegex = /<a[^>]*href="(https?:\/\/(?:www\.)?saaspirate\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const seen = new Set();
    let am;
    while ((am = anchorRegex.exec(html)) !== null) {
      const link = am[1];
      const text = stripTags(am[2]).trim();
      if (seen.has(link) || !text || text.length < 3 || text.length > 100) continue;
      if (!/deal|product|lifetime|saas/i.test(link)) continue;
      seen.add(link);
      items.push({
        title: decodeEntities(text),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: guessCategory(text, ''),
        link,
        image: '',
        source: 'saaspirate',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  log(`  SaaS Pirate: ${items.length} deals`);
  return items;
}

// 9. Product Hunt Deals
async function scrapeProductHunt() {
  log('Scraping Product Hunt...');
  const items = [];

  const html = await fetchPage('https://www.producthunt.com/deals');
  if (!html) { log('  Product Hunt: FAILED'); return items; }

  // Product Hunt may have Apollo/GraphQL state embedded
  const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/) ||
                       html.match(/"apolloState"\s*:\s*({[\s\S]*?})\s*[,}]\s*"[a-z]/);
  if (apolloMatch) {
    try {
      const data = JSON.parse(apolloMatch[1]);
      for (const key of Object.keys(data)) {
        const obj = data[key];
        if (obj && obj.name && (obj.tagline || obj.description) && obj.slug) {
          const link = `https://www.producthunt.com/products/${obj.slug}`;
          items.push({
            title: decodeEntities(obj.name),
            description: decodeEntities(stripTags(obj.tagline || obj.description || '')).slice(0, 200),
            price: '',
            original_price: '',
            discount: '',
            category: guessCategory(obj.name, obj.tagline || ''),
            link,
            image: obj.thumbnail?.url || '',
            source: 'producthunt',
            date_found: TODAY,
            expires: '',
          });
        }
      }
    } catch (e) { /* continue */ }
  }

  if (items.length > 0) {
    log(`  Product Hunt Apollo: ${items.length} deals`);
    return items;
  }

  // Try Next.js data
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const extractDeals = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.name && obj.slug && (obj.tagline || obj.url)) {
          items.push({
            title: decodeEntities(obj.name),
            description: decodeEntities(stripTags(obj.tagline || '')).slice(0, 200),
            price: obj.price ? cleanPrice(obj.price) : '',
            original_price: '',
            discount: obj.discount || '',
            category: guessCategory(obj.name, obj.tagline || ''),
            link: obj.url || `https://www.producthunt.com/products/${obj.slug}`,
            image: obj.thumbnail || obj.image || '',
            source: 'producthunt',
            date_found: TODAY,
            expires: '',
          });
          return;
        }
        for (const v of Object.values(obj)) {
          if (Array.isArray(v)) v.forEach(extractDeals);
          else if (typeof v === 'object' && v !== null) extractDeals(v);
        }
      };
      extractDeals(nextData.props);
    } catch (e) { /* continue */ }
  }

  if (items.length > 0) {
    log(`  Product Hunt NEXT_DATA: ${items.length} deals`);
    return items;
  }

  // HTML link extraction fallback
  const linkRegex = /href="(\/products\/([a-z0-9-]+))"[^>]*>/g;
  const seen = new Set();
  let lm;
  while ((lm = linkRegex.exec(html)) !== null) {
    const slug = lm[2];
    if (seen.has(slug) || !slug || slug.length < 2) continue;
    seen.add(slug);
    items.push({
      title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: '',
      price: '',
      original_price: '',
      discount: '',
      category: 'Other',
      link: 'https://www.producthunt.com' + lm[1],
      image: '',
      source: 'producthunt',
      date_found: TODAY,
      expires: '',
    });
  }

  log(`  Product Hunt: ${items.length} deals`);
  return items;
}

// 10. NachoNacho Marketplace
async function scrapeNachoNacho() {
  log('Scraping NachoNacho...');
  const items = [];

  const html = await fetchPage('https://nachonacho.com/marketplace');
  if (!html) { log('  NachoNacho: FAILED'); return items; }

  // Try Next.js __NEXT_DATA__
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const extractProducts = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(extractProducts); return; }
        if (obj.name && (obj.slug || obj.id) && (obj.discount || obj.cashback || obj.description)) {
          const slug = obj.slug || obj.id;
          items.push({
            title: decodeEntities(obj.name),
            description: decodeEntities(stripTags(obj.description || obj.tagline || '')).slice(0, 200),
            price: obj.price ? cleanPrice('$' + obj.price) : '',
            original_price: '',
            discount: obj.discount ? obj.discount + '%' : (obj.cashback ? obj.cashback + '% cashback' : ''),
            category: guessCategory(obj.name, obj.description || ''),
            link: `https://nachonacho.com/marketplace/${slug}`,
            image: obj.logo || obj.image || '',
            source: 'nachonacho',
            date_found: TODAY,
            expires: '',
          });
          return;
        }
        for (const v of Object.values(obj)) {
          if (typeof v === 'object' && v !== null) extractProducts(v);
        }
      };
      extractProducts(nextData.props);
    } catch (e) { /* continue */ }
  }

  if (items.length > 0) {
    log(`  NachoNacho NEXT_DATA: ${items.length} deals`);
    return items;
  }

  // HTML card extraction
  const cardRegex = /<div[^>]*class="[^"]*(?:product|card|item|marketplace)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:product|card|item|marketplace)[^"]*"|<\/(?:section|main)>)/g;
  let cm;
  while ((cm = cardRegex.exec(html)) !== null) {
    const card = cm[1];
    const titleM = card.match(/<(?:h[234]|p|span)[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]{3,80})</) ||
                   card.match(/<(?:h[234])[^>]*>\s*(?:<a[^>]*>)?\s*([^<]{3,100})\s*(?:<\/a>)?\s*<\/h[234]>/);
    const linkM = card.match(/href="(https?:\/\/nachonacho\.com\/[^"]+)"/) || card.match(/href="(\/marketplace\/[^"]+)"/);
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const discountM = card.match(/(\d+)%/);
    if (titleM) {
      const link = linkM ? (linkM[1].startsWith('http') ? linkM[1] : 'https://nachonacho.com' + linkM[1]) : '';
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: '',
        original_price: '',
        discount: discountM ? discountM[1] + '%' : '',
        category: guessCategory(titleM[1], ''),
        link,
        image: imgM ? imgM[1] : '',
        source: 'nachonacho',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Link-based fallback
  if (items.length === 0) {
    const linkRegex = /href="((?:https?:\/\/nachonacho\.com)?\/marketplace\/([a-z0-9-]+)\/?)"[^>]*>/gi;
    const seen = new Set();
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) {
      const slug = lm[2];
      if (seen.has(slug) || !slug || slug.length < 3 || slug === 'marketplace') continue;
      seen.add(slug);
      items.push({
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        price: '',
        original_price: '',
        discount: '',
        category: 'Other',
        link: lm[1].startsWith('http') ? lm[1] : 'https://nachonacho.com' + lm[1],
        image: '',
        source: 'nachonacho',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  log(`  NachoNacho: ${items.length} deals`);
  return items;
}

// 11. Starter Story Deals
async function scrapeStarterStory() {
  log('Scraping Starter Story...');
  const items = [];

  const html = await fetchPage('https://www.starterstory.com/deals');
  if (!html) { log('  Starter Story: FAILED'); return items; }

  // Card-based extraction
  const cardRegex = /<div[^>]*class="[^"]*(?:deal|card|item|product|offer)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:deal|card|item|product|offer)[^"]*"|<\/(?:section|main)>)/g;
  let cm;
  while ((cm = cardRegex.exec(html)) !== null) {
    const card = cm[1];
    const titleM = card.match(/<(?:h[234])[^>]*>\s*(?:<a[^>]*>)?\s*([^<]{3,100})\s*(?:<\/a>)?\s*<\/h[234]>/);
    const linkM = card.match(/href="(https?:\/\/(?:www\.)?starterstory\.com\/[^"]+)"/) || card.match(/href="(\/[^"]+)"/);
    const imgM = card.match(/<img[^>]*src="([^"]+)"/);
    const priceM = card.match(/\$\s*([\d,.]+)/);
    const discountM = card.match(/(\d+)%\s*off/i);
    if (titleM) {
      const link = linkM ? (linkM[1].startsWith('http') ? linkM[1] : 'https://www.starterstory.com' + linkM[1]) : '';
      items.push({
        title: decodeEntities(titleM[1]),
        description: '',
        price: priceM ? '$' + priceM[1] : '',
        original_price: '',
        discount: discountM ? discountM[1] + '%' : '',
        category: guessCategory(titleM[1], ''),
        link,
        image: imgM ? imgM[1] : '',
        source: 'starterstory',
        date_found: TODAY,
        expires: '',
      });
    }
  }

  // Link/anchor fallback - look for external deal links or internal deal pages
  if (items.length === 0) {
    const anchorRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const seen = new Set();
    let am;
    while ((am = anchorRegex.exec(html)) !== null) {
      const link = am[1];
      const text = stripTags(am[2]).trim();
      if (!text || text.length < 3 || text.length > 100) continue;
      if (seen.has(text.toLowerCase())) continue;
      // Look for deal-related links (external SaaS links or internal deal pages)
      if (/deal|offer|discount|coupon|lifetime|saas/i.test(link) || /deal|offer|discount|lifetime/i.test(text)) {
        seen.add(text.toLowerCase());
        const fullLink = link.startsWith('http') ? link : 'https://www.starterstory.com' + link;
        items.push({
          title: decodeEntities(text),
          description: '',
          price: '',
          original_price: '',
          discount: '',
          category: guessCategory(text, ''),
          link: fullLink,
          image: '',
          source: 'starterstory',
          date_found: TODAY,
          expires: '',
        });
      }
    }
  }

  log(`  Starter Story: ${items.length} deals`);
  return items;
}

// 12. Reddit r/SaaS - deal-related posts
async function scrapeRedditSaaS() {
  log('Scraping Reddit r/SaaS...');
  const items = [];

  const data = await fetchJSON('https://www.reddit.com/r/SaaS.json?limit=50');
  if (!data || !data.data || !data.data.children) { log('  Reddit r/SaaS: FAILED'); return items; }

  const dealKeywords = /\bdeal\b|lifetime|ltd\b|discount|coupon|offer|sale|free|launch|promo/i;

  for (const child of data.data.children) {
    const post = child.data;
    if (!post || !post.title) continue;
    const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
    if (!dealKeywords.test(text)) continue;
    // Skip mod posts or meta
    if (/\[meta\]|weekly|monthly|megathread/i.test(post.title)) continue;

    const link = post.url && !post.url.includes('reddit.com') ? post.url : `https://www.reddit.com${post.permalink}`;
    items.push({
      title: decodeEntities(post.title).slice(0, 120),
      description: decodeEntities(stripTags(post.selftext || '')).slice(0, 200),
      price: '',
      original_price: '',
      discount: '',
      category: guessCategory(post.title, post.selftext || ''),
      link,
      image: post.thumbnail && post.thumbnail.startsWith('http') ? post.thumbnail : '',
      source: 'reddit_saas',
      date_found: TODAY,
      expires: '',
    });
  }

  log(`  Reddit r/SaaS: ${items.length} deals`);
  return items;
}

// 13. Reddit r/AppSumo
async function scrapeRedditAppSumo() {
  log('Scraping Reddit r/AppSumo...');
  const items = [];

  const data = await fetchJSON('https://www.reddit.com/r/appsumo.json?limit=50');
  if (!data || !data.data || !data.data.children) { log('  Reddit r/AppSumo: FAILED'); return items; }

  for (const child of data.data.children) {
    const post = child.data;
    if (!post || !post.title) continue;
    // Skip mod/meta posts
    if (/\[meta\]|weekly|monthly|rules|welcome/i.test(post.title)) continue;

    const link = post.url && !post.url.includes('reddit.com') ? post.url : `https://www.reddit.com${post.permalink}`;
    items.push({
      title: decodeEntities(post.title).slice(0, 120),
      description: decodeEntities(stripTags(post.selftext || '')).slice(0, 200),
      price: '',
      original_price: '',
      discount: '',
      category: guessCategory(post.title, post.selftext || ''),
      link,
      image: post.thumbnail && post.thumbnail.startsWith('http') ? post.thumbnail : '',
      source: 'reddit_appsumo',
      date_found: TODAY,
      expires: '',
    });
  }

  log(`  Reddit r/AppSumo: ${items.length} deals`);
  return items;
}

// === DEDUPLICATION ===
function deduplicateDeals(allDeals) {
  const seen = new Map();
  for (const deal of allDeals) {
    // Normalize title for dedup
    const key = deal.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (!key || key.length < 3) continue;
    if (!seen.has(key)) {
      seen.set(key, deal);
    } else {
      // Keep the one with more data
      const existing = seen.get(key);
      const existingScore = (existing.price ? 1 : 0) + (existing.description ? 1 : 0) + (existing.image ? 1 : 0);
      const newScore = (deal.price ? 1 : 0) + (deal.description ? 1 : 0) + (deal.image ? 1 : 0);
      if (newScore > existingScore) {
        seen.set(key, deal);
      }
    }
  }
  return Array.from(seen.values());
}

// === MAIN ===
async function main() {
  log('=== LTD Deals Scraper Starting ===');
  log(`Date: ${TODAY}`);

  const allDeals = [];
  const sources = [
    { name: 'AppSumo', fn: scrapeAppSumo },
    { name: 'PitchGround', fn: scrapePitchGround },
    { name: 'StackSocial', fn: scrapeStackSocial },
    { name: 'Dealify', fn: scrapeDealify },
    { name: 'DealMirror', fn: scrapeDealMirror },
    { name: 'SaaSMantra', fn: scrapeSaaSMantra },
    { name: 'RocketHub', fn: scrapeRocketHub },
    { name: 'SaaS Pirate', fn: scrapeSaaSPirate },
    { name: 'Product Hunt', fn: scrapeProductHunt },
    { name: 'NachoNacho', fn: scrapeNachoNacho },
    { name: 'Starter Story', fn: scrapeStarterStory },
    { name: 'Reddit r/SaaS', fn: scrapeRedditSaaS },
    { name: 'Reddit r/AppSumo', fn: scrapeRedditAppSumo },
  ];

  for (const source of sources) {
    try {
      const deals = await source.fn();
      allDeals.push(...deals);
      log(`${source.name}: ${deals.length} deals collected`);
    } catch (e) {
      log(`${source.name}: ERROR - ${e.message}`);
    }
  }

  log(`Total raw deals: ${allDeals.length}`);

  // Deduplicate
  const uniqueDeals = deduplicateDeals(allDeals);
  log(`After dedup: ${uniqueDeals.length} unique deals`);

  // Sort by source then title
  uniqueDeals.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.title.localeCompare(b.title);
  });

  // Load existing results and merge (keep deals from last 30 days)
  let existingDeals = [];
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      existingDeals = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
      if (!Array.isArray(existingDeals)) existingDeals = [];
    } catch (e) { existingDeals = []; }
  }

  // Remove deals older than 30 days from existing
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  existingDeals = existingDeals.filter(d => d.date_found >= cutoffStr);

  // Merge: new deals override existing with same title+source
  const mergedMap = new Map();
  for (const d of existingDeals) {
    const key = (d.source + ':' + d.title).toLowerCase().replace(/[^a-z0-9:]/g, '');
    mergedMap.set(key, d);
  }
  for (const d of uniqueDeals) {
    const key = (d.source + ':' + d.title).toLowerCase().replace(/[^a-z0-9:]/g, '');
    mergedMap.set(key, d);
  }
  const finalDeals = Array.from(mergedMap.values());
  finalDeals.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.title.localeCompare(b.title);
  });

  // Save results
  const output = {
    last_updated: new Date().toISOString(),
    total_deals: finalDeals.length,
    sources_summary: {},
    deals: finalDeals,
  };

  // Count by source
  for (const d of finalDeals) {
    output.sources_summary[d.source] = (output.sources_summary[d.source] || 0) + 1;
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${finalDeals.length} deals to ${RESULTS_FILE}`);

  fs.writeFileSync(SITE_DATA_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${finalDeals.length} deals to ${SITE_DATA_FILE}`);

  // Summary
  log('=== Summary ===');
  for (const [source, count] of Object.entries(output.sources_summary)) {
    log(`  ${source}: ${count} deals`);
  }
  log(`  TOTAL: ${finalDeals.length} deals`);
  log('=== LTD Deals Scraper Complete ===');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
