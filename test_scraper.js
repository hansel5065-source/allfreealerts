// Test the scraper logic locally (mirrors scraper_code_node.js)
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

// Fetch without following redirects — returns {statusCode, location}
function fetchNoRedirect(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.contestgirl.com/",
      }
    }, (res) => {
      res.resume(); // drain the response
      resolve({ statusCode: res.statusCode, location: res.headers.location || null });
    });
    req.on('error', () => resolve({ statusCode: 0, location: null }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ statusCode: 0, location: null }); });
  });
}

function parseRssItems(xml) {
  return (xml.match(/<item>([\s\S]*?)<\/item>/g) || []).map(item => ({
    title: (item.match(/<title>(.*?)<\/title>/) || [])[1] || '',
    link: (item.match(/<link>(.*?)<\/link>/) || [])[1] || '',
    categories: (item.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>/g) || [])
      .map(c => c.replace(/<category><!\[CDATA\[|\]\]><\/category>/g, '')),
  }));
}

function extractOutboundLink(html, excludeDomain) {
  const linkRegex = /href="(https?:\/\/[^"]+)"/g;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const url = m[1].toLowerCase();
    if (url.includes(excludeDomain)) continue;
    if (url.includes('facebook.com') || url.includes('twitter.com') || url.includes('instagram.com') ||
        url.includes('pinterest.com') || url.includes('youtube.com') || url.includes('google.com') ||
        url.includes('google-analytics.com') || url.includes('googletagmanager.com') ||
        url.includes('googlesyndication.com') || url.includes('googleadservices.com') ||
        url.includes('doubleclick.net') || url.includes('gstatic.com') ||
        url.includes('linkedin.com') || url.includes('tiktok.com') || url.includes('reddit.com') ||
        url.includes('apple.com/app') || url.includes('play.google.com') ||
        url.includes('amazon.com/gp/') || url.includes('amzn.to') ||
        url.includes('.css') || url.includes('.js') || url.includes('.png') || url.includes('.jpg') ||
        url.includes('.gif') || url.includes('.svg') || url.includes('.woff') ||
        url.includes('wp-content') || url.includes('wp-json') || url.includes('cdn.') ||
        url.includes('gravatar.com') || url.includes('cloudflare.com') || url.includes('googleapis.com') ||
        url.includes('shareaholic') || url.includes('addtoany') || url.includes('sharethis') ||
        url.includes('disqus.com') || url.includes('w.org') || url.includes('wordpress.org') ||
        url.includes('schema.org') || url.includes('creativecommons.org') ||
        url.includes('feeds.feedburner') || url.includes('feedburner.com')) continue;
    return m[1];
  }
  return null;
}

async function resolveInBatches(items, resolver, batchSize) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(resolver));
  }
}

async function main() {
  const results = [];
  console.log('=== FREE-FOR-ALL SCRAPER TEST (with direct link resolution) ===\n');

  // CONTESTGIRL
  console.log('--- CONTESTGIRL (6 feeds, HTML + redirect resolution) ---');
  const cgItems = [];
  const cgFeeds = ['s', 'd', 'w', 'o', 'g', 'f'];
  for (const f of cgFeeds) {
    const category = f === 'f' ? 'Freebies' : 'Sweepstakes';
    const html = await fetchPage(`https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=${f}&s=_&sort=p`);
    if (!html) { console.log(`  feed=${f}: FAILED`); continue; }
    const listingRegex = /<td class="padded"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
    let match, count = 0;
    while ((match = listingRegex.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/<a[^>]*href="\/sweepstakes\/countHits\.pl\?[^"]*"[^>]*rel="nofollow">([^<]+)<\/a><\/b>/);
      if (!titleMatch) continue;
      const linkMatch = block.match(/href="(\/sweepstakes\/countHits\.pl\?[^"]*)"/);
      count++;
      cgItems.push({
        title: titleMatch[1],
        redirectUrl: linkMatch ? 'https://www.contestgirl.com' + linkMatch[1] : '',
        link: '',
      });
    }
    console.log(`  feed=${f}: ${count} items`);
  }
  console.log(`  Resolving ${cgItems.length} redirect URLs...`);
  let resolved = 0;
  await resolveInBatches(cgItems, async (item) => {
    if (!item.redirectUrl) return;
    const resp = await fetchNoRedirect(item.redirectUrl);
    if (resp.location) {
      item.link = resp.location;
      resolved++;
    } else {
      item.link = item.redirectUrl;
    }
  }, 10);
  console.log(`  Resolved ${resolved}/${cgItems.length} to direct URLs`);
  if (cgItems.length > 0) {
    console.log(`  Sample: "${cgItems[0].title}" -> ${cgItems[0].link}`);
  }
  cgItems.forEach(i => results.push({ source: 'contestgirl', title: i.title, link: i.link }));

  // SWEEPSTAKES FANATICS (RSS + follow articles)
  console.log('\n--- SWEEPSTAKES FANATICS (RSS + article follow) ---');
  {
    const sfItems = [];
    const xml = await fetchPage("https://sweepstakesfanatics.com/feed/");
    if (xml) {
      const items = parseRssItems(xml).filter(i => i.title && i.link && !i.categories.some(c => c.toLowerCase().includes('expired')));
      items.forEach(i => sfItems.push({ title: i.title, articleUrl: i.link, link: i.link }));
      console.log(`  ${sfItems.length} RSS items`);
      console.log(`  Following articles for direct links...`);
      let directCount = 0;
      await resolveInBatches(sfItems, async (item) => {
        const html = await fetchPage(item.articleUrl);
        if (!html) return;
        const direct = extractOutboundLink(html, 'sweepstakesfanatics.com');
        if (direct) { item.link = direct; directCount++; }
      }, 10);
      console.log(`  Found direct links for ${directCount}/${sfItems.length} items`);
      if (sfItems.length > 0) console.log(`  Sample: "${sfItems[0].title}" -> ${sfItems[0].link}`);
    } else console.log('  FAILED');
    sfItems.forEach(i => results.push({ source: 'sweepstakesfanatics', title: i.title, link: i.link }));
  }

  // FREEBIE SHARK (HTML + follow articles)
  console.log('\n--- FREEBIE SHARK (HTML + article follow) ---');
  {
    const fsItems = [];
    const feeds = [
      { cat: "Freebies", url: "https://freebieshark.com/" },
      { cat: "Sweepstakes", url: "https://freebieshark.com/category/sweepstakes/" },
    ];
    for (const feed of feeds) {
      const html = await fetchPage(feed.url);
      if (!html) { console.log(`  ${feed.cat}: FAILED`); continue; }
      const regex = /<h2 class="headline">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/g;
      let m, count = 0;
      while ((m = regex.exec(html)) !== null) {
        count++;
        fsItems.push({ title: decodeEntities(m[2].trim()), articleUrl: m[1], link: m[1] });
      }
      console.log(`  ${feed.cat}: ${count} items`);
    }
    console.log(`  Following ${fsItems.length} articles for direct links...`);
    let directCount = 0;
    await resolveInBatches(fsItems, async (item) => {
      const html = await fetchPage(item.articleUrl);
      if (!html) return;
      const direct = extractOutboundLink(html, 'freebieshark.com');
      if (direct) { item.link = direct; directCount++; }
    }, 5);
    console.log(`  Found direct links for ${directCount}/${fsItems.length} items`);
    fsItems.slice(0, 2).forEach(i => console.log(`  "${i.title.substring(0, 50)}" -> ${i.link}`));
    fsItems.forEach(i => results.push({ source: 'freebieshark', title: i.title, link: i.link }));
  }

  // FREEFLYS (RSS + follow articles)
  console.log('\n--- FREEFLYS (RSS + article follow) ---');
  {
    const ffItems = [];
    const xml = await fetchPage("https://www.freeflys.com/feed/");
    if (xml) {
      const items = parseRssItems(xml).filter(i => i.title && i.link);
      items.forEach(i => ffItems.push({ title: i.title, articleUrl: i.link, link: i.link }));
      console.log(`  ${ffItems.length} RSS items`);
      let directCount = 0;
      await resolveInBatches(ffItems, async (item) => {
        const html = await fetchPage(item.articleUrl);
        if (!html) return;
        const direct = extractOutboundLink(html, 'freeflys.com');
        if (direct) { item.link = direct; directCount++; }
      }, 5);
      console.log(`  Found direct links for ${directCount}/${ffItems.length} items`);
      ffItems.slice(0, 2).forEach(i => console.log(`  "${i.title}" -> ${i.link}`));
    } else console.log('  FAILED');
    ffItems.forEach(i => results.push({ source: 'freeflys', title: i.title, link: i.link }));
  }

  // HIP2SAVE (RSS - kept as article links)
  console.log('\n--- HIP2SAVE (RSS, article links - too many to follow) ---');
  {
    const xml = await fetchPage("https://hip2save.com/freebies/feed/");
    if (xml) {
      const items = parseRssItems(xml).filter(i => i.title && i.link);
      items.forEach(i => results.push({ source: 'hip2save', title: i.title, link: i.link }));
      console.log(`  ${items.length} items (article links, not direct)`);
    } else console.log('  FAILED');
  }

  // CLASSACTION.ORG (with details, real deadlines only)
  console.log('\n--- CLASSACTION.ORG (real deadlines only, with details) ---');
  {
    const html = await fetchPage("https://www.classaction.org/settlements");
    if (html) {
      const cardBlocks = html.split(/class="[^"]*settlement-card[^"]*"/);
      let active = 0, skipped = 0;
      for (let i = 1; i < cardBlocks.length; i++) {
        const block = cardBlocks[i].substring(0, 3000);
        const prevEnd = cardBlocks[i - 1].slice(-200);
        const deadlineMatch = prevEnd.match(/data-deadline="(\d+)"/);
        const daysLeft = deadlineMatch ? parseInt(deadlineMatch[1]) : null;
        if (daysLeft === 9999 || daysLeft === null) { skipped++; continue; }

        const linkMatch = block.match(/<a\s+href="([^"]+)"\s+class="js-settlement-link[^"]*"[^>]*>([^<]+)<\/a>/);
        if (!linkMatch) { skipped++; continue; }

        const payoutMatch = block.match(/Payout<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
        const deadlineDateMatch = block.match(/Deadline<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
        const proofMatch = block.match(/Required\?<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
        const descMatch = block.match(/<p class="f6 lh-copy[^"]*">([^<]+)<\/p>/);

        let deadlineDate = deadlineDateMatch ? deadlineDateMatch[1].trim() : "";
        if (deadlineDate) {
          const parsed = new Date(deadlineDate);
          if (!isNaN(parsed.getTime()) && parsed < new Date()) { skipped++; continue; }
        }

        active++;
        const entry = {
          source: 'classaction',
          title: decodeEntities(linkMatch[2].trim()),
          link: linkMatch[1],
          deadline: deadlineDate,
          payout: payoutMatch ? payoutMatch[1].trim() : "",
          proof_required: proofMatch ? proofMatch[1].trim() : "",
        };
        results.push(entry);
        if (active <= 5) {
          console.log(`  "${entry.title}"`);
          console.log(`    Link: ${entry.link}`);
          console.log(`    Deadline: ${entry.deadline} | Payout: ${entry.payout} | Proof: ${entry.proof_required}`);
        }
      }
      console.log(`  ACTIVE: ${active} | SKIPPED (varies/expired): ${skipped}`);
    } else console.log('  FAILED');
  }

  // SUMMARY
  const counts = {};
  results.forEach(r => { counts[r.source] = (counts[r.source] || 0) + 1; });
  console.log('\n=== SUMMARY ===');
  let total = 0;
  for (const [src, cnt] of Object.entries(counts)) {
    console.log(`  ${src}: ${cnt}`);
    total += cnt;
  }
  console.log(`  TOTAL: ${total}`);

  // Show how many have direct vs middleman links
  let directLinks = 0, middlemanLinks = 0;
  for (const r of results) {
    if (r.source === 'hip2save') { middlemanLinks++; continue; }
    if (r.link && !r.link.includes('contestgirl.com') && !r.link.includes('sweepstakesfanatics.com') &&
        !r.link.includes('freebieshark.com') && !r.link.includes('freeflys.com')) {
      directLinks++;
    } else {
      middlemanLinks++;
    }
  }
  console.log(`\n  DIRECT LINKS: ${directLinks}`);
  console.log(`  MIDDLEMAN LINKS: ${middlemanLinks} (mostly hip2save)`);
}

main().catch(console.error);
