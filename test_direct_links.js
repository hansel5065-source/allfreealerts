// Test direct link extraction approaches
const https = require('https');
const http = require('http');

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014');
}

function fetchPage(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (d.includes("Just a moment") || d.includes("500 Server Error")) resolve(null);
        else resolve(d);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}

// Fetch a URL but do NOT follow redirects. Return { statusCode, location, body }.
function fetchNoRedirect(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          location: res.headers.location || null,
          body: d,
        });
      });
    });
    req.on('error', (e) => resolve({ statusCode: 0, location: null, body: 'ERROR: ' + e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ statusCode: 0, location: null, body: 'TIMEOUT' }); });
  });
}

// Extract outbound links from HTML content, excluding a given domain
function extractOutboundLinks(html, excludeDomain) {
  const linkRegex = /href="(https?:\/\/[^"]+)"/gi;
  const links = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const url = m[1];
    if (!url.includes(excludeDomain)) {
      links.push(url);
    }
  }
  return links;
}

async function main() {
  console.log('=== DIRECT LINK RESOLUTION TESTS ===\n');

  // -------------------------------------------------------
  // 1. CONTESTGIRL REDIRECT RESOLUTION
  // -------------------------------------------------------
  console.log('--- 1. CONTESTGIRL REDIRECT RESOLUTION ---');
  {
    const html = await fetchPage('https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=s&s=_&sort=p');
    if (!html) {
      console.log('  FAILED to fetch Contestgirl listing page');
    } else {
      // Extract redirect URLs using same regex as test_scraper.js
      const redirectUrls = [];
      const linkRegex = /href="(\/sweepstakes\/countHits\.pl\?[^"]*)"/g;
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        redirectUrls.push(m[1]);
      }
      console.log(`  Found ${redirectUrls.length} redirect URLs on page`);

      const toTest = redirectUrls.slice(0, 3);
      for (const path of toTest) {
        const fullUrl = 'https://www.contestgirl.com' + path;
        const resp = await fetchNoRedirect(fullUrl);
        console.log(`\n  Redirect URL: ${path}`);
        console.log(`  HTTP Status:  ${resp.statusCode}`);
        if (resp.location) {
          console.log(`  REAL URL:     ${resp.location}`);
        } else {
          console.log(`  No Location header found (body length: ${resp.body.length})`);
        }
      }
    }
  }

  // -------------------------------------------------------
  // 2. SWEEPSTAKES FANATICS - RSS <content:encoded> parsing
  // -------------------------------------------------------
  console.log('\n\n--- 2. SWEEPSTAKES FANATICS - content:encoded PARSING ---');
  {
    const xml = await fetchPage('https://sweepstakesfanatics.com/feed/');
    if (!xml) {
      console.log('  FAILED to fetch RSS feed');
    } else {
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      console.log(`  Found ${items.length} items in feed`);

      const toTest = items.slice(0, 5);
      for (const item of toTest) {
        const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const cleanTitle = decodeEntities(title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')).substring(0, 70);

        // Try content:encoded first, fall back to description
        let content = (item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || [])[1] || '';
        if (!content) {
          content = (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
        }
        // Unescape CDATA
        content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1');
        // Also decode HTML entities for hrefs
        content = decodeEntities(content);

        const outbound = extractOutboundLinks(content, 'sweepstakesfanatics.com');
        const firstLink = outbound.length > 0 ? outbound[0] : '(none found)';
        console.log(`\n  "${cleanTitle}"`);
        console.log(`    -> ${firstLink}`);
        if (outbound.length > 1) console.log(`       (${outbound.length} outbound links total)`);
      }
    }
  }

  // -------------------------------------------------------
  // 3. HIP2SAVE - RSS <content:encoded> parsing
  // -------------------------------------------------------
  console.log('\n\n--- 3. HIP2SAVE - content:encoded PARSING ---');
  {
    const xml = await fetchPage('https://hip2save.com/freebies/feed/');
    if (!xml) {
      console.log('  FAILED to fetch RSS feed');
    } else {
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      console.log(`  Found ${items.length} items in feed`);

      const toTest = items.slice(0, 5);
      for (const item of toTest) {
        const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
        const cleanTitle = decodeEntities(title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')).substring(0, 70);

        let content = (item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || [])[1] || '';
        if (!content) {
          content = (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
        }
        content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1');
        content = decodeEntities(content);

        const outbound = extractOutboundLinks(content, 'hip2save.com');
        const firstLink = outbound.length > 0 ? outbound[0] : '(none found)';
        console.log(`\n  "${cleanTitle}"`);
        console.log(`    -> ${firstLink}`);
        if (outbound.length > 1) console.log(`       (${outbound.length} outbound links total)`);
      }
    }
  }

  // -------------------------------------------------------
  // 4. FREEBIE SHARK - article page follow
  // -------------------------------------------------------
  console.log('\n\n--- 4. FREEBIE SHARK - ARTICLE PAGE FOLLOW ---');
  {
    const html = await fetchPage('https://freebieshark.com/');
    if (!html) {
      console.log('  FAILED to fetch Freebie Shark homepage');
    } else {
      const articleRegex = /<h2 class="headline">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/g;
      const articles = [];
      let m;
      while ((m = articleRegex.exec(html)) !== null && articles.length < 3) {
        articles.push({ url: m[1], title: decodeEntities(m[2].trim()) });
      }
      console.log(`  Found ${articles.length} article URLs to follow`);

      for (const article of articles) {
        console.log(`\n  Article: "${article.title.substring(0, 70)}"`);
        console.log(`  Page:    ${article.url}`);

        const pageHtml = await fetchPage(article.url);
        if (!pageHtml) {
          console.log(`    FAILED to fetch article page`);
          continue;
        }

        const outbound = extractOutboundLinks(pageHtml, 'freebieshark.com');
        // Filter out common non-deal links (social media, CDNs, etc.)
        const filtered = outbound.filter(u =>
          !u.includes('facebook.com') &&
          !u.includes('twitter.com') &&
          !u.includes('instagram.com') &&
          !u.includes('pinterest.com') &&
          !u.includes('youtube.com') &&
          !u.includes('google.com') &&
          !u.includes('gravatar.com') &&
          !u.includes('wp.com') &&
          !u.includes('wordpress.com') &&
          !u.includes('w3.org') &&
          !u.includes('schema.org') &&
          !u.includes('creativecommons.org') &&
          !u.includes('google-analytics.com') &&
          !u.includes('googleapis.com') &&
          !u.includes('gstatic.com') &&
          !u.includes('addtoany.com') &&
          !u.includes('disqus.com') &&
          !u.includes('cloudflare.com') &&
          !u.includes('jsdelivr.net') &&
          !u.includes('cdnjs.com')
        );

        if (filtered.length > 0) {
          console.log(`    Outbound links (${filtered.length}):`);
          filtered.slice(0, 5).forEach(u => console.log(`      -> ${u}`));
          if (filtered.length > 5) console.log(`      ... and ${filtered.length - 5} more`);
        } else {
          console.log(`    No outbound deal links found (${outbound.length} total links, all filtered)`);
        }
      }
    }
  }

  console.log('\n\n=== DONE ===');
}

main().catch(console.error);
