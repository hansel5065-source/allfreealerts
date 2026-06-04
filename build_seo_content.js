#!/usr/bin/env node
/**
 * SEO content injector — makes deal content crawlable (Track A).
 *
 * The site renders deals client-side from an XOR-obfuscated data.json, so the
 * raw HTML crawlers/AdSense first see is an empty shell. This script seeds the
 * #grid container with REAL, visible server-rendered deal cards (title +
 * summary + official link) between idempotent markers. On load, the page's JS
 * (render(): g.innerHTML=h) overwrites #grid with the interactive version, so
 * this is seamless progressive enhancement — crawlers and no-JS users see real
 * content; JS users get the full app.
 *
 * Outbound links use rel="nofollow sponsored" so the page isn't read as a link
 * farm. Only a curated subset is rendered — the full dataset stays obfuscated.
 *
 * Run after cleanup, before deploy:  node build_seo_content.js
 */
const fs = require('fs');
const path = require('path');

const RESULTS = path.join(__dirname, 'data', 'results.json');
const SITE = path.join(__dirname, 'site');
const GS = '<!--SEO_GRID_START-->';
const GE = '<!--SEO_GRID_END-->';

const CLS = { Sweepstakes: 'sweep', Freebies: 'freebie', Settlements: 'settle' };
const EMOJI = { Sweepstakes: '🎰', Freebies: '🎁', Settlements: '⚖️' };

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function newest(items, n) {
  return [...items]
    .sort((a, b) => String(b.date_found || '').localeCompare(String(a.date_found || '')))
    .slice(0, n);
}

function card(it) {
  const cls = CLS[it.category] || 'freebie';
  const emoji = EMOJI[it.category] || '🎁';
  const title = esc(it.title);
  const desc = esc((it.prize_summary || it.description || '').slice(0, 200));
  const link = esc(it.link);
  const val = esc((it.payout || '').slice(0, 40));
  return `<div class="card">
        <div class="card-img-wrap"><div class="card-img-fallback ${cls}">${emoji}</div></div>
        <div class="card-body">
          <div class="card-cat ${cls}"><span class="card-cat-icon">${emoji}</span> ${esc(it.category)}</div>
          <a href="${link}" target="_blank" rel="nofollow sponsored" style="text-decoration:none;color:inherit"><div class="card-title">${title}</div></a>
          ${desc ? `<div class="card-desc">${desc}</div>` : ''}
          ${val ? `<div class="card-value money">${val}</div>` : ''}
        </div>
      </div>`;
}

function gridBlock(items) {
  return `${GS}\n      ${items.map(card).join('\n      ')}\n      ${GE}`;
}

function seedGrid(file, items) {
  const fp = path.join(SITE, file);
  if (!fs.existsSync(fp)) { console.log(`  SKIP ${file} (not found)`); return false; }
  let html = fs.readFileSync(fp, 'utf8');

  // 1. Remove any v1 noscript deal block (SEO_DEALS markers) to avoid duplicate titles
  const deals = new RegExp(rx('<!--SEO_DEALS_START-->') + '[\\s\\S]*?' + rx('<!--SEO_DEALS_END-->') + '\\s*');
  html = html.replace(deals, '');

  const block = gridBlock(items);

  // 2. Seed #grid: replace existing marker block, else the loading spinner
  const existing = new RegExp(rx(GS) + '[\\s\\S]*?' + rx(GE));
  if (existing.test(html)) {
    html = html.replace(existing, block);
  } else {
    const spinner = /<div class="loading"><div class="spinner"><\/div><br>Finding [^<]*<\/div>/;
    if (!spinner.test(html)) { console.log(`  SKIP ${file} (no grid spinner / markers)`); return false; }
    html = html.replace(spinner, block);
  }
  fs.writeFileSync(fp, html);
  return true;
}

function main() {
  const data = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  const byCat = c => data.filter(i => i.category === c && i.link);
  const sweeps = byCat('Sweepstakes');
  const free = byCat('Freebies');
  const settle = byCat('Settlements');

  // Homepage: interleaved mix of newest across categories (~28 cards)
  const home = [...newest(sweeps, 12), ...newest(free, 6), ...newest(settle, 12)]
    .sort((a, b) => String(b.date_found || '').localeCompare(String(a.date_found || '')));

  const r = [];
  r.push(['index.html', seedGrid('index.html', home)]);
  r.push(['sweepstakes.html', seedGrid('sweepstakes.html', newest(sweeps, 36))]);
  r.push(['freebies.html', seedGrid('freebies.html', newest(free, 36))]);
  r.push(['settlements.html', seedGrid('settlements.html', newest(settle, 36))]);

  console.log(`[SEO] Sweeps:${sweeps.length} Freebies:${free.length} Settlements:${settle.length}`);
  r.forEach(([f, ok]) => console.log(`  ${ok ? 'OK  ' : 'SKIP'} ${f}`));
}

main();
