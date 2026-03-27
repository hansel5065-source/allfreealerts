#!/usr/bin/env node
// AllFreeAlerts - Scrape + QA Review
// Run: node scrape_and_review.js
//
// Flow:
// 1. Scrapes all sources → saves to data/staging.json (NOT live yet)
// 2. Opens a review page in your browser where you can approve/reject items
// 3. Only approved items get added to data/results.json (the live data)
// 4. Copies approved data to site/data.json

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');
const STAGING_FILE = path.join(DATA_DIR, 'staging.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const SITE_DATA = path.join(__dirname, 'site', 'data.json');
const REVIEW_PORT = 3456;

// Step 1: Run the scraper (imports from scraper.js logic)
async function runScraper() {
  console.log('Running scraper...');
  return new Promise((resolve, reject) => {
    exec('node scraper.js', { cwd: __dirname, timeout: 300000 }, (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      if (err) reject(err);
      else resolve();
    });
  });
}

// Step 2: Load staging data (new items only)
function loadStaging() {
  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  // The scraper already merged new items into results.json
  // We'll serve them all for review, marking which are from today
  const today = new Date().toISOString().split('T')[0];
  return results.map(item => ({
    ...item,
    _isNew: item.date_found === today,
    _approved: true, // default: approved
  }));
}

// Step 3: Start review server
function startReviewServer(items) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buildReviewPage(items));
    } else if (req.method === 'GET' && req.url === '/api/items') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(items));
    } else if (req.method === 'POST' && req.url === '/api/approve') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const approved = JSON.parse(body);
          // Filter to only approved items, remove internal fields
          const live = approved.filter(i => i._approved).map(({ _isNew, _approved, ...rest }) => rest);
          fs.writeFileSync(RESULTS_FILE, JSON.stringify(live, null, 2));
          fs.copyFileSync(RESULTS_FILE, SITE_DATA);
          console.log(`\nApproved ${live.length} items. Saved to live data.`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: live.length }));
          setTimeout(() => { server.close(); process.exit(0); }, 1000);
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(REVIEW_PORT, () => {
    const url = `http://localhost:${REVIEW_PORT}`;
    console.log(`\n====================================`);
    console.log(`  REVIEW PAGE: ${url}`);
    console.log(`====================================`);
    console.log(`Open this in your browser to review items.`);
    console.log(`Approve or reject, then click "Publish".`);
    console.log(`Press Ctrl+C to cancel without publishing.\n`);

    // Auto-open in browser
    const cmd = process.platform === 'win32' ? `start ${url}` : `open ${url}`;
    exec(cmd);
  });
}

function buildReviewPage(items) {
  const newItems = items.filter(i => i._isNew);
  const existingItems = items.filter(i => !i._isNew);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AllFreeAlerts — Review New Items</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,sans-serif;background:#f5f5f5;color:#333;padding:1rem}
  .header{background:#0ABAB5;color:#fff;padding:1.5rem;border-radius:12px;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem}
  .header h1{font-size:1.4rem}
  .header .stats{display:flex;gap:1.5rem;font-size:0.9rem}
  .header .stats b{font-size:1.2rem}
  .actions{display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;position:sticky;top:0;background:#f5f5f5;padding:0.5rem 0;z-index:10}
  .btn{padding:0.5rem 1rem;border-radius:8px;border:1.5px solid #ddd;background:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.15s}
  .btn:hover{border-color:#0ABAB5}
  .btn.primary{background:#FF6F3C;color:#fff;border-color:#FF6F3C;font-size:1rem;padding:0.6rem 2rem}
  .btn.primary:hover{background:#E8612F}
  .btn.danger{color:#FF6B6B;border-color:#FF6B6B}
  .btn.danger:hover{background:#FFF0F0}
  .btn.success{color:#10B981;border-color:#10B981}
  .btn.success:hover{background:#ECFDF5}
  .section-label{font-size:1.1rem;font-weight:700;margin:1rem 0 0.5rem;display:flex;align-items:center;gap:0.5rem}
  .section-label .badge{background:#FF6F3C;color:#fff;padding:0.15rem 0.6rem;border-radius:100px;font-size:0.75rem}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
  th{background:#f8f9fa;text-align:left;padding:0.6rem 0.8rem;font-size:0.75rem;text-transform:uppercase;color:#666;border-bottom:1px solid #eee;position:sticky;top:42px;z-index:5}
  td{padding:0.5rem 0.8rem;border-bottom:1px solid #f3f3f3;font-size:0.85rem;vertical-align:top}
  tr.rejected{opacity:0.3;background:#fff0f0}
  tr:hover{background:#f8fffe}
  .link{color:#0ABAB5;word-break:break-all;font-size:0.78rem}
  .cat{font-size:0.7rem;font-weight:700;text-transform:uppercase;padding:0.15rem 0.4rem;border-radius:4px}
  .cat.sweep{color:#D97706;background:#FFF8EB}
  .cat.freebie{color:#059669;background:#ECFDF5}
  .cat.settle{color:#3B82F6;background:#EFF6FF}
  .toggle{width:28px;height:28px;border-radius:6px;border:2px solid #ddd;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1rem;transition:all 0.15s}
  .toggle.on{background:#ECFDF5;border-color:#10B981;color:#10B981}
  .toggle.off{background:#FFF0F0;border-color:#FF6B6B;color:#FF6B6B}
  .result{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;padding:2rem 3rem;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.2);text-align:center;font-size:1.2rem;font-weight:700;display:none;z-index:100}
  .filter-row{display:flex;gap:0.4rem;margin-bottom:0.5rem;flex-wrap:wrap}
  .filter-btn{padding:0.3rem 0.7rem;border-radius:100px;border:1px solid #ddd;background:#fff;font-size:0.78rem;cursor:pointer}
  .filter-btn.active{background:#0ABAB5;color:#fff;border-color:#0ABAB5}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>Review New Items</h1>
    <p style="font-size:0.85rem;opacity:0.9;margin-top:0.3rem">Check new items before they go live on AllFreeAlerts.com</p>
  </div>
  <div class="stats">
    <div>New today<br><b id="newCount">${newItems.length}</b></div>
    <div>Existing<br><b>${existingItems.length}</b></div>
    <div>Total<br><b>${items.length}</b></div>
  </div>
</div>

<div class="actions">
  <div class="filter-row">
    <button class="filter-btn active" onclick="filterCat('all')">All</button>
    <button class="filter-btn" onclick="filterCat('Sweepstakes')">Sweepstakes</button>
    <button class="filter-btn" onclick="filterCat('Freebies')">Freebies</button>
    <button class="filter-btn" onclick="filterCat('Settlements')">Settlements</button>
  </div>
  <div style="flex:1"></div>
  <button class="btn success" onclick="approveAll()">Approve All New</button>
  <button class="btn danger" onclick="rejectAll()">Reject All New</button>
  <button class="btn primary" onclick="publish()">Publish Live</button>
</div>

<div class="section-label">New Items <span class="badge">${newItems.length}</span></div>
<table>
<thead><tr><th style="width:36px"></th><th>Title</th><th>Category</th><th>Source</th><th>Link</th><th>Details</th></tr></thead>
<tbody id="newBody"></tbody>
</table>

<div class="section-label" style="margin-top:1.5rem">Existing Items (${existingItems.length})</div>
<p style="font-size:0.8rem;color:#999;margin-bottom:0.5rem">These are already live. Uncheck to remove.</p>
<table>
<thead><tr><th style="width:36px"></th><th>Title</th><th>Category</th><th>Source</th><th>Link</th></tr></thead>
<tbody id="existBody"></tbody>
</table>

<div class="result" id="result"></div>

<script>
let items = ${JSON.stringify(items)};

function renderRows() {
  const newItems = items.filter(i => i._isNew);
  const existItems = items.filter(i => !i._isNew);

  document.getElementById('newBody').innerHTML = newItems.map((item, idx) => {
    const realIdx = items.indexOf(item);
    const cls = {Sweepstakes:'sweep',Freebies:'freebie',Settlements:'settle'}[item.category]||'';
    const details = [item.payout?'$'+item.payout:'', item.deadline?'Due:'+item.deadline:'', item.prize_summary||''].filter(Boolean).join(' | ');
    return \`<tr class="\${item._approved?'':'rejected'}" data-idx="\${realIdx}">
      <td><button class="toggle \${item._approved?'on':'off'}" onclick="toggle(\${realIdx})">
        \${item._approved?'✓':'✗'}</button></td>
      <td><b>\${esc(item.title)}</b></td>
      <td><span class="cat \${cls}">\${item.category}</span></td>
      <td>\${item.source}</td>
      <td><a class="link" href="\${item.link}" target="_blank">\${item.link.substring(0,60)}...</a></td>
      <td style="font-size:0.78rem;color:#666">\${details}</td>
    </tr>\`;
  }).join('');

  document.getElementById('existBody').innerHTML = existItems.map((item, idx) => {
    const realIdx = items.indexOf(item);
    const cls = {Sweepstakes:'sweep',Freebies:'freebie',Settlements:'settle'}[item.category]||'';
    return \`<tr class="\${item._approved?'':'rejected'}" data-idx="\${realIdx}">
      <td><button class="toggle \${item._approved?'on':'off'}" onclick="toggle(\${realIdx})">
        \${item._approved?'✓':'✗'}</button></td>
      <td>\${esc(item.title)}</td>
      <td><span class="cat \${cls}">\${item.category}</span></td>
      <td>\${item.source}</td>
      <td><a class="link" href="\${item.link}" target="_blank">\${item.link.substring(0,60)}...</a></td>
    </tr>\`;
  }).join('');
}

function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function toggle(idx) {
  items[idx]._approved = !items[idx]._approved;
  renderRows();
}

function approveAll() {
  items.forEach(i => { if(i._isNew) i._approved = true; });
  renderRows();
}

function rejectAll() {
  items.forEach(i => { if(i._isNew) i._approved = false; });
  renderRows();
}

function filterCat(cat) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('tr[data-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.idx);
    if(cat === 'all' || items[idx].category === cat) tr.style.display = '';
    else tr.style.display = 'none';
  });
}

async function publish() {
  const approved = items.filter(i => i._approved).length;
  if(!confirm('Publish ' + approved + ' items live to AllFreeAlerts.com?')) return;

  const res = await fetch('/api/approve', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(items)
  });
  const data = await res.json();
  if(data.ok) {
    document.getElementById('result').style.display = 'block';
    document.getElementById('result').innerHTML = '✅ Published ' + data.count + ' items live!<br><br><span style="font-size:0.9rem;font-weight:400">You can close this tab.</span>';
  }
}

renderRows();
</script>
</body>
</html>`;
}

// Main flow
async function main() {
  try {
    await runScraper();
    console.log('\nScraper done. Loading items for review...');
    const items = loadStaging();
    startReviewServer(items);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
