const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : 'https://www.sweepsadvantage.com' + res.headers.location;
        return fetch(loc).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    }).on('error', reject);
  });
}

(async () => {
  // Test detail pages
  const detailPages = [
    '/sweepstakes-1530385.html',  // Lynyrd Skynyrd concert
    '/sweepstakes-1525546.html',  // P&G Brand
    '/sweepstakes-1530270.html',  // 72 Hour Wins $150 Visa
    '/sweepstakes-1529413.html',  // Culvers Instant Win
  ];

  for (const page of detailPages) {
    console.log(`\n=== ${page} ===`);
    try {
      const r = await fetch('https://www.sweepsadvantage.com' + page);
      console.log('Status:', r.status, '| Length:', r.html.length);
      if (r.status !== 200) continue;

      // Find the direct entry link
      const entryRe = /href="(https?:\/\/(?!(?:www\.)?sweepsadvantage)[^"]+)"[^>]*(?:target="_blank"|rel="nofollow")[^>]*>/g;
      const entryLinks = [];
      let m;
      while ((m = entryRe.exec(r.html)) !== null) {
        const url = m[1];
        if (!url.includes('facebook') && !url.includes('twitter') && !url.includes('google') &&
            !url.includes('pinterest') && !url.includes('sweepstakesplus') &&
            !url.includes('.js') && !url.includes('.css')) {
          entryLinks.push(url);
        }
      }
      console.log('Direct entry links:', entryLinks);

      // Find end date
      const endRe = /(?:end|expir|deadline|closes?)[^<]*?(\d{1,2}\/\d{1,2}\/\d{2,4}|\w+ \d{1,2},?\s*\d{4})/gi;
      while ((m = endRe.exec(r.html)) !== null) {
        console.log('End date match:', m[0].substring(0, 80));
      }

      // Look for structured info
      const infoRe = /class="sweepstake-info[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
      while ((m = infoRe.exec(r.html)) !== null) {
        const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 5) console.log('Info block:', text.substring(0, 200));
      }

      // Look for title
      const titleRe = /<h1[^>]*>([^<]+)/;
      const titleMatch = r.html.match(titleRe);
      if (titleMatch) console.log('Title:', titleMatch[1].trim());

      // Show the sweepstakes content area
      const contentStart = r.html.indexOf('sweepstake-description');
      if (contentStart > -1) {
        const snippet = r.html.substring(contentStart, contentStart + 1500);
        const text = snippet.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim();
        console.log('Content:\n' + text.substring(0, 600));
      }

      // Look for the "Enter" button/link
      const enterRe = /href="([^"]+)"[^>]*>[^<]*(?:enter|visit|go to|claim|play)[^<]*/gi;
      while ((m = enterRe.exec(r.html)) !== null) {
        console.log('Enter link:', m[0].substring(0, 100), '->', m[1].substring(0, 80));
      }

    } catch (e) { console.log('Error:', e.message); }
  }

  // === Count total sweepstakes available from listing page ===
  console.log('\n\n=== TOTAL AVAILABLE ===');
  try {
    const r = await fetch('https://www.sweepsadvantage.com/daily-sweepstakes.html');
    if (r.status === 200) {
      // Count sweepstakes-{number}.html links
      const sweepRe = /\/sweepstakes-(\d+)\.html/g;
      const ids = new Set();
      let m;
      while ((m = sweepRe.exec(r.html)) !== null) ids.add(m[1]);
      console.log('Daily sweepstakes on page:', ids.size);

      // Count direct entry links (target=_blank nofollow)
      const directRe = /href="(https?:\/\/[^"]+)"[^>]*target="_blank"[^>]*rel="nofollow"/g;
      const directLinks = [];
      while ((m = directRe.exec(r.html)) !== null) {
        if (!m[1].includes('sweepsadvantage') && !m[1].includes('sweepstakesplus')) {
          directLinks.push(m[1]);
        }
      }
      console.log('Direct entry links on page:', directLinks.length);
      // Show unique domains
      const domains = new Set(directLinks.map(u => { try { return new URL(u).hostname; } catch(e) { return u; } }));
      console.log('Unique domains:', [...domains].slice(0, 20).join(', '));
    }
  } catch (e) { console.log('Error:', e.message); }

})();
