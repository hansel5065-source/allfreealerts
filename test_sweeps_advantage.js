const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
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
  const pages = [
    '/new-sweepstakes',
    '/daily-sweepstakes.html',
    '/one-entry-sweepstakes.html',
    '/cash-sweepstakes',
    '/instant-win-sweepstakes',
  ];

  for (const page of pages) {
    console.log(`\n=== ${page} ===`);
    try {
      const r = await fetch('https://www.sweepsadvantage.com' + page);
      console.log('Status:', r.status, '| Length:', r.html.length);
      if (r.status !== 200 || r.html.length < 5000) continue;

      // Check for Cloudflare
      if (r.html.includes('Just a moment')) { console.log('CLOUDFLARE BLOCKED'); continue; }

      // Find sweepstakes entries - look for links with titles
      // First, let's see what HTML structure they use
      const sampleIdx = r.html.indexOf('sweeps-title') || r.html.indexOf('sweepstakes-title') ||
                        r.html.indexOf('entry-link') || r.html.indexOf('list-item');

      // Try to find external contest links (target=_blank often means outbound)
      const extRe = /href="(https?:\/\/(?!(?:www\.)?sweepsadvantage)[^"]+)"[^>]*>([^<]{5,})/g;
      const extLinks = [];
      let m;
      while ((m = extRe.exec(r.html)) !== null) {
        const url = m[1].toLowerCase();
        if (!url.includes('facebook') && !url.includes('twitter') && !url.includes('google') &&
            !url.includes('pinterest') && !url.includes('.css') && !url.includes('.js') &&
            !url.includes('instagram') && !url.includes('youtube') &&
            m[2].trim().length > 10) {
          extLinks.push({ url: m[1], title: m[2].trim() });
        }
      }
      console.log('External links (potential direct entries):', extLinks.length);
      for (const l of extLinks.slice(0, 8)) {
        console.log(`  - ${l.title.substring(0, 60)} -> ${l.url.substring(0, 70)}`);
      }

      // Find internal detail page links
      const intRe = /href="(\/[^"]+)"[^>]*>([^<]{15,})/g;
      const intLinks = [];
      while ((m = intRe.exec(r.html)) !== null) {
        const url = m[1];
        if (!url.includes('.js') && !url.includes('.css') && !url.includes('amember') &&
            !url.includes('forum') && !url.includes('help') && !url.includes('blog') &&
            !url.includes('newsletter') && !url.includes('rules') && !url.includes('law') &&
            !url.includes('signup') && !url.includes('login') &&
            m[2].trim().length > 15) {
          intLinks.push({ url: url, title: m[2].trim() });
        }
      }
      console.log('Internal detail links:', intLinks.length);
      for (const l of intLinks.slice(0, 8)) {
        console.log(`  - ${l.title.substring(0, 60)} -> ${l.url.substring(0, 60)}`);
      }

      // Show some raw HTML around where sweepstakes might be listed
      // Look for common listing patterns
      const patterns = ['class="sweeps', 'class="entry', 'class="listing', 'class="card',
                       'class="item', 'class="row', 'enter-link', 'btn-enter'];
      for (const pat of patterns) {
        const idx = r.html.indexOf(pat);
        if (idx > -1) {
          console.log(`\nFound pattern "${pat}" at ${idx}:`);
          console.log(r.html.substring(Math.max(0, idx - 50), idx + 300));
          break;
        }
      }
    } catch (e) { console.log('Error:', e.message); }
  }

  // === Also test a detail page to see if it has direct link ===
  console.log('\n\n=== SWEEPSTAKES ADVANTAGE - DETAIL PAGE TEST ===');
  try {
    // First find a detail page URL from the new-sweepstakes page
    const r = await fetch('https://www.sweepsadvantage.com/new-sweepstakes');
    if (r.status === 200) {
      // Find first detail page link
      const detailRe = /href="(\/offer[^"]*|\/sweepstakes\/[^"]*)"[^>]*>([^<]+)/g;
      let m;
      const details = [];
      while ((m = detailRe.exec(r.html)) !== null) {
        details.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Detail page links found:', details.length);

      if (details.length === 0) {
        // Try broader pattern
        const broadRe = /href="(\/[a-z0-9-]+\/[^"]+)"[^>]*>([^<]{10,})/g;
        while ((m = broadRe.exec(r.html)) !== null) {
          if (!m[1].includes('.js') && !m[1].includes('.css') && !m[1].includes('amember') &&
              !m[1].includes('forum') && !m[1].includes('tpl')) {
            details.push({ url: m[1], title: m[2].trim() });
          }
        }
        console.log('Broader detail links:', details.length);
        for (const d of details.slice(0, 5)) {
          console.log(`  ${d.title.substring(0, 60)} -> ${d.url}`);
        }
      }

      // Fetch first detail page
      if (details.length > 0) {
        const detailUrl = 'https://www.sweepsadvantage.com' + details[0].url;
        console.log('\nFetching detail:', detailUrl);
        const dr = await fetch(detailUrl);
        console.log('Status:', dr.status, '| Length:', dr.html.length);

        // Find the direct entry link
        const entryRe = /href="(https?:\/\/(?!(?:www\.)?sweepsadvantage)[^"]+)"[^>]*>([^<]*(?:enter|visit|go to|click here|official)[^<]*)/gi;
        while ((m = entryRe.exec(dr.html)) !== null) {
          console.log(`  Entry link: ${m[2].trim()} -> ${m[1].substring(0, 80)}`);
        }
      }
    }
  } catch (e) { console.log('Error:', e.message); }
})();
