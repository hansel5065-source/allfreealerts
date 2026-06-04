#!/usr/bin/env node
/**
 * SEO content injector — makes deal content crawlable.
 *
 * The site renders deals client-side from an XOR-obfuscated data.json, so
 * crawlers (and AdSense's content review) see an near-empty shell. This script
 * injects a curated, current set of REAL deal listings (title + summary +
 * official link) into the crawlable <noscript> fallback of each page, between
 * idempotent markers, so it can be re-run every deploy.
 *
 * Outbound deal links use rel="nofollow sponsored" so Google doesn't read the
 * page as a link farm passing PageRank to thousands of external sites.
 *
 * Run after cleanup, before deploy:  node build_seo_content.js
 */
const fs = require('fs');
const path = require('path');

const RESULTS = path.join(__dirname, 'data', 'results.json');
const SITE = path.join(__dirname, 'site');
const START = '<!--SEO_DEALS_START-->';
const END = '<!--SEO_DEALS_END-->';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function newest(items, n) {
  return [...items]
    .sort((a, b) => String(b.date_found || '').localeCompare(String(a.date_found || '')))
    .slice(0, n);
}

function listHtml(items) {
  const li = items.map(it => {
    const title = esc(it.title);
    const desc = esc((it.prize_summary || it.description || '').slice(0, 220));
    const link = esc(it.link);
    return `        <li style="margin-bottom:0.75rem"><a href="${link}" rel="nofollow sponsored" style="color:#0ABAB5;font-weight:600">${title}</a>${desc ? ` &mdash; ${desc}` : ''}</li>`;
  }).join('\n');
  return `<ul style="color:#636E72;padding-left:1.25rem;list-style:disc">\n${li}\n      </ul>`;
}

function block(heading, items, blurb) {
  return `${START}
      <h3 style="margin:2rem 0 0.5rem">${heading}</h3>
      <p style="color:#636E72;margin-bottom:0.75rem">${blurb}</p>
      ${listHtml(items)}
      ${END}`;
}

function inject(file, blockHtml) {
  const fp = path.join(SITE, file);
  if (!fs.existsSync(fp)) { console.log(`  SKIP ${file} (not found)`); return false; }
  let html = fs.readFileSync(fp, 'utf8');
  const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (re.test(html)) {
    html = html.replace(re, blockHtml);
  } else {
    // insert just before the closing </noscript>
    const idx = html.indexOf('</noscript>');
    if (idx === -1) { console.log(`  SKIP ${file} (no <noscript> region)`); return false; }
    html = html.slice(0, idx) + '\n      ' + blockHtml + '\n  ' + html.slice(idx);
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

  // Homepage: combined block with newest deals from all three categories
  // (curated subset, not the full dataset — preserves anti-bulk-scrape)
  const homeCombined = `${START}
      <h3 style="margin:2rem 0 0.5rem">Latest Sweepstakes &amp; Giveaways</h3>
      <p style="color:#636E72;margin-bottom:0.75rem">A sample of the newest active sweepstakes we're tracking. Each links to the official entry page.</p>
      ${listHtml(newest(sweeps, 12))}
      <h3 style="margin:2rem 0 0.5rem">Latest Free Samples</h3>
      <p style="color:#636E72;margin-bottom:0.75rem">Recently added freebies from real brands &mdash; no purchase, no card required.</p>
      ${listHtml(newest(free, 8))}
      <h3 style="margin:2rem 0 0.5rem">Newly Opened Settlements</h3>
      <p style="color:#636E72;margin-bottom:0.75rem">Open class-action claims you may be eligible for. Each links to the official claim form.</p>
      ${listHtml(newest(settle, 12))}
      ${END}`;

  const results = [];
  results.push(['index.html', inject('index.html', homeCombined)]);
  results.push(['sweepstakes.html', inject('sweepstakes.html',
    block('Latest Active Sweepstakes', newest(sweeps, 40),
      'A current sample of active sweepstakes. Enable JavaScript to search and filter the full list.'))]);
  results.push(['freebies.html', inject('freebies.html',
    block('Latest Free Samples', newest(free, 40),
      'A current sample of active freebies. Enable JavaScript to search and filter the full list.'))]);
  results.push(['settlements.html', inject('settlements.html',
    block('Newly Opened Settlements', newest(settle, 40),
      'A current sample of open settlement claims. Enable JavaScript to search and filter the full list.'))]);

  console.log(`[SEO] Sweeps:${sweeps.length} Freebies:${free.length} Settlements:${settle.length}`);
  results.forEach(([f, ok]) => console.log(`  ${ok ? 'OK  ' : 'SKIP'} ${f}`));
}

main();
