#!/usr/bin/env node
// AllFreeAlerts Daily Update
// Runs: scrape → check dead links → deploy
// Usage: node daily_update.js
// Requires: CLOUDFLARE_API_TOKEN env var (or .env file)

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load .env if present
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  }
}

function run(cmd, label) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`STEP: ${label}`);
  console.log('='.repeat(50));
  try {
    execSync(cmd, { cwd: __dirname, stdio: 'inherit', timeout: 300000 });
    console.log(`✓ ${label} complete`);
    return true;
  } catch (e) {
    console.error(`✗ ${label} failed: ${e.message}`);
    return false;
  }
}

async function main() {
  const start = Date.now();
  console.log(`AllFreeAlerts Daily Update — ${new Date().toISOString()}`);

  // Step 1: Scrape new items
  const scraped = run('node scraper.js', 'Scrape new items');
  if (!scraped) { console.log('Scraping failed, aborting.'); process.exit(1); }

  // Step 2: Check dead links
  run('node check_links.js', 'Check dead links');

  // Step 3: Get stats
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'results.json'), 'utf8'));
  const cats = {};
  for (const i of data) { cats[i.category] = (cats[i.category] || 0) + 1; }
  console.log(`\nTotal items: ${data.length}`);
  Object.entries(cats).forEach(([c, n]) => console.log(`  ${c}: ${n}`));

  // Step 4: Deploy to Cloudflare
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.log('\nNo CLOUDFLARE_API_TOKEN set, skipping deploy.');
  } else {
    run(`npx wrangler pages deploy site/ --project-name=allfreealerts`, 'Deploy to Cloudflare');
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nAll done in ${elapsed}s`);
}

main();
