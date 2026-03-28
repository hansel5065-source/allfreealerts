#!/usr/bin/env node
// Food Deals Scraper — AllFreeAlerts.com
// Run: node scraper.js
// Aggregates food deals, restaurant coupons, grocery discounts, delivery promos, free food, birthday freebies

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const DATA_DIR = path.join(__dirname, 'data');
const SITE_DIR = path.join(__dirname, 'site');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const SITE_DATA_FILE = path.join(SITE_DIR, 'data.json');
const TODAY = new Date().toISOString().slice(0, 10);

// === UTILITIES ===
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/<!\[CDATA\[|\]\]>/g, '');
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

function parseRssItems(xml) {
  return (xml.match(/<item>([\s\S]*?)<\/item>/g) || []).map(item => {
    const getTag = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decodeEntities(m[1].trim()) : '';
    };
    const getTagRaw = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    const categories = (item.match(/<category[^>]*>([\s\S]*?)<\/category>/g) || [])
      .map(c => decodeEntities(c.replace(/<\/?category[^>]*>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '')));
    const imgMatch = item.match(/<media:content[^>]+url="([^"]+)"/) ||
                     item.match(/<enclosure[^>]+url="([^"]+)"/) ||
                     item.match(/<img[^>]+src="([^"]+)"/);
    return {
      title: getTag('title'),
      link: getTag('link') || getTagRaw('link'),
      description: getTag('description'),
      pubDate: getTag('pubDate'),
      categories,
      image: imgMatch ? imgMatch[1] : '',
    };
  });
}

// === DEAL EXTRACTION HELPERS ===

function guessDiscount(text) {
  if (!text) return '';
  const lower = text.toLowerCase();
  // Check common patterns
  const pctMatch = text.match(/(\d+)%\s*off/i);
  if (pctMatch) return `${pctMatch[1]}% off`;
  const dollarMatch = text.match(/\$(\d+(?:\.\d+)?)\s*off/i);
  if (dollarMatch) return `$${dollarMatch[1]} off`;
  if (/\bfree\b/i.test(lower) && !/free shipping/i.test(lower)) return 'Free';
  if (/\bbogo\b|buy\s+one\s+get\s+one/i.test(lower)) return 'BOGO';
  if (/\bhalf\s+off\b|50%/i.test(lower)) return '50% off';
  const justDollar = text.match(/\$(\d+(?:\.\d+)?)/);
  if (justDollar) return `$${justDollar[1]}`;
  return '';
}

function guessPromoCode(text) {
  if (!text) return '';
  // Look for promo code patterns
  const m = text.match(/(?:code|coupon|promo)[:\s]+([A-Z0-9]{3,20})/i) ||
            text.match(/\b(?:use|enter|apply)\s+([A-Z0-9]{3,20})\b/i);
  return m ? m[1].toUpperCase() : '';
}

function guessExpiry(text) {
  if (!text) return '';
  // Look for date patterns
  const m = text.match(/(?:exp(?:ires?)?|ends?|valid\s+(?:through|until|thru)|through)\s*:?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i) ||
            text.match(/(?:exp(?:ires?)?|ends?|valid\s+(?:through|until|thru)|through)\s*:?\s*([A-Z][a-z]+\.?\s+\d{1,2},?\s*\d{4})/i) ||
            text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  return m ? m[1].trim() : '';
}

function guessBrand(title) {
  if (!title) return '';
  const brands = [
    'McDonald\'s', 'Wendy\'s', 'Burger King', 'Taco Bell', 'Chick-fil-A',
    'Subway', 'Domino\'s', 'Pizza Hut', 'Papa John\'s', 'KFC',
    'Starbucks', 'Dunkin\'', 'Chipotle', 'Panera', 'Popeyes',
    'Arby\'s', 'Sonic', 'Jack in the Box', 'Five Guys', 'Wingstop',
    'DoorDash', 'Uber Eats', 'UberEats', 'Grubhub', 'Postmates', 'Instacart',
    'Costco', 'Walmart', 'Kroger', 'Target', 'Aldi', 'Trader Joe\'s',
    'Whole Foods', 'Safeway', 'Publix', 'Sam\'s Club', 'BJ\'s',
    'Applebee\'s', 'Olive Garden', 'Chili\'s', 'Red Lobster', 'Outback',
    'IHOP', 'Denny\'s', 'Cracker Barrel', 'TGI Friday\'s', 'Buffalo Wild Wings',
    'Panda Express', 'Raising Cane\'s', 'Zaxby\'s', 'Whataburger',
    'Jersey Mike\'s', 'Jimmy John\'s', 'Firehouse Subs', 'Potbelly',
    'Krispy Kreme', 'Baskin-Robbins', 'Cold Stone', 'Dairy Queen',
    'Little Caesars', 'Marco\'s Pizza', 'Noodles & Company',
    'Restaurant.com', 'Groupon',
  ];
  for (const brand of brands) {
    if (title.toLowerCase().includes(brand.toLowerCase())) return brand;
  }
  return '';
}

function guessCategory(title, description) {
  const text = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (/birthday\s*(freebie|free|deal|reward|treat)/i.test(text)) return 'Birthday Freebies';
  if (/\bbogo\b|buy\s+one\s+get\s+one/i.test(text)) return 'BOGO Deals';
  if (/\bfree\s+(food|meal|drink|coffee|donut|pizza|burger|taco|fries|sandwich|ice cream|cookie|smoothie)/i.test(text)) return 'Free Food';
  if (/doordash|uber\s*eats|grubhub|postmates|instacart|delivery/i.test(text)) return 'Delivery Promos';
  if (/grocery|supermarket|kroger|aldi|walmart.*food|target.*food|costco.*food|coupon.*food|food.*coupon/i.test(text)) return 'Grocery Coupons';
  if (/restaurant|dine|dining|eat\s+out|burger king|mcdonald|wendy|taco bell|chick-fil-a|chipotle|panera|olive garden|applebee/i.test(text)) return 'Restaurant Deals';
  if (/\bfree\b/i.test(text)) return 'Free Food';
  return 'Restaurant Deals';
}

function makeDeal({ title, description, category, link, source, date_found, brand, discount, promo_code, expiry, image }) {
  const text = (title || '') + ' ' + (description || '');
  return {
    title: (title || '').trim(),
    description: (description || '').trim(),
    category: category || guessCategory(title || '', description || ''),
    brand: brand || guessBrand(title || ''),
    discount: discount || guessDiscount(text),
    promo_code: promo_code || guessPromoCode(text),
    expiry: expiry || '',
    link: (link || '').trim(),
    image: image || '',
    source: source || '',
    date_found: date_found || TODAY,
  };
}

// === SCRAPERS ===

async function scrapeHip2SaveFood() {
  log('Scraping Hip2Save Food & Drink deals (RSS)...');
  const items = [];
  const xml = await fetchPage('https://hip2save.com/food-drink/feed/');
  if (!xml) { log('  Hip2Save Food: FAILED'); return items; }

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const desc = stripHtml(rss.description).slice(0, 300);
    items.push({
      title: rss.title,
      description: desc,
      category: guessCategory(rss.title, desc),
      brand: guessBrand(rss.title),
      discount: guessDiscount(rss.title + ' ' + desc),
      promo_code: guessPromoCode(rss.title + ' ' + desc),
      expiry: guessExpiry(desc),
      link: rss.link,
      image: rss.image || '',
      source: 'hip2save',
      date_found: TODAY,
    });
  }
  log(`  Hip2Save Food: ${items.length} items`);
  return items;
}

async function scrapeKrazyCouponLady() {
  log('Scraping Krazy Coupon Lady (RSS)...');
  const items = [];
  const xml = await fetchPage('https://thekrazycouponlady.com/feed');
  if (!xml) {
    log('  KCL RSS: FAILED, trying HTML scrape...');
    return await scrapeKrazyCouponLadyHtml();
  }

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const text = (rss.title + ' ' + rss.description).toLowerCase();
    // Filter for food/grocery related content
    if (!/food|grocery|restaurant|eat|meal|snack|drink|coupon|deal|save|free/i.test(text)) continue;
    const desc = stripHtml(rss.description).slice(0, 300);
    items.push({
      title: rss.title,
      description: desc,
      category: guessCategory(rss.title, desc),
      brand: guessBrand(rss.title),
      discount: guessDiscount(rss.title + ' ' + desc),
      promo_code: guessPromoCode(desc),
      expiry: guessExpiry(desc),
      link: rss.link,
      image: rss.image || '',
      source: 'krazycouponlady',
      date_found: TODAY,
    });
  }
  log(`  KCL: ${items.length} food-related items`);
  return items;
}

async function scrapeKrazyCouponLadyHtml() {
  log('  Scraping KCL HTML fallback...');
  const items = [];
  const html = await fetchPage('https://thekrazycouponlady.com/coupons/food-grocery');
  if (!html) { log('  KCL HTML: FAILED'); return items; }

  // Try to extract deal cards
  const cardRegex = /<a[^>]+href="(https?:\/\/thekrazycouponlady\.com\/[^"]+)"[^>]*>\s*(?:<[^>]*>)*\s*([^<]{10,100})/g;
  let m;
  const seen = new Set();
  while ((m = cardRegex.exec(html)) !== null) {
    const link = m[1];
    const title = decodeEntities(m[2].trim());
    if (seen.has(link) || title.length < 10) continue;
    if (!/food|grocery|restaurant|eat|meal|snack|drink|coupon|deal|save|free/i.test(title)) continue;
    seen.add(link);
    items.push({
      title,
      description: '',
      category: guessCategory(title, ''),
      brand: guessBrand(title),
      discount: guessDiscount(title),
      promo_code: '',
      expiry: '',
      link,
      image: '',
      source: 'krazycouponlady',
      date_found: TODAY,
    });
  }
  log(`  KCL HTML: ${items.length} items`);
  return items;
}

async function scrapeRetailMeNotFood() {
  log('Scraping RetailMeNot Food Coupons...');
  const items = [];
  const html = await fetchPage('https://www.retailmenot.com/coupons/food');
  if (!html) { log('  RMN Food: FAILED'); return items; }

  // Extract coupon/deal cards
  const couponRegex = /<a[^>]+href="(\/view\/[^"]+)"[^>]*>[\s\S]*?<[^>]*>([^<]{5,150})<\/[^>]*>/g;
  let m;
  const seen = new Set();
  while ((m = couponRegex.exec(html)) !== null) {
    const link = 'https://www.retailmenot.com' + m[1];
    const title = decodeEntities(stripHtml(m[2]).trim());
    if (seen.has(link) || title.length < 5) continue;
    seen.add(link);
    items.push({
      title,
      description: '',
      category: guessCategory(title, ''),
      brand: guessBrand(title) || m[1].replace('/view/', '').replace(/\.com.*/, '.com'),
      discount: guessDiscount(title),
      promo_code: '',
      expiry: '',
      link,
      image: '',
      source: 'retailmenot',
      date_found: TODAY,
    });
  }

  // Also try to extract structured coupon data from JSON-LD or inline scripts
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      try {
        const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
        if (json.offers || json.itemListElement) {
          const offers = json.offers || (json.itemListElement || []).map(i => i.item).filter(Boolean);
          for (const offer of (Array.isArray(offers) ? offers : [offers])) {
            if (!offer.name && !offer.description) continue;
            const title = offer.name || offer.description || '';
            const link = offer.url || '';
            if (seen.has(link)) continue;
            seen.add(link);
            items.push({
              title: decodeEntities(title),
              description: offer.description ? stripHtml(offer.description).slice(0, 300) : '',
              category: guessCategory(title, ''),
              brand: guessBrand(title),
              discount: guessDiscount(title),
              promo_code: offer.code || '',
              expiry: offer.validThrough || '',
              link: link.startsWith('http') ? link : 'https://www.retailmenot.com' + link,
              image: '',
              source: 'retailmenot',
              date_found: TODAY,
            });
          }
        }
      } catch (e) {}
    }
  }

  log(`  RMN Food: ${items.length} items`);
  return items;
}

async function scrapeCouponsDotCom() {
  log('Scraping Coupons.com food coupons...');
  const items = [];
  const html = await fetchPage('https://www.coupons.com/coupon-codes/food');
  if (!html) { log('  Coupons.com: FAILED'); return items; }

  // Try to extract deal cards
  const regex = /<a[^>]+href="([^"]*coupon[^"]*)"[^>]*>[\s\S]*?<[^>]*>([^<]{10,200})<\/[^>]*>/gi;
  let m;
  const seen = new Set();
  while ((m = regex.exec(html)) !== null) {
    let link = m[1];
    if (!link.startsWith('http')) link = 'https://www.coupons.com' + link;
    const title = decodeEntities(stripHtml(m[2]).trim());
    if (seen.has(link) || title.length < 10) continue;
    seen.add(link);
    items.push({
      title,
      description: '',
      category: 'Grocery Coupons',
      brand: guessBrand(title),
      discount: guessDiscount(title),
      promo_code: guessPromoCode(title),
      expiry: '',
      link,
      image: '',
      source: 'coupons_com',
      date_found: TODAY,
    });
  }

  // Fallback: look for any structured data
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const extract = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.offers || obj.coupons || obj.deals) {
          const list = obj.offers || obj.coupons || obj.deals;
          if (Array.isArray(list)) {
            for (const item of list) {
              const title = item.title || item.name || item.description || '';
              if (!title || seen.has(title)) continue;
              seen.add(title);
              items.push({
                title: decodeEntities(title),
                description: item.description ? stripHtml(item.description).slice(0, 300) : '',
                category: 'Grocery Coupons',
                brand: guessBrand(title) || item.brand || item.storeName || '',
                discount: guessDiscount(title + ' ' + (item.description || '')),
                promo_code: item.code || item.promoCode || '',
                expiry: item.expirationDate || item.endDate || '',
                link: item.url || item.link || 'https://www.coupons.com/coupon-codes/food',
                image: item.image || item.imageUrl || '',
                source: 'coupons_com',
                date_found: TODAY,
              });
            }
          }
        }
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'object') extract(obj[key]);
        }
      };
      extract(data);
    } catch (e) {}
  }

  log(`  Coupons.com: ${items.length} items`);
  return items;
}

async function scrapeRestaurantDotCom() {
  log('Scraping Restaurant.com deals...');
  const items = [];
  const html = await fetchPage('https://www.restaurant.com');
  if (!html) { log('  Restaurant.com: FAILED'); return items; }

  // Try to extract featured deals or promo info
  const promoRegex = /(?:deal|offer|certificate|discount|save|off)[^<]{0,200}/gi;
  let m;
  const seen = new Set();
  while ((m = promoRegex.exec(html)) !== null) {
    const text = stripHtml(m[0]).trim();
    if (text.length < 15 || text.length > 200 || seen.has(text)) continue;
    seen.add(text);
    items.push({
      title: text.slice(0, 100),
      description: text,
      category: 'Restaurant Deals',
      brand: 'Restaurant.com',
      discount: guessDiscount(text),
      promo_code: guessPromoCode(text),
      expiry: guessExpiry(text),
      link: 'https://www.restaurant.com',
      image: '',
      source: 'restaurantdotcom',
      date_found: TODAY,
    });
    if (items.length >= 10) break;
  }
  log(`  Restaurant.com: ${items.length} items`);
  return items;
}

async function scrapeRetailMeNotBrand(brandSlug, source, defaultBrand) {
  log(`Scraping RetailMeNot ${defaultBrand} promos...`);
  const items = [];
  const html = await fetchPage(`https://www.retailmenot.com/view/${brandSlug}`);
  if (!html) { log(`  RMN ${defaultBrand}: FAILED`); return items; }

  // Extract promo code blocks
  const codeRegex = /(?:code|coupon|promo)[:\s]*<[^>]*>([A-Z0-9]{3,20})<\/[^>]*>/gi;
  let m;
  const seen = new Set();
  while ((m = codeRegex.exec(html)) !== null) {
    const code = m[1].toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    // Find the surrounding context for the deal description
    const start = Math.max(0, m.index - 300);
    const context = html.substring(start, m.index + m[0].length + 300);
    const descMatch = context.match(/>([^<]{15,150})</);
    items.push({
      title: `${defaultBrand}: Use code ${code}`,
      description: descMatch ? stripHtml(descMatch[1]).trim() : '',
      category: 'Delivery Promos',
      brand: defaultBrand,
      discount: guessDiscount(context),
      promo_code: code,
      expiry: guessExpiry(context),
      link: `https://www.retailmenot.com/view/${brandSlug}`,
      image: '',
      source,
      date_found: TODAY,
    });
  }

  // Also extract deal descriptions without codes
  const dealRegex = /<div[^>]*>[\s\S]*?(\d+%\s*off[^<]{0,100}|free\s+delivery[^<]{0,100}|\$\d+\s*off[^<]{0,100})[\s\S]*?<\/div>/gi;
  while ((m = dealRegex.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim();
    if (text.length < 10 || seen.has(text)) continue;
    seen.add(text);
    items.push({
      title: `${defaultBrand}: ${text.slice(0, 80)}`,
      description: text,
      category: 'Delivery Promos',
      brand: defaultBrand,
      discount: guessDiscount(text),
      promo_code: guessPromoCode(text),
      expiry: guessExpiry(text),
      link: `https://www.retailmenot.com/view/${brandSlug}`,
      image: '',
      source,
      date_found: TODAY,
    });
  }

  // Fallback: try JSON-LD structured data
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
      const offers = json.hasOfferCatalog?.itemListElement || json.offers || [];
      for (const offer of (Array.isArray(offers) ? offers : [offers])) {
        const title = offer.name || offer.description || '';
        if (!title || seen.has(title)) continue;
        seen.add(title);
        items.push({
          title: `${defaultBrand}: ${decodeEntities(title).slice(0, 80)}`,
          description: offer.description ? stripHtml(offer.description).slice(0, 300) : '',
          category: 'Delivery Promos',
          brand: defaultBrand,
          discount: guessDiscount(title),
          promo_code: offer.code || offer.couponCode || '',
          expiry: offer.validThrough || '',
          link: `https://www.retailmenot.com/view/${brandSlug}`,
          image: '',
          source,
          date_found: TODAY,
        });
      }
    } catch (e) {}
  }

  log(`  RMN ${defaultBrand}: ${items.length} items`);
  return items;
}

async function scrapeFreebieGuyFood() {
  log('Scraping The Freebie Guy (RSS, food filter)...');
  const items = [];
  const xml = await fetchPage('https://thefreebieguy.com/feed/');
  if (!xml) { log('  FreebieGuy: FAILED'); return items; }

  const foodKeywords = /food|eat|meal|snack|drink|coffee|pizza|burger|taco|fries|sandwich|ice cream|cookie|donut|restaurant|grocery|free\s+sample|kitchen|cereal|chip|candy|chocolate|beer|wine|soda|juice|tea|yogurt|cheese/i;

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const text = rss.title + ' ' + rss.description;
    if (!foodKeywords.test(text)) continue;

    const desc = stripHtml(rss.description).slice(0, 300);
    items.push({
      title: rss.title,
      description: desc,
      category: guessCategory(rss.title, desc),
      brand: guessBrand(rss.title),
      discount: guessDiscount(rss.title + ' ' + desc) || 'Free',
      promo_code: guessPromoCode(desc),
      expiry: guessExpiry(desc),
      link: rss.link,
      image: rss.image || '',
      source: 'freebieguy',
      date_found: TODAY,
    });
  }
  log(`  FreebieGuy: ${items.length} food items`);
  return items;
}

async function scrapeRedditFreeFood() {
  log('Scraping Reddit r/freefood...');
  const items = [];
  const data = await fetchJSON('https://www.reddit.com/r/freefood.json?limit=50');
  if (!data || !data.data || !data.data.children) { log('  Reddit: FAILED'); return items; }

  for (const child of data.data.children) {
    const post = child.data;
    if (!post || !post.title) continue;
    if (post.stickied) continue;

    const desc = (post.selftext || '').slice(0, 300);
    items.push({
      title: decodeEntities(post.title),
      description: stripHtml(desc),
      category: guessCategory(post.title, desc),
      brand: guessBrand(post.title),
      discount: guessDiscount(post.title + ' ' + desc) || 'Free',
      promo_code: guessPromoCode(post.title + ' ' + desc),
      expiry: guessExpiry(desc),
      link: post.url && !post.url.includes('reddit.com') ? post.url : `https://www.reddit.com${post.permalink}`,
      image: (post.thumbnail && post.thumbnail.startsWith('http')) ? post.thumbnail : '',
      source: 'reddit',
      date_found: TODAY,
    });
  }
  log(`  Reddit r/freefood: ${items.length} items`);
  return items;
}

// === NEW SCRAPERS ===

async function scrapeSlickdealsFood() {
  log('Scraping Slickdeals Food & Drink (RSS)...');
  const items = [];
  const xml = await fetchPage('https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=catid&catid=44&rss=1');
  if (!xml) {
    log('  Slickdeals RSS: FAILED, trying HTML...');
    const html = await fetchPage('https://slickdeals.net/deals/food-drink/');
    if (!html) { log('  Slickdeals HTML: FAILED'); return items; }
    const cardRegex = /<a[^>]+href="(https?:\/\/slickdeals\.net\/[^"]+)"[^>]*>[^<]*<[^>]*>([^<]{10,200})<\/[^>]*>/g;
    let m;
    const seen = new Set();
    while ((m = cardRegex.exec(html)) !== null) {
      const link = m[1];
      const title = decodeEntities(stripHtml(m[2]).trim());
      if (seen.has(link) || title.length < 10) continue;
      seen.add(link);
      items.push({
        title,
        description: '',
        category: guessCategory(title, ''),
        brand: guessBrand(title),
        discount: guessDiscount(title),
        promo_code: guessPromoCode(title),
        expiry: '',
        link,
        image: '',
        source: 'slickdeals',
        date_found: TODAY,
      });
    }
    log(`  Slickdeals HTML: ${items.length} items`);
    return items;
  }

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const desc = stripHtml(rss.description).slice(0, 300);
    items.push({
      title: rss.title,
      description: desc,
      category: guessCategory(rss.title, desc),
      brand: guessBrand(rss.title),
      discount: guessDiscount(rss.title + ' ' + desc),
      promo_code: guessPromoCode(rss.title + ' ' + desc),
      expiry: guessExpiry(desc),
      link: rss.link,
      image: rss.image || '',
      source: 'slickdeals',
      date_found: TODAY,
    });
  }
  log(`  Slickdeals Food: ${items.length} items`);
  return items;
}

async function scrapeBensBargainsFood() {
  log('Scraping Ben\'s Bargains Food...');
  const items = [];
  const html = await fetchPage('https://bensbargains.com/food/');
  if (!html) { log('  BensBargains: FAILED'); return items; }

  const cardRegex = /<a[^>]+href="(https?:\/\/bensbargains\.com\/[^"]+)"[^>]*>[\s\S]*?<[^>]*>([^<]{10,200})<\/[^>]*>/g;
  let m;
  const seen = new Set();
  while ((m = cardRegex.exec(html)) !== null) {
    const link = m[1];
    const title = decodeEntities(stripHtml(m[2]).trim());
    if (seen.has(link) || title.length < 10) continue;
    seen.add(link);
    items.push({
      title,
      description: '',
      category: guessCategory(title, ''),
      brand: guessBrand(title),
      discount: guessDiscount(title),
      promo_code: guessPromoCode(title),
      expiry: '',
      link,
      image: '',
      source: 'bensbargains',
      date_found: TODAY,
    });
  }

  // Fallback: try JSON-LD
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
      const listItems = json.itemListElement || [];
      for (const li of listItems) {
        const item = li.item || li;
        const title = item.name || '';
        if (!title || seen.has(title)) continue;
        seen.add(title);
        items.push({
          title: decodeEntities(title),
          description: item.description ? stripHtml(item.description).slice(0, 300) : '',
          category: guessCategory(title, ''),
          brand: guessBrand(title),
          discount: guessDiscount(title),
          promo_code: '',
          expiry: '',
          link: item.url || 'https://bensbargains.com/food/',
          image: '',
          source: 'bensbargains',
          date_found: TODAY,
        });
      }
    } catch (e) {}
  }

  log(`  BensBargains: ${items.length} items`);
  return items;
}

async function scrapeRedditSubFiltered(subreddit, sourceName) {
  log(`Scraping Reddit r/${subreddit} (food filter)...`);
  const items = [];
  const data = await fetchJSON(`https://www.reddit.com/r/${subreddit}.json?limit=50`);
  if (!data || !data.data || !data.data.children) { log(`  Reddit r/${subreddit}: FAILED`); return items; }

  const foodKeywords = /food|restaurant|pizza|burger|taco|fries|sandwich|coffee|donut|grocery|meal|eat|drink|starbucks|mcdonald|wendy|chipotle|domino|chick-fil-a|panera|subway|kfc|popeyes|dunkin|grubhub|doordash|uber\s*eats|free\s+meal|free\s+food|bogo|snack|ice cream|cookie|wing|chicken|sushi|chinese|thai|mexican|italian|bbq|barbecue|steakhouse|dine|dining/i;

  for (const child of data.data.children) {
    const post = child.data;
    if (!post || !post.title) continue;
    if (post.stickied) continue;
    const text = post.title + ' ' + (post.selftext || '');
    if (!foodKeywords.test(text)) continue;

    const desc = (post.selftext || '').slice(0, 300);
    items.push({
      title: decodeEntities(post.title),
      description: stripHtml(desc),
      category: guessCategory(post.title, desc),
      brand: guessBrand(post.title),
      discount: guessDiscount(post.title + ' ' + desc),
      promo_code: guessPromoCode(post.title + ' ' + desc),
      expiry: guessExpiry(desc),
      link: post.url && !post.url.includes('reddit.com') ? post.url : `https://www.reddit.com${post.permalink}`,
      image: (post.thumbnail && post.thumbnail.startsWith('http')) ? post.thumbnail : '',
      source: `reddit_${subreddit}`,
      date_found: TODAY,
    });
  }
  log(`  Reddit r/${subreddit}: ${items.length} food items`);
  return items;
}

async function scrapePennyHoarderFood() {
  log('Scraping The Penny Hoarder Food...');
  const items = [];
  const html = await fetchPage('https://www.thepennyhoarder.com/food/');
  if (!html) { log('  PennyHoarder: FAILED'); return items; }

  // Extract article links and titles
  const articleRegex = /<a[^>]+href="(https?:\/\/www\.thepennyhoarder\.com\/[^"]+)"[^>]*>[\s\S]*?<[^>]*>([^<]{15,200})<\/[^>]*>/g;
  let m;
  const seen = new Set();
  while ((m = articleRegex.exec(html)) !== null) {
    const link = m[1];
    const title = decodeEntities(stripHtml(m[2]).trim());
    if (seen.has(link) || title.length < 15) continue;
    // Filter for deal-like content
    if (!/deal|free|coupon|save|discount|off|bogo|promo|cheap|budget|reward/i.test(title)) continue;
    seen.add(link);
    items.push({
      title,
      description: '',
      category: guessCategory(title, ''),
      brand: guessBrand(title),
      discount: guessDiscount(title),
      promo_code: guessPromoCode(title),
      expiry: '',
      link,
      image: '',
      source: 'pennyhoarder',
      date_found: TODAY,
    });
  }

  // Fallback: look for JSON-LD or __NEXT_DATA__
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch && items.length === 0) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const extract = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.title && obj.slug && !seen.has(obj.slug)) {
          seen.add(obj.slug);
          const title = decodeEntities(obj.title);
          items.push({
            title,
            description: obj.excerpt ? stripHtml(obj.excerpt).slice(0, 300) : '',
            category: guessCategory(title, ''),
            brand: guessBrand(title),
            discount: guessDiscount(title),
            promo_code: '',
            expiry: '',
            link: obj.url || obj.link || `https://www.thepennyhoarder.com/${obj.slug}`,
            image: '',
            source: 'pennyhoarder',
            date_found: TODAY,
          });
        }
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'object') extract(obj[key]);
        }
      };
      extract(data);
    } catch (e) {}
  }

  log(`  PennyHoarder: ${items.length} items`);
  return items;
}

async function scrapeOffersComFood() {
  log('Scraping Offers.com Food...');
  const items = [];
  const html = await fetchPage('https://www.offers.com/food/');
  if (!html) { log('  Offers.com: FAILED'); return items; }

  const cardRegex = /<a[^>]+href="(https?:\/\/www\.offers\.com\/[^"]+)"[^>]*>[\s\S]*?<[^>]*>([^<]{10,200})<\/[^>]*>/g;
  let m;
  const seen = new Set();
  while ((m = cardRegex.exec(html)) !== null) {
    const link = m[1];
    const title = decodeEntities(stripHtml(m[2]).trim());
    if (seen.has(link) || title.length < 10) continue;
    seen.add(link);
    items.push({
      title,
      description: '',
      category: guessCategory(title, ''),
      brand: guessBrand(title),
      discount: guessDiscount(title),
      promo_code: guessPromoCode(title),
      expiry: '',
      link,
      image: '',
      source: 'offers_com',
      date_found: TODAY,
    });
  }

  // Also try to find inline deal JSON
  const jsonBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
      const offers = json.itemListElement || json.offers || [];
      for (const o of (Array.isArray(offers) ? offers : [offers])) {
        const item = o.item || o;
        const title = item.name || '';
        if (!title || seen.has(title)) continue;
        seen.add(title);
        items.push({
          title: decodeEntities(title),
          description: item.description ? stripHtml(item.description).slice(0, 300) : '',
          category: guessCategory(title, ''),
          brand: guessBrand(title),
          discount: guessDiscount(title),
          promo_code: item.code || '',
          expiry: item.validThrough || '',
          link: item.url || 'https://www.offers.com/food/',
          image: '',
          source: 'offers_com',
          date_found: TODAY,
        });
      }
    } catch (e) {}
  }

  log(`  Offers.com: ${items.length} items`);
  return items;
}

async function scrapeDealsPlusFood() {
  log('Scraping DealsPlus Food & Drink...');
  const items = [];
  const html = await fetchPage('https://www.dealsplus.com/Food-Drink_deals');
  if (!html) { log('  DealsPlus: FAILED'); return items; }

  const cardRegex = /<a[^>]+href="(https?:\/\/www\.dealsplus\.com\/[^"]+)"[^>]*>[\s\S]*?<[^>]*>([^<]{10,200})<\/[^>]*>/g;
  let m;
  const seen = new Set();
  while ((m = cardRegex.exec(html)) !== null) {
    const link = m[1];
    const title = decodeEntities(stripHtml(m[2]).trim());
    if (seen.has(link) || title.length < 10) continue;
    seen.add(link);
    items.push({
      title,
      description: '',
      category: guessCategory(title, ''),
      brand: guessBrand(title),
      discount: guessDiscount(title),
      promo_code: guessPromoCode(title),
      expiry: '',
      link,
      image: '',
      source: 'dealsplus',
      date_found: TODAY,
    });
  }

  // Fallback: try JSON-LD
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
      const listItems = json.itemListElement || [];
      for (const li of listItems) {
        const item = li.item || li;
        const title = item.name || '';
        if (!title || seen.has(title)) continue;
        seen.add(title);
        items.push({
          title: decodeEntities(title),
          description: item.description ? stripHtml(item.description).slice(0, 300) : '',
          category: guessCategory(title, ''),
          brand: guessBrand(title),
          discount: guessDiscount(title),
          promo_code: '',
          expiry: '',
          link: item.url || 'https://www.dealsplus.com/Food-Drink_deals',
          image: '',
          source: 'dealsplus',
          date_found: TODAY,
        });
      }
    } catch (e) {}
  }

  log(`  DealsPlus: ${items.length} items`);
  return items;
}

async function scrapeFastFoodAppDeals() {
  log('Scraping fast food app deal pages...');
  const items = [];

  const fastFoodSources = [
    { name: "McDonald's", url: 'https://www.mcdonalds.com/us/en-us/deals.html', slug: 'mcdonalds' },
    { name: "Wendy's", url: 'https://www.wendys.com/deals', slug: 'wendys' },
    { name: 'Burger King', url: 'https://www.bk.com/offers', slug: 'burgerking' },
    { name: 'Taco Bell', url: 'https://www.tacobell.com/deals', slug: 'tacobell' },
    { name: 'Chick-fil-A', url: 'https://www.chick-fil-a.com/menu/rewards', slug: 'chickfila' },
  ];

  for (const ff of fastFoodSources) {
    log(`  Fetching ${ff.name}...`);
    const html = await fetchPage(ff.url);
    if (!html) { log(`    ${ff.name}: FAILED`); continue; }

    const seen = new Set();

    // Strategy 1: Extract deal/offer text blocks
    const dealRegex = /(?:deal|offer|reward|coupon|save|free|off|bonus)[^<]{0,200}/gi;
    let m;
    while ((m = dealRegex.exec(html)) !== null) {
      const text = stripHtml(m[0]).trim();
      if (text.length < 15 || text.length > 200 || seen.has(text)) continue;
      if (/cookie|privacy|terms|policy|script|function|var /i.test(text)) continue;
      seen.add(text);
      items.push({
        title: `${ff.name}: ${text.slice(0, 80)}`,
        description: text,
        category: 'Restaurant Deals',
        brand: ff.name,
        discount: guessDiscount(text),
        promo_code: guessPromoCode(text),
        expiry: guessExpiry(text),
        link: ff.url,
        image: '',
        source: `fastfood_${ff.slug}`,
        date_found: TODAY,
      });
      if (seen.size >= 15) break;
    }

    // Strategy 2: JSON-LD structured data
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    for (const block of jsonLdBlocks) {
      try {
        const json = JSON.parse(block.replace(/<\/?script[^>]*>/g, ''));
        const offers = json.hasOfferCatalog?.itemListElement || json.offers || json.itemListElement || [];
        for (const offer of (Array.isArray(offers) ? offers : [offers])) {
          const title = offer.name || offer.description || '';
          if (!title || seen.has(title)) continue;
          seen.add(title);
          items.push({
            title: `${ff.name}: ${decodeEntities(title).slice(0, 80)}`,
            description: offer.description ? stripHtml(offer.description).slice(0, 300) : '',
            category: 'Restaurant Deals',
            brand: ff.name,
            discount: guessDiscount(title),
            promo_code: offer.code || offer.couponCode || '',
            expiry: offer.validThrough || '',
            link: ff.url,
            image: '',
            source: `fastfood_${ff.slug}`,
            date_found: TODAY,
          });
        }
      } catch (e) {}
    }

    log(`    ${ff.name}: ${[...seen].length} items`);
  }

  log(`  Fast food apps total: ${items.length} items`);
  return items;
}

async function scrapeWeeklyAds() {
  log('Scraping weekly grocery ads...');
  const items = [];

  // Try weeklyad.com
  const html = await fetchPage('https://www.weeklyad.com/');
  if (html) {
    const cardRegex = /<a[^>]+href="(https?:\/\/www\.weeklyad\.com\/[^"]+)"[^>]*>[\s\S]*?<[^>]*>([^<]{10,200})<\/[^>]*>/g;
    let m;
    const seen = new Set();
    while ((m = cardRegex.exec(html)) !== null) {
      const link = m[1];
      const title = decodeEntities(stripHtml(m[2]).trim());
      if (seen.has(link) || title.length < 10) continue;
      seen.add(link);
      items.push({
        title: title,
        description: '',
        category: 'Grocery Coupons',
        brand: guessBrand(title),
        discount: guessDiscount(title),
        promo_code: '',
        expiry: '',
        link,
        image: '',
        source: 'weeklyad',
        date_found: TODAY,
      });
    }
    log(`  weeklyad.com: ${items.length} items`);
  } else {
    log('  weeklyad.com: FAILED');
  }

  // Fallback: try flipp.com popular flyers
  if (items.length === 0) {
    log('  Trying flipp.com fallback...');
    const flippHtml = await fetchPage('https://flipp.com/weekly-ads');
    if (flippHtml) {
      const flyerRegex = /<a[^>]+href="(\/[^"]*flyer[^"]*)"[^>]*>[\s\S]*?<[^>]*>([^<]{5,150})<\/[^>]*>/gi;
      let m;
      const seen = new Set();
      while ((m = flyerRegex.exec(flippHtml)) !== null) {
        const link = 'https://flipp.com' + m[1];
        const title = decodeEntities(stripHtml(m[2]).trim());
        if (seen.has(link) || title.length < 5) continue;
        seen.add(link);
        items.push({
          title: `Weekly Ad: ${title}`,
          description: '',
          category: 'Grocery Coupons',
          brand: guessBrand(title),
          discount: '',
          promo_code: '',
          expiry: '',
          link,
          image: '',
          source: 'weeklyad',
          date_found: TODAY,
        });
      }
      log(`  flipp.com: ${items.length} items`);
    } else {
      log('  flipp.com: FAILED');
    }
  }

  log(`  Weekly ads total: ${items.length} items`);
  return items;
}

// --- BATCH 2: NEW SOURCES ---

async function scrapeEatDrinkDeals() {
  log('Scraping EatDrinkDeals (RSS)...');
  const items = [];
  const xml = await fetchPage('https://www.eatdrinkdeals.com/feed/');
  if (!xml) { log('  EatDrinkDeals: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push({
      title: decodeEntities(rss.title),
      description: stripHtml(rss.description || '').slice(0, 200),
      category: 'Restaurant Deals',
      brand: guessBrand(rss.title),
      discount: guessDiscount(rss.title + ' ' + (rss.description || '')),
      promo_code: guessPromoCode(rss.title + ' ' + (rss.description || '')),
      expiry: '',
      link: rss.link,
      image: '',
      source: 'eatdrinkdeals',
      date_found: rss.pubDate ? new Date(rss.pubDate).toISOString().slice(0, 10) : TODAY,
    });
  }
  log(`  EatDrinkDeals: ${items.length} items`);
  return items;
}

async function scrapeDealNewsFood() {
  log('Scraping DealNews Food & Drink (RSS)...');
  const items = [];
  const xml = await fetchPage('https://www.dealnews.com/rss/c213/');
  if (!xml) { log('  DealNews Food: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push(makeDeal({
      title: decodeEntities(rss.title),
      description: stripHtml(rss.description || '').slice(0, 200),
      category: 'Restaurant Deals',
      link: rss.link,
      source: 'dealnews',
      date_found: rss.pubDate ? new Date(rss.pubDate).toISOString().slice(0, 10) : TODAY,
    }));
  }
  log(`  DealNews Food: ${items.length} items`);
  return items;
}

async function scrapeClarkDeals() {
  log('Scraping Clark Deals Food (RSS)...');
  const items = [];
  const xml = await fetchPage('https://clarkdeals.com/feed/');
  if (!xml) { log('  ClarkDeals: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const text = (rss.title + ' ' + (rss.description || '')).toLowerCase();
    // Only food-related items
    const foodSignal = ['food', 'eat', 'restaurant', 'pizza', 'burger', 'chicken', 'taco', 'coffee',
      'free fry', 'free drink', 'doordash', 'uber eats', 'grubhub', 'mcdonald', 'wendy',
      'starbucks', 'dunkin', 'chipotle', 'sandwich', 'meal', 'dinner', 'lunch', 'breakfast',
      'grocery', 'coupon', 'bogo', 'freebie'].some(kw => text.includes(kw));
    if (!foodSignal) continue;
    items.push(makeDeal({
      title: decodeEntities(rss.title),
      description: stripHtml(rss.description || '').slice(0, 200),
      category: 'Restaurant Deals',
      link: rss.link,
      source: 'clarkdeals',
      date_found: rss.pubDate ? new Date(rss.pubDate).toISOString().slice(0, 10) : TODAY,
    }));
  }
  log(`  ClarkDeals Food: ${items.length} items`);
  return items;
}

async function scrapeYoFreeSamples() {
  log('Scraping Yo Free Samples (RSS)...');
  const items = [];
  const xml = await fetchPage('https://yofreesamples.com/feed/');
  if (!xml) { log('  YoFreeSamples: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const text = (rss.title + ' ' + (rss.description || '')).toLowerCase();
    const foodSignal = ['food', 'snack', 'drink', 'coffee', 'tea', 'candy', 'chocolate', 'chip',
      'cookie', 'cereal', 'yogurt', 'bar', 'sauce', 'spice', 'seasoning', 'protein',
      'juice', 'soda', 'water', 'energy drink', 'beer', 'wine', 'pizza', 'burger',
      'free sample', 'free box', 'free pack'].some(kw => text.includes(kw));
    if (!foodSignal) continue;
    items.push(makeDeal({
      title: decodeEntities(rss.title),
      description: stripHtml(rss.description || '').slice(0, 200),
      category: 'Free Food',
      link: rss.link,
      source: 'yofreesamples',
      date_found: rss.pubDate ? new Date(rss.pubDate).toISOString().slice(0, 10) : TODAY,
    }));
  }
  log(`  YoFreeSamples Food: ${items.length} items`);
  return items;
}

async function scrapeRedditFastFood() {
  log('Scraping Reddit r/fastfood...');
  const items = [];
  const data = await fetchPage('https://www.reddit.com/r/fastfood/.json');
  if (!data) { log('  r/fastfood: FAILED'); return items; }
  try {
    const json = JSON.parse(data);
    const posts = json.data.children || [];
    for (const p of posts) {
      const d = p.data;
      if (!d || d.stickied) continue;
      const title = d.title || '';
      const text = (title + ' ' + (d.selftext || '')).toLowerCase();
      // Focus on deals/promos/freebies
      const dealSignal = ['deal', 'free', 'coupon', 'promo', 'bogo', 'discount', 'offer',
        'app', 'reward', 'special', 'limited time', 'new item', 'price'].some(kw => text.includes(kw));
      if (!dealSignal) continue;
      items.push(makeDeal({
        title: title.slice(0, 120),
        description: (d.selftext || '').slice(0, 200),
        category: 'Restaurant Deals',
        link: d.url || `https://reddit.com${d.permalink}`,
        source: 'reddit_fastfood',
        date_found: d.created_utc ? new Date(d.created_utc * 1000).toISOString().slice(0, 10) : TODAY,
      }));
    }
  } catch (e) { log('  r/fastfood: parse error'); }
  log(`  r/fastfood: ${items.length} deal items`);
  return items;
}

async function scrapeRedditFreebiesFood() {
  log('Scraping Reddit r/freebies (food filter)...');
  const items = [];
  const data = await fetchPage('https://www.reddit.com/r/freebies/.json');
  if (!data) { log('  r/freebies: FAILED'); return items; }
  try {
    const json = JSON.parse(data);
    const posts = json.data.children || [];
    for (const p of posts) {
      const d = p.data;
      if (!d || d.stickied) continue;
      const text = ((d.title || '') + ' ' + (d.selftext || '') + ' ' + (d.link_flair_text || '')).toLowerCase();
      const foodSignal = ['food', 'snack', 'drink', 'coffee', 'tea', 'pizza', 'burger', 'taco',
        'chicken', 'fry', 'sandwich', 'donut', 'cookie', 'ice cream', 'candy', 'chocolate',
        'cereal', 'sample', 'mcdonald', 'wendy', 'starbucks', 'dunkin', 'chipotle',
        'restaurant', 'meal', 'eat', 'grocery'].some(kw => text.includes(kw));
      if (!foodSignal) continue;
      items.push(makeDeal({
        title: (d.title || '').slice(0, 120),
        description: (d.selftext || '').slice(0, 200),
        category: 'Free Food',
        link: d.url || `https://reddit.com${d.permalink}`,
        source: 'reddit_freebies',
        date_found: d.created_utc ? new Date(d.created_utc * 1000).toISOString().slice(0, 10) : TODAY,
      }));
    }
  } catch (e) { log('  r/freebies: parse error'); }
  log(`  r/freebies food: ${items.length} items`);
  return items;
}

async function scrapePassionForSavings() {
  log('Scraping Passion for Savings Grocery (RSS)...');
  const items = [];
  const xml = await fetchPage('https://www.passionforsavings.com/feed/');
  if (!xml) { log('  PassionForSavings: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const text = (rss.title + ' ' + (rss.description || '')).toLowerCase();
    const foodSignal = ['food', 'grocery', 'coupon', 'freebie', 'free sample', 'restaurant',
      'pizza', 'snack', 'cereal', 'drink', 'coffee', 'meal', 'recipe',
      'kroger', 'walmart', 'target', 'aldi', 'publix', 'costco'].some(kw => text.includes(kw));
    if (!foodSignal) continue;
    items.push(makeDeal({
      title: decodeEntities(rss.title),
      description: stripHtml(rss.description || '').slice(0, 200),
      category: 'Grocery Coupons',
      link: rss.link,
      source: 'passionforsavings',
      date_found: rss.pubDate ? new Date(rss.pubDate).toISOString().slice(0, 10) : TODAY,
    }));
  }
  log(`  PassionForSavings: ${items.length} food items`);
  return items;
}

// === DEDUPLICATION ===
function deduplicateDeals(allItems) {
  const seen = new Set();
  const unique = [];
  for (const item of allItems) {
    // Create a normalized key from title
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (key.length < 5) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

// === MAIN ===
async function main() {
  log('=== Food Deals Scraper Started ===');

  // Ensure directories exist
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });

  // Run all scrapers
  const results = await Promise.allSettled([
    scrapeHip2SaveFood(),
    scrapeKrazyCouponLady(),
    scrapeRetailMeNotFood(),
    scrapeCouponsDotCom(),
    scrapeRestaurantDotCom(),
    scrapeRetailMeNotBrand('doordash.com', 'doordash', 'DoorDash'),
    scrapeRetailMeNotBrand('ubereats.com', 'ubereats', 'Uber Eats'),
    scrapeRetailMeNotBrand('grubhub.com', 'grubhub', 'Grubhub'),
    scrapeFreebieGuyFood(),
    scrapeRedditFreeFood(),
    scrapeSlickdealsFood(),
    scrapeBensBargainsFood(),
    scrapeRedditSubFiltered('deals', 'reddit_deals'),
    scrapeRedditSubFiltered('coupons', 'reddit_coupons'),
    scrapePennyHoarderFood(),
    scrapeOffersComFood(),
    scrapeDealsPlusFood(),
    scrapeFastFoodAppDeals(),
    scrapeWeeklyAds(),
    // Batch 2: new sources
    scrapeEatDrinkDeals(),
    scrapeDealNewsFood(),
    scrapeClarkDeals(),
    scrapeYoFreeSamples(),
    scrapeRedditFastFood(),
    scrapeRedditFreebiesFood(),
    scrapePassionForSavings(),
  ]);

  // Collect all items
  let allItems = [];
  const sourceNames = [
    'hip2save', 'krazycouponlady', 'retailmenot', 'coupons_com',
    'restaurantdotcom', 'doordash', 'ubereats', 'grubhub',
    'freebieguy', 'reddit',
    'slickdeals', 'bensbargains', 'reddit_deals', 'reddit_coupons',
    'pennyhoarder', 'offers_com', 'dealsplus', 'fastfood_apps', 'weeklyads',
    'eatdrinkdeals', 'dealnews', 'clarkdeals', 'yofreesamples',
    'reddit_fastfood', 'reddit_freebies', 'passionforsavings',
  ];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allItems = allItems.concat(result.value);
    } else {
      log(`  ${sourceNames[i]}: ERROR - ${result.reason || 'unknown'}`);
    }
  }

  log(`\nTotal raw items: ${allItems.length}`);

  // Deduplicate
  let unique = deduplicateDeals(allItems);
  log(`After dedup: ${unique.length} unique deals`);

  // === FOOD RELEVANCE FILTER ===
  // Remove items that are clearly not food-related
  const FOOD_KEYWORDS = [
    'food', 'eat', 'meal', 'restaurant', 'pizza', 'burger', 'chicken', 'taco', 'fry', 'fries',
    'sandwich', 'coffee', 'drink', 'beer', 'wine', 'soda', 'juice', 'smoothie', 'tea',
    'breakfast', 'lunch', 'dinner', 'brunch', 'snack', 'appetizer', 'dessert', 'ice cream',
    'donut', 'bagel', 'sushi', 'ramen', 'noodle', 'pasta', 'salad', 'soup', 'steak',
    'bbq', 'barbecue', 'grill', 'bogo', 'free fry', 'free drink', 'free meal',
    'mcdonald', 'wendy', 'chick-fil-a', 'taco bell', 'burger king', 'subway', 'chipotle',
    'popeyes', 'domino', 'papa john', 'little caesars', 'sonic', 'arby', 'jack in the box',
    'kfc', 'panera', 'five guys', 'shake shack', 'panda express', 'wingstop', 'buffalo wild',
    'olive garden', 'applebee', 'chili', 'denny', 'ihop', 'waffle house', 'cracker barrel',
    'starbucks', 'dunkin', 'krispy kreme', 'baskin', 'dairy queen', 'jamba',
    'doordash', 'uber eats', 'ubereats', 'grubhub', 'instacart', 'gopuff',
    'grocery', 'supermarket', 'walmart', 'kroger', 'target food', 'costco food', 'aldi',
    'trader joe', 'whole foods', 'publix', 'safeway', 'albertson',
    'coupon', 'promo code', 'discount code', 'off your order', '% off', 'buy one get',
    'free delivery', 'free shipping on food', 'birthday freebie', 'app deal', 'app offer',
    'recipe', 'cooking', 'chef', 'kitchen', 'bakery', 'deli', 'seafood', 'wings',
    'nugget', 'hot dog', 'pretzel', 'cookie', 'cake', 'pie', 'candy', 'chocolate',
    'cereal', 'yogurt', 'cheese', 'bread', 'milk', 'egg',
  ];
  const NOT_FOOD = [
    '3d printer', 'chromebook', 'laptop', 'computer', 'projector', 'camera', 'monitor',
    'headphone', 'speaker', 'keyboard', 'mouse', 'printer', 'router', 'modem',
    'fragrance', 'cosmetic', 'makeup', 'skincare', 'perfume',
    'auto accessor', 'car part', 'tire', 'motor oil',
    'baby monitor', 'child safety', 'stroller',
    'action cam', 'console', 'handheld', 'gaming',
    'mattress', 'furniture', 'vacuum', 'air purifier',
    'bank promotion', 'budgeting app', 'budgeting for', 'investment',
    'credit card', 'cashback', 'cash back', 'browser extension',
    'book', 'magazine', 'streaming', 'peacock', 'netflix', 'hulu',
    'hotel', 'flight', 'travel', 'luggage', 'vacation',
    'pet suppli', 'dog food', 'cat food', 'pet treat',
    'garden', 'diy', 'power tool', 'drill', 'saw',
    'clothing', 'shoe', 'sneaker', 'jacket', 'dress',
    'phone plan', 'wireless service', 'wi-fi',
    'tiktok shop', 'partner with us', 'severely ill',
    'dick\'s sporting', 'home depot', 'home goods', 'shutterfly', 'ferguson',
    'march madness', 'sports', 'outdoor',
    'subscription', 'tech & gadget', 'events & experience',
  ];

  const beforeFilter = unique.length;
  unique = unique.filter(item => {
    const text = ((item.title || '') + ' ' + (item.description || '') + ' ' + (item.brand || '')).toLowerCase();

    // Auto-reject if matches NOT_FOOD
    for (const nf of NOT_FOOD) {
      if (text.includes(nf)) return false;
    }

    // Auto-accept if from known food-specific sources
    const foodSources = ['fastfood_wendys', 'fastfood_mcdonalds', 'fastfood_chickfila', 'fastfood_tacobell', 'fastfood_bk', 'restaurantdotcom', 'doordash', 'ubereats', 'grubhub'];
    if (foodSources.includes(item.source)) return true;

    // Check if any food keyword matches
    for (const kw of FOOD_KEYWORDS) {
      if (text.includes(kw)) return true;
    }

    // Short generic titles with no food signal = reject
    if (text.length < 40) return false;

    return false; // If no food signal, reject
  });
  log(`Food relevance filter: ${beforeFilter} -> ${unique.length} (removed ${beforeFilter - unique.length} non-food items)`);

  // Sort by date found then category
  unique.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title));

  // Save results
  const output = {
    generated: new Date().toISOString(),
    total: unique.length,
    deals: unique,
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${RESULTS_FILE}`);

  fs.writeFileSync(SITE_DATA_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${SITE_DATA_FILE}`);

  // Console summary
  log('\n=== SUMMARY ===');
  const counts = {};
  const catCounts = {};
  for (const item of unique) {
    counts[item.source] = (counts[item.source] || 0) + 1;
    catCounts[item.category] = (catCounts[item.category] || 0) + 1;
  }

  log('By source:');
  for (const [src, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    log(`  ${src}: ${count}`);
  }

  log('By category:');
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    log(`  ${cat}: ${count}`);
  }

  log(`\nTotal unique deals: ${unique.length}`);
  log('=== Food Deals Scraper Complete ===');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
