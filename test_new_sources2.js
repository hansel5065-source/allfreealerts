const https = require('https');
const http = require('http');

function fetch(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

(async () => {
  // === 1. REDDIT JSON API (bypasses RSS block) ===
  console.log('=== REDDIT r/sweepstakes JSON ===');
  try {
    const r = await fetch('https://www.reddit.com/r/sweepstakes.json?limit=25');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.status === 200) {
      const data = JSON.parse(r.html);
      const posts = data.data.children || [];
      console.log('Posts:', posts.length);
      let directCount = 0;
      for (let i = 0; i < Math.min(10, posts.length); i++) {
        const p = posts[i].data;
        const isDirect = !p.is_self && p.url && !p.url.includes('reddit.com');
        if (isDirect) directCount++;
        console.log(`  ${i+1}. [${isDirect ? 'DIRECT' : 'self'}] ${p.title.substring(0, 70)}`);
        if (isDirect) console.log(`     -> ${p.url}`);
      }
      console.log(`\nDirect links: ${directCount}/${posts.length}`);
    }
  } catch (e) { console.log('Error:', e.message); }

  console.log('\n=== REDDIT r/freebies JSON ===');
  try {
    const r = await fetch('https://www.reddit.com/r/freebies.json?limit=25');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.status === 200) {
      const data = JSON.parse(r.html);
      const posts = data.data.children || [];
      console.log('Posts:', posts.length);
      let directCount = 0;
      for (let i = 0; i < Math.min(10, posts.length); i++) {
        const p = posts[i].data;
        const isDirect = !p.is_self && p.url && !p.url.includes('reddit.com');
        if (isDirect) directCount++;
        console.log(`  ${i+1}. [${isDirect ? 'DIRECT' : 'self'}] ${p.title.substring(0, 70)}`);
        if (isDirect) console.log(`     -> ${p.url}`);
      }
      console.log(`\nDirect links: ${directCount}/${posts.length}`);
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 2. SWEEPSTAKES ADVANTAGE - actual listing pages ===
  console.log('\n=== SWEEPSTAKES ADVANTAGE - LISTINGS ===');
  try {
    // Try their main sweepstakes listing page
    const r = await fetch('https://www.sweepsadvantage.com/sweeps.php');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.status === 200 && r.html.length > 1000) {
      // Look for sweepstakes entries - they use specific HTML patterns
      const entryRe = /href="(https?:\/\/[^"]+)"[^>]*target="_blank"[^>]*>([^<]+)/g;
      const entries = [];
      let m;
      while ((m = entryRe.exec(r.html)) !== null) {
        if (!m[1].includes('sweepsadvantage') && m[2].trim().length > 5) {
          entries.push({ url: m[1], title: m[2].trim() });
        }
      }
      console.log('Direct external links:', entries.length);
      for (const e of entries.slice(0, 10)) {
        console.log(`  - ${e.title.substring(0, 70)}`);
        console.log(`    ${e.url.substring(0, 80)}`);
      }

      // Also check for internal detail page links
      const detailRe = /href="(\/sweeps[^"]*)"[^>]*>([^<]{10,})/g;
      const details = [];
      while ((m = detailRe.exec(r.html)) !== null) {
        details.push({ url: m[1], title: m[2].trim() });
      }
      console.log('\nInternal detail links:', details.length);
      for (const d of details.slice(0, 5)) {
        console.log(`  - ${d.title.substring(0, 70)} -> ${d.url.substring(0, 60)}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // Try another listing URL pattern
  console.log('\n=== SWEEPSTAKES ADVANTAGE - DAILY ===');
  try {
    const r = await fetch('https://www.sweepsadvantage.com/type-daily.html');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.status === 200 && r.html.length > 1000) {
      const entryRe = /href="(https?:\/\/[^"]+)"[^>]*>([^<]{10,})/g;
      const entries = [];
      let m;
      while ((m = entryRe.exec(r.html)) !== null) {
        if (!m[1].includes('sweepsadvantage') && !m[1].includes('facebook') &&
            !m[1].includes('twitter') && !m[1].includes('google') && m[2].trim().length > 10) {
          entries.push({ url: m[1], title: m[2].trim() });
        }
      }
      console.log('External links:', entries.length);
      for (const e of entries.slice(0, 5)) {
        console.log(`  - ${e.title.substring(0, 70)} -> ${e.url.substring(0, 80)}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 3. FTC REFUNDS - deeper parse ===
  console.log('\n=== FTC REFUNDS - PARSED ===');
  try {
    const r = await fetch('https://www.ftc.gov/enforcement/refunds');
    if (r.status === 200) {
      // Look for refund case links with titles
      const caseRe = /href="(\/legal-library\/browse\/refunds[^"]*)"[^>]*>([^<]+)/g;
      const cases = [];
      let m;
      while ((m = caseRe.exec(r.html)) !== null) {
        if (m[2].trim().length > 5) cases.push({ url: 'https://www.ftc.gov' + m[1], title: m[2].trim() });
      }
      console.log('Refund cases (pattern 1):', cases.length);

      // Try another pattern
      const caseRe2 = /href="([^"]*)"[^>]*>\s*([^<]*(?:refund|settlement|claim)[^<]*)/gi;
      const cases2 = [];
      while ((m = caseRe2.exec(r.html)) !== null) {
        if (m[2].trim().length > 10) cases2.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Refund cases (pattern 2):', cases2.length);

      // Look for structured data / views
      const viewRe = /class="views-row[^"]*"[\s\S]*?href="([^"]+)"[^>]*>([^<]+)/g;
      const viewCases = [];
      while ((m = viewRe.exec(r.html)) !== null) {
        viewCases.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Refund cases (views-row):', viewCases.length);
      for (const c of viewCases.slice(0, 5)) {
        console.log(`  - ${c.title.substring(0, 70)} -> ${c.url.substring(0, 80)}`);
      }

      // Try to find any list-like structure
      const listRe = /<a[^>]*href="(\/enforcement\/refunds\/[^"]+)"[^>]*>([^<]+)/g;
      const listCases = [];
      while ((m = listRe.exec(r.html)) !== null) {
        listCases.push({ url: 'https://www.ftc.gov' + m[1], title: m[2].trim() });
      }
      console.log('Refund individual pages:', listCases.length);
      for (const c of listCases.slice(0, 8)) {
        console.log(`  - ${c.title.substring(0, 70)}`);
        console.log(`    ${c.url}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 4. TOP CLASS ACTIONS - parse settlement page ===
  console.log('\n=== TOP CLASS ACTIONS - OPEN SETTLEMENTS ===');
  try {
    const r = await fetch('https://topclassactions.com/category/lawsuit-settlements/open-lawsuit-settlements/');
    if (r.status === 200) {
      // WordPress - look for article titles
      const re = /<h[23][^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)/g;
      const articles = [];
      let m;
      while ((m = re.exec(r.html)) !== null) {
        articles.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Articles (entry-title):', articles.length);

      // Try other patterns
      const re2 = /<a[^>]*class="[^"]*post-title[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)/g;
      while ((m = re2.exec(r.html)) !== null) {
        articles.push({ url: m[1], title: m[2].trim() });
      }

      // Generic h2 a pattern
      const re3 = /<h2[^>]*>\s*<a href="(https:\/\/topclassactions\.com\/[^"]+)"[^>]*>([^<]+)/g;
      while ((m = re3.exec(r.html)) !== null) {
        articles.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Total articles:', articles.length);
      for (const a of articles.slice(0, 8)) {
        console.log(`  - ${a.title.substring(0, 80)}`);
        console.log(`    ${a.url.substring(0, 80)}`);
      }

      // Show a snippet of HTML to understand structure
      const idx = r.html.indexOf('open-lawsuit-settlements');
      if (idx > -1) {
        console.log('\nHTML near settlements:', r.html.substring(idx, idx + 500));
      }
    }
  } catch (e) { console.log('Error:', e.message); }

})();
