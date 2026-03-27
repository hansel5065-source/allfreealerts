const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const newUrl = res.headers.location.startsWith('http') ? res.headers.location : 'https://www.ftc.gov' + res.headers.location;
        return fetch(newUrl).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

(async () => {
  // === 1. Parse a few FTC refund detail pages for deadline/claim info ===
  const testPages = [
    'https://www.ftc.gov/enforcement/refunds/invitation-homes-settlement',
    'https://www.ftc.gov/enforcement/refunds/pyrex-refunds',
    'https://www.ftc.gov/enforcement/refunds/wealthpress-refunds',
  ];

  for (const url of testPages) {
    console.log(`\n=== ${url.split('/').pop()} ===`);
    try {
      const r = await fetch(url);
      console.log('Status:', r.status, '| Length:', r.html.length);

      // Look for deadline info
      const deadlineMatch = r.html.match(/deadline[^<]*<[^>]*>([^<]+)/i) ||
                           r.html.match(/claim[^<]*by[^<]*(\w+ \d+, \d{4})/i) ||
                           r.html.match(/(\w+ \d+, \d{4})[^<]*deadline/i);
      console.log('Deadline:', deadlineMatch ? deadlineMatch[1].trim() : 'not found');

      // Look for claim/refund links (external)
      const claimLinks = [];
      const re = /href="(https?:\/\/[^"]+)"[^>]*>([^<]*(?:claim|file|submit|refund)[^<]*)/gi;
      let m;
      while ((m = re.exec(r.html)) !== null) {
        if (!m[1].includes('ftc.gov')) claimLinks.push({ url: m[1], text: m[2].trim() });
      }
      console.log('External claim links:', claimLinks.length);
      for (const c of claimLinks) {
        console.log(`  - ${c.text} -> ${c.url.substring(0, 80)}`);
      }

      // Look for payout/amount info
      const amountMatch = r.html.match(/\$[\d,.]+\s*(?:million|billion|refund|payment|check)/i) ||
                         r.html.match(/(?:refund|payment|check)[^<]*\$[\d,.]+/i);
      console.log('Amount:', amountMatch ? amountMatch[0].trim().substring(0, 80) : 'not found');

      // Get the main content text (look for article body)
      const bodyMatch = r.html.match(/<article[^>]*>([\s\S]*?)<\/article>/) ||
                       r.html.match(/class="field--name-body"[^>]*>([\s\S]*?)<\/div>/);
      if (bodyMatch) {
        const text = bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        console.log('Body preview:', text.substring(0, 300));
      }
    } catch (e) { console.log('Error:', e.message); }
  }

  // === 2. Try Sweepstakes Advantage with correct URL ===
  console.log('\n\n=== SWEEPSTAKES ADVANTAGE - FINDING CORRECT URLS ===');
  try {
    const r = await fetch('https://www.sweepsadvantage.com/');
    // Find all internal navigation links to find sweepstakes listings
    const navRe = /href="(\/[^"]+)"[^>]*>([^<]+)/g;
    const navLinks = [];
    let m;
    while ((m = navRe.exec(r.html)) !== null) {
      const url = m[1].toLowerCase();
      if (url.includes('sweeps') || url.includes('contest') || url.includes('type-') ||
          url.includes('list') || url.includes('new') || url.includes('ending')) {
        navLinks.push({ url: m[1], text: m[2].trim() });
      }
    }
    console.log('Navigation links with sweeps/contest/type:');
    for (const n of navLinks) {
      console.log(`  ${n.text} -> ${n.url}`);
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 3. Try Sweepstakes Advantage search/new page ===
  console.log('\n=== SWEEPSTAKES ADVANTAGE - SEARCH ===');
  const saUrls = [
    'https://www.sweepsadvantage.com/new.html',
    'https://www.sweepsadvantage.com/sweepstakes.html',
    'https://www.sweepsadvantage.com/ending.html',
    'https://www.sweepsadvantage.com/search.php',
  ];
  for (const url of saUrls) {
    try {
      const r = await fetch(url);
      console.log(`${url.split('/').pop()}: status=${r.status} length=${r.html.length}`);
      if (r.status === 200 && r.html.length > 5000) {
        // Count external links (potential sweepstakes entries)
        const extRe = /href="(https?:\/\/(?!www\.sweepsadvantage)[^"]+)"/g;
        let count = 0;
        while (extRe.exec(r.html)) count++;
        console.log(`  External links: ${count}`);
      }
    } catch (e) { console.log(`${url.split('/').pop()}: Error - ${e.message}`); }
  }

  // === 4. Reddit old.reddit.com (sometimes less aggressive blocking) ===
  console.log('\n=== OLD REDDIT r/sweepstakes ===');
  try {
    const r = await fetch('https://old.reddit.com/r/sweepstakes/.rss');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.html.includes('<entry>')) {
      const entries = r.html.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
      console.log('Entries:', entries.length);
    } else if (r.html.includes('<item>')) {
      const items = r.html.match(/<item>([\s\S]*?)<\/item>/g) || [];
      console.log('Items:', items.length);
    } else {
      console.log('Format:', r.html.substring(0, 200));
    }
  } catch (e) { console.log('Error:', e.message); }

})();
