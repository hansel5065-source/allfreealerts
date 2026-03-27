#!/usr/bin/env node
// One-time: fetch og:image for existing items missing images
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, 'data', 'results.json');
const SITE_DATA = path.join(__dirname, 'site', 'data.json');

function fetchPage(url, timeout = 8000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchPage(resolved, timeout).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

function extractImage(html) {
  const og = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (og && og[1].startsWith('http')) return og[1];
  const tw = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
  if (tw && tw[1].startsWith('http')) return tw[1];
  return null;
}

async function main() {
  const items = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const needImage = items.filter(i => !i.image);
  console.log(`${needImage.length}/${items.length} items need images. Fetching in batches of 20...`);

  let found = 0, failed = 0, done = 0;
  for (let i = 0; i < needImage.length; i += 20) {
    const batch = needImage.slice(i, i + 20);
    await Promise.all(batch.map(async (item) => {
      try {
        const html = await fetchPage(item.link);
        if (html) {
          const img = extractImage(html);
          if (img) { item.image = img; found++; }
          else failed++;
        } else failed++;
      } catch (e) { failed++; }
      done++;
      if (done % 50 === 0) console.log(`  Progress: ${done}/${needImage.length} (${found} images found)`);
    }));
  }

  console.log(`\nDone! Found ${found} images, ${failed} had no og:image`);
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(items, null, 2));
  fs.copyFileSync(RESULTS_FILE, SITE_DATA);
  console.log('Saved to results.json and site/data.json');
}

main();
