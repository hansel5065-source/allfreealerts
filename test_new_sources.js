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
      // Handle redirects
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
  // === 1. REDDIT r/sweepstakes RSS ===
  console.log('=== REDDIT r/sweepstakes ===');
  try {
    const r = await fetch('https://www.reddit.com/r/sweepstakes/.rss');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare blocked:', blocked);
    if (!blocked && r.html.length > 100) {
      // Parse RSS entries
      const entries = r.html.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
      console.log('Entries:', entries.length);
      for (let i = 0; i < Math.min(5, entries.length); i++) {
        const title = (entries[i].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
        const link = (entries[i].match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
        // Check for outbound links in content
        const content = (entries[i].match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
        const outbound = [];
        const re = /href="(https?:\/\/[^"]+)"/g;
        let m;
        while ((m = re.exec(content)) !== null) {
          if (!m[1].includes('reddit.com') && !m[1].includes('redd.it')) outbound.push(m[1]);
        }
        // Also check link tag for external URL
        const linkContent = (entries[i].match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
        console.log(`  ${i+1}. ${title.substring(0, 80)}`);
        console.log(`     Reddit: ${link}`);
        if (outbound.length > 0) console.log(`     Direct: ${outbound[0]}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 2. REDDIT r/freebies RSS ===
  console.log('\n=== REDDIT r/freebies ===');
  try {
    const r = await fetch('https://www.reddit.com/r/freebies/.rss');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare blocked:', blocked);
    if (!blocked && r.html.length > 100) {
      const entries = r.html.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
      console.log('Entries:', entries.length);
      for (let i = 0; i < Math.min(5, entries.length); i++) {
        const title = (entries[i].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
        const content = (entries[i].match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
        const outbound = [];
        const re = /href="(https?:\/\/[^"]+)"/g;
        let m;
        while ((m = re.exec(content)) !== null) {
          const url = m[1].replace(/&amp;/g, '&');
          if (!url.includes('reddit.com') && !url.includes('redd.it') && !url.includes('preview.redd')) outbound.push(url);
        }
        console.log(`  ${i+1}. ${title.substring(0, 80)}`);
        if (outbound.length > 0) console.log(`     Direct: ${outbound[0]}`);
        else console.log(`     (no direct link found)`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 3. SWEEPSTAKES ADVANTAGE ===
  console.log('\n=== SWEEPSTAKES ADVANTAGE ===');
  try {
    const r = await fetch('https://www.sweepsadvantage.com/');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare blocked:', blocked);
    if (!blocked && r.html.length > 1000) {
      // Look for contest links
      const linkRegex = /href="(\/contest[^"]*)"[^>]*>([^<]+)/g;
      const links = [];
      let m;
      while ((m = linkRegex.exec(r.html)) !== null) {
        links.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Contest links found:', links.length);
      for (let i = 0; i < Math.min(5, links.length); i++) {
        console.log(`  ${i+1}. ${links[i].title.substring(0, 80)}`);
        console.log(`     URL: ${links[i].url}`);
      }
      // Also check for any pattern with "sweepstakes" or "enter" links
      const allLinks = [];
      const allRe = /href="([^"]+)"[^>]*>([^<]{10,})/g;
      while ((m = allRe.exec(r.html)) !== null) {
        if (m[1].includes('sweepsadvantage.com') || m[1].startsWith('/')) {
          if (m[2].length > 15 && !m[2].includes('©')) {
            allLinks.push({ url: m[1], title: m[2].trim() });
          }
        }
      }
      console.log('All content links:', allLinks.length);
      for (let i = 0; i < Math.min(8, allLinks.length); i++) {
        console.log(`  ${i+1}. ${allLinks[i].title.substring(0, 80)} -> ${allLinks[i].url.substring(0, 60)}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 4. SWEEPSTAKES ADVANTAGE RSS ===
  console.log('\n=== SWEEPSTAKES ADVANTAGE RSS ===');
  try {
    const r = await fetch('https://www.sweepsadvantage.com/rss.xml');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.html.includes('<item>')) {
      const items = r.html.match(/<item>([\s\S]*?)<\/item>/g) || [];
      console.log('RSS items:', items.length);
      for (let i = 0; i < Math.min(5, items.length); i++) {
        const title = (items[i].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const link = (items[i].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
        console.log(`  ${i+1}. ${title.substring(0, 80)}`);
        console.log(`     ${link}`);
      }
    } else {
      console.log('No RSS items found. First 300:', r.html.substring(0, 300));
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 5. FTC REFUNDS ===
  console.log('\n=== FTC REFUNDS ===');
  try {
    const r = await fetch('https://www.ftc.gov/enforcement/refunds');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare blocked:', blocked);
    if (!blocked && r.html.length > 1000) {
      // Look for refund case links
      const caseLinks = [];
      const re = /href="([^"]*refund[^"]*)"[^>]*>([^<]+)/gi;
      let m;
      while ((m = re.exec(r.html)) !== null) {
        caseLinks.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Refund links:', caseLinks.length);
      // Also look for any settlement/case links
      const allRe = /href="(\/enforcement\/(?:cases|refunds)\/[^"]+)"[^>]*>([^<]+)/g;
      while ((m = allRe.exec(r.html)) !== null) {
        caseLinks.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Total case links:', caseLinks.length);
      for (const c of caseLinks.slice(0, 5)) {
        console.log(`  - ${c.title.substring(0, 80)} -> ${c.url.substring(0, 80)}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 6. TOP CLASS ACTIONS ===
  console.log('\n=== TOP CLASS ACTIONS ===');
  try {
    const r = await fetch('https://topclassactions.com/category/lawsuit-settlements/open-lawsuit-settlements/');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare blocked:', blocked);
    if (!blocked && r.html.length > 1000) {
      const re = /<h2[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)/g;
      const links = [];
      let m;
      while ((m = re.exec(r.html)) !== null) {
        links.push({ url: m[1], title: m[2].trim() });
      }
      console.log('Settlement articles:', links.length);
      for (const l of links.slice(0, 5)) {
        console.log(`  - ${l.title.substring(0, 80)}`);
        console.log(`    ${l.url}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 7. TOP CLASS ACTIONS RSS ===
  console.log('\n=== TOP CLASS ACTIONS RSS ===');
  try {
    const r = await fetch('https://topclassactions.com/feed/');
    console.log('Status:', r.status, '| Length:', r.html.length);
    if (r.html.includes('<item>')) {
      const items = r.html.match(/<item>([\s\S]*?)<\/item>/g) || [];
      console.log('RSS items:', items.length);
      for (let i = 0; i < Math.min(3, items.length); i++) {
        const title = (items[i].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const link = (items[i].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
        console.log(`  ${i+1}. ${title.substring(0, 80)}`);
        console.log(`     ${link}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

  // === 8. PRIZES.ORG ===
  console.log('\n=== PRIZES.ORG ===');
  try {
    const r = await fetch('https://prizes.org/');
    console.log('Status:', r.status, '| Length:', r.html.length);
    const blocked = r.html.includes('Just a moment');
    console.log('Cloudflare blocked:', blocked);
    if (!blocked && r.html.length > 1000) {
      const re = /href="([^"]+)"[^>]*>([^<]{15,})/g;
      const links = [];
      let m;
      while ((m = re.exec(r.html)) !== null) {
        if (!m[1].includes('twitter') && !m[1].includes('facebook') && m[2].trim().length > 15) {
          links.push({ url: m[1], title: m[2].trim() });
        }
      }
      console.log('Content links:', links.length);
      for (const l of links.slice(0, 8)) {
        console.log(`  - ${l.title.substring(0, 80)} -> ${l.url.substring(0, 60)}`);
      }
    }
  } catch (e) { console.log('Error:', e.message); }

})();
