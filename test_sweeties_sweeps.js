const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' },
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
  // === 1. Sweeties Sweeps RSS ===
  console.log('=== SWEETIES SWEEPS RSS ===');
  try {
    const r = await fetch('https://sweetiessweeps.com/feed/');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.html.includes('<item>')) {
      const items = r.html.match(/<item>([\s\S]*?)<\/item>/g) || [];
      console.log('RSS items:', items.length);

      for (let i = 0; i < Math.min(5, items.length); i++) {
        const item = items[i];
        const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
        const content = (item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || '';
        const desc = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || '';

        console.log(`\n  ${i+1}. ${title.substring(0, 70)}`);
        console.log(`     Article: ${link}`);
        console.log(`     Content length: ${content.length} | Desc length: ${desc.length}`);

        // Extract outbound links from content
        const allText = content || desc;
        if (allText.length > 0) {
          const linkRe = /href="(https?:\/\/[^"]+)"/g;
          const outbound = [];
          let m;
          while ((m = linkRe.exec(allText)) !== null) {
            const url = m[1].toLowerCase();
            if (!url.includes('sweetiessweeps') && !url.includes('facebook.com') &&
                !url.includes('twitter.com') && !url.includes('pinterest.com') &&
                !url.includes('instagram.com') && !url.includes('youtube.com') &&
                !url.includes('google.com') && !url.includes('.png') && !url.includes('.jpg') &&
                !url.includes('amazon.com') && !url.includes('wp-content') &&
                !url.includes('gravatar.com')) {
              outbound.push(m[1]);
            }
          }
          if (outbound.length > 0) {
            console.log(`     DIRECT LINKS: ${outbound.slice(0, 3).join(', ')}`);
          } else {
            console.log(`     (no direct links in RSS content)`);
          }
        }
      }
    } else {
      console.log('No RSS items. First 300:', r.html.substring(0, 300));
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 2. Sweeties Sweeps WP REST API ===
  console.log('\n\n=== SWEETIES SWEEPS WP REST API ===');
  try {
    const r = await fetch('https://sweetiessweeps.com/wp-json/wp/v2/posts?per_page=5');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.status === 200) {
      const posts = JSON.parse(r.html);
      console.log('Posts:', posts.length);
      for (const post of posts.slice(0, 3)) {
        console.log(`\n  Title: ${post.title?.rendered?.substring(0, 70) || 'N/A'}`);
        console.log(`  Link: ${post.link}`);
        console.log(`  Date: ${post.date}`);

        // Extract outbound links from content
        const content = post.content?.rendered || '';
        const linkRe = /href="(https?:\/\/[^"]+)"/g;
        const outbound = [];
        let m;
        while ((m = linkRe.exec(content)) !== null) {
          const url = m[1].toLowerCase();
          if (!url.includes('sweetiessweeps') && !url.includes('facebook') &&
              !url.includes('twitter') && !url.includes('pinterest') &&
              !url.includes('instagram') && !url.includes('youtube') &&
              !url.includes('google') && !url.includes('.png') && !url.includes('.jpg') &&
              !url.includes('amazon') && !url.includes('wp-content') &&
              !url.includes('gravatar')) {
            outbound.push(m[1]);
          }
        }
        console.log(`  Direct links: ${outbound.slice(0, 5).join(', ') || 'none'}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 3. I Love Giveaways ===
  console.log('\n\n=== I LOVE GIVEAWAYS ===');
  try {
    const r = await fetch('https://www.ilovegiveaways.com/');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare:', blocked);
    if (!blocked && r.html.length > 1000) {
      // Find giveaway links
      const re = /href="(https?:\/\/(?!(?:www\.)?ilovegiveaways)[^"]+)"[^>]*>([^<]{10,})/g;
      const links = [];
      let m;
      while ((m = re.exec(r.html)) !== null) {
        const url = m[1].toLowerCase();
        if (!url.includes('facebook') && !url.includes('twitter') && !url.includes('google') &&
            !url.includes('.css') && !url.includes('.js')) {
          links.push({ url: m[1], title: m[2].trim() });
        }
      }
      console.log('External links:', links.length);
      for (const l of links.slice(0, 5)) {
        console.log(`  - ${l.title.substring(0, 60)} -> ${l.url.substring(0, 70)}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 4. Online-Sweepstakes.com ===
  console.log('\n\n=== ONLINE-SWEEPSTAKES.COM ===');
  try {
    const r = await fetch('https://www.online-sweepstakes.com/');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare:', blocked);
    if (!blocked && r.html.length > 1000) {
      const re = /href="(https?:\/\/(?!(?:www\.)?online-sweepstakes)[^"]+)"[^>]*target[^>]*>([^<]{10,})/g;
      const links = [];
      let m;
      while ((m = re.exec(r.html)) !== null) {
        links.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Direct entry links:', links.length);
      for (const l of links.slice(0, 5)) {
        console.log(`  - ${l.title.substring(0, 60)} -> ${l.url.substring(0, 70)}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 5. Sweeties Sweeps category feeds ===
  console.log('\n\n=== SWEETIES SWEEPS CATEGORY FEEDS ===');
  const categories = ['sweepstakes', 'instant-win', 'coupons'];
  for (const cat of categories) {
    try {
      const r = await fetch(`https://sweetiessweeps.com/category/${cat}/feed/`);
      console.log(`${cat}: status=${r.status} length=${r.html.length} items=${(r.html.match(/<item>/g) || []).length}`);
    } catch (e) { console.log(`${cat}: Error - ${e.message}`); }
  }
})();
