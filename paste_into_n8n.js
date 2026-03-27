// PASTE THIS DIRECTLY INTO THE n8n CODE NODE
// Mode: Run Once for All Items

// Step 1: Separate input - sheet rows vs Contestgirl HTML from HTTP Request node
const existingLinks = new Set();
const cgHtmlPages = [];
for (const row of $input.all()) {
  if (row.json._isCgHtml && row.json.data) {
    // CG HTML page fetched by the HTTP Request node
    cgHtmlPages.push({ html: row.json.data, category: row.json.cgCategory || 'Sweepstakes' });
  } else if (row.json.link) {
    existingLinks.add(row.json.link.trim());
  }
}

// Step 2: Scrape all sources (with direct link resolution)
const scraped = [];
const self = this;

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014');
}

async function fetchPage(url) {
  try {
    const html = await self.helpers.httpRequest({
      method: 'GET', url,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      returnFullResponse: false,
      timeout: 15000,
    });
    if (typeof html !== 'string') return null;
    if (html.includes("Just a moment") || html.includes("500 Server Error")) return null;
    return html;
  } catch (e) { return null; }
}

// Resolve redirect URL without following (for Contestgirl direct links)
async function resolveRedirect(url) {
  try {
    const resp = await self.helpers.httpRequest({
      method: 'GET', url,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.contestgirl.com/",
      },
      returnFullResponse: true,
      maxRedirects: 0,
      ignoreHttpStatusErrors: true,
      timeout: 8000,
    });
    if (resp.headers && resp.headers.location) return resp.headers.location;
    if (resp.headers && resp.headers.Location) return resp.headers.Location;
    return null;
  } catch (e) {
    if (e.response && e.response.headers) {
      return e.response.headers.location || e.response.headers.Location || null;
    }
    return null;
  }
}

// Extract first significant outbound link from an article page
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
        url.includes('feeds.feedburner') || url.includes('feedburner.com') ||
        url.includes('gmpg.org') || url.includes('hip.attn.tv') || url.includes('attn.tv') ||
        url.includes('shophermedia.net') || url.includes('magik.ly') ||
        url.includes('apps.apple.com') || url.includes('itunes.apple.com')) continue;
    return m[1];
  }
  return null;
}

// Batch-resolve URLs with concurrency limit
async function resolveInBatches(items, resolver, batchSize) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(resolver));
  }
}

function parseRssItems(xml) {
  return (xml.match(/<item>([\s\S]*?)<\/item>/g) || []).map(item => ({
    title: (item.match(/<title>(.*?)<\/title>/) || [])[1] || '',
    link: (item.match(/<link>(.*?)<\/link>/) || [])[1] || '',
    categories: (item.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>/g) || [])
      .map(c => c.replace(/<category><!\[CDATA\[|\]\]><\/category>/g, '')),
  }));
}

// === CONTESTGIRL (parse HTML from HTTP Request node + resolve redirects) ===
try {
  const cgItems = [];
  for (const page of cgHtmlPages) {
    const html = page.html;
    if (!html || typeof html !== 'string') continue;
    if (html.includes("Just a moment") || html.includes("500 Server Error")) continue;
    const listingRegex = /<td class="padded"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
    let match;
    while ((match = listingRegex.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/<a[^>]*href="\/sweepstakes\/countHits\.pl\?[^"]*"[^>]*rel="nofollow">([^<]+)<\/a><\/b>/);
      if (!titleMatch) continue;
      const linkMatch = block.match(/href="(\/sweepstakes\/countHits\.pl\?[^"]*)"/);
      const endDateMatch = block.match(/<b>End Date:<\/b>\s*([^<]+)/);
      const prizeMatch = block.match(/<div style="margin-top:6px;margin-bottom:4px;font-size:15px;">([^<]+)<\/div>/);
      const restrictMatch = block.match(/<b>Restrictions:&nbsp;<\/b><\/td><td[^>]*>\s*([^<]+)/);
      const redirectUrl = linkMatch ? "https://www.contestgirl.com" + linkMatch[1] : "";
      cgItems.push({
        title: decodeEntities(titleMatch[1].replace(/--/g, " - ").trim()),
        link: redirectUrl,
        source: "contestgirl", category: page.category,
        end_date: endDateMatch ? endDateMatch[1].trim() : "",
        prize_summary: prizeMatch ? prizeMatch[1].trim() : "",
        eligibility: restrictMatch ? restrictMatch[1].trim() : "",
      });
    }
  }
  // Try to resolve redirects to direct contest links (best effort)
  try {
    await resolveInBatches(cgItems, async (item) => {
      if (!item.link) return;
      try {
        const resolved = await resolveRedirect(item.link);
        if (resolved) item.link = resolved;
      } catch (e) { /* keep redirect URL */ }
    }, 10);
  } catch (e) { /* redirect resolution failed, keep redirect URLs */ }
  for (const item of cgItems) {
    scraped.push(item);
  }
} catch (e) { /* contestgirl section failed entirely */ }

// === SWEEPSTAKES FANATICS (RSS + follow article for direct link) ===
{
  const sfItems = [];
  const xml = await fetchPage("https://sweepstakesfanatics.com/feed/");
  if (xml) {
    for (const item of parseRssItems(xml)) {
      if (!item.title || !item.link) continue;
      if (item.categories.some(c => c.toLowerCase().includes('expired'))) continue;
      sfItems.push({
        title: decodeEntities(item.title.trim()),
        articleUrl: item.link.trim(),
        link: item.link.trim(),
        source: "sweepstakesfanatics", category: "Sweepstakes",
      });
    }
  }
  await resolveInBatches(sfItems, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const direct = extractOutboundLink(html, 'sweepstakesfanatics.com');
    if (direct) item.link = direct;
  }, 10);
  for (const item of sfItems) {
    const { articleUrl, ...rest } = item;
    scraped.push(rest);
  }
}

// === FREEBIE SHARK (HTML + follow article for direct link) ===
{
  const fsItems = [];
  const feeds = [
    { category: "Freebies", url: "https://freebieshark.com/" },
    { category: "Sweepstakes", url: "https://freebieshark.com/category/sweepstakes/" },
  ];
  for (const feed of feeds) {
    const html = await fetchPage(feed.url);
    if (!html) continue;
    const regex = /<h2 class="headline">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      fsItems.push({
        title: decodeEntities(m[2].trim()),
        articleUrl: m[1],
        link: m[1],
        source: "freebieshark", category: feed.category,
      });
    }
  }
  await resolveInBatches(fsItems, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const direct = extractOutboundLink(html, 'freebieshark.com');
    if (direct) item.link = direct;
  }, 10);
  for (const item of fsItems) {
    const { articleUrl, ...rest } = item;
    scraped.push(rest);
  }
}

// === FREEFLYS (RSS + follow article for direct link) ===
{
  const ffItems = [];
  const xml = await fetchPage("https://www.freeflys.com/feed/");
  if (xml) {
    for (const item of parseRssItems(xml)) {
      if (!item.title || !item.link) continue;
      ffItems.push({
        title: decodeEntities(item.title.trim()),
        articleUrl: item.link.trim(),
        link: item.link.trim(),
        source: "freeflys", category: "Freebies",
      });
    }
  }
  await resolveInBatches(ffItems, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    const direct = extractOutboundLink(html, 'freeflys.com');
    if (direct) item.link = direct;
  }, 5);
  for (const item of ffItems) {
    const { articleUrl, ...rest } = item;
    scraped.push(rest);
  }
}

// === HIP2SAVE (RSS freebies + follow article for direct link) ===
{
  const h2sItems = [];
  const xml = await fetchPage("https://hip2save.com/freebies/feed/");
  if (xml) {
    for (const item of parseRssItems(xml)) {
      if (!item.title || !item.link) continue;
      h2sItems.push({
        title: decodeEntities(item.title.trim()),
        articleUrl: item.link.trim(),
        link: item.link.trim(),
        source: "hip2save", category: "Freebies",
      });
    }
  }
  // Follow article pages to extract direct deal links from article body
  await resolveInBatches(h2sItems, async (item) => {
    const html = await fetchPage(item.articleUrl);
    if (!html) return;
    // Only look inside the article content area to avoid nav/sidebar junk
    const contentStart = html.indexOf('entry-content');
    if (contentStart === -1) return;
    const contentEnd = html.indexOf('</article', contentStart);
    const content = contentEnd > contentStart ? html.substring(contentStart, contentEnd) : html.substring(contentStart, contentStart + 10000);
    const direct = extractOutboundLink(content, 'hip2save.com');
    if (direct) item.link = direct;
  }, 20);
  for (const item of h2sItems) {
    const { articleUrl, ...rest } = item;
    scraped.push(rest);
  }
}

// === CLASSACTION.ORG (settlements with real deadlines + details) ===
{
  const html = await fetchPage("https://www.classaction.org/settlements");
  if (html) {
    const cardBlocks = html.split(/class="[^"]*settlement-card[^"]*"/);
    for (let i = 1; i < cardBlocks.length; i++) {
      const block = cardBlocks[i].substring(0, 3000);
      const prevEnd = cardBlocks[i - 1].slice(-200);
      const deadlineMatch = prevEnd.match(/data-deadline="(\d+)"/);
      const daysLeft = deadlineMatch ? parseInt(deadlineMatch[1]) : null;
      if (daysLeft === 9999 || daysLeft === null) continue;

      const linkMatch = block.match(/<a\s+href="([^"]+)"\s+class="js-settlement-link[^"]*"[^>]*>([^<]+)<\/a>/);
      if (!linkMatch) continue;

      const payoutMatch = block.match(/Payout<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
      const deadlineDateMatch = block.match(/Deadline<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
      const proofMatch = block.match(/Required\?<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
      const descMatch = block.match(/<p class="f6 lh-copy[^"]*">([^<]+)<\/p>/);

      let deadlineDate = deadlineDateMatch ? deadlineDateMatch[1].trim() : "";
      if (deadlineDate) {
        const parsed = new Date(deadlineDate);
        if (!isNaN(parsed.getTime()) && parsed < new Date()) continue;
      }

      scraped.push({
        title: decodeEntities(linkMatch[2].trim()),
        link: linkMatch[1],
        source: "classaction", category: "Settlements",
        deadline: deadlineDate,
        payout: payoutMatch ? payoutMatch[1].trim() : "",
        proof_required: proofMatch ? proofMatch[1].trim() : "",
        description: descMatch ? decodeEntities(descMatch[1].trim()) : "",
      });
    }
  }
}

// === SWEETIES SWEEPS (WP REST API - direct entry links in content) ===
{
  try {
    const json = await self.helpers.httpRequest({
      method: 'GET',
      url: 'https://sweetiessweeps.com/wp-json/wp/v2/posts?per_page=50',
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      returnFullResponse: false,
      timeout: 15000,
    });
    const posts = typeof json === 'string' ? JSON.parse(json) : json;
    if (Array.isArray(posts)) {
      for (const post of posts) {
        const title = post.title?.rendered || '';
        const content = post.content?.rendered || '';
        if (!title) continue;
        // Extract the first significant outbound link from article content
        const directLink = extractOutboundLink(content, 'sweetiessweeps.com');
        scraped.push({
          title: decodeEntities(title.trim()),
          link: directLink || post.link,
          source: "sweetiessweeps", category: "Sweepstakes",
        });
      }
    }
  } catch (e) { /* sweeties sweeps failed */ }
}

// === SWEEPSTAKES ADVANTAGE (HTML - direct entry links on listing pages) ===
{
  const saPages = [
    'https://www.sweepsadvantage.com/daily-sweepstakes.html',
    'https://www.sweepsadvantage.com/one-entry-sweepstakes.html',
    'https://www.sweepsadvantage.com/instant-win-sweepstakes',
    'https://www.sweepsadvantage.com/cash-sweepstakes',
  ];
  for (const pageUrl of saPages) {
    try {
      const html = await fetchPage(pageUrl);
      if (!html) continue;
      // SA uses target="_blank" rel="nofollow" for direct entry links with thumbnail images
      const entryRe = /href="(https?:\/\/[^"]+)"[^>]*target="_blank"[^>]*rel="nofollow"[^>]*>[\s\S]*?alt="([^"]+)"/g;
      let m;
      while ((m = entryRe.exec(html)) !== null) {
        const url = m[1];
        if (url.includes('sweepsadvantage') || url.includes('sweepstakesplus')) continue;
        scraped.push({
          title: decodeEntities(m[2].replace(/ Sweepstakes$/, '').trim()),
          link: url,
          source: "sweepsadvantage", category: "Sweepstakes",
        });
      }
      // Also try text links with nofollow
      const textRe = /href="(https?:\/\/[^"]+)"[^>]*rel="nofollow"[^>]*target="_blank"[^>]*>([^<]{10,})/g;
      while ((m = textRe.exec(html)) !== null) {
        const url = m[1];
        if (url.includes('sweepsadvantage') || url.includes('sweepstakesplus')) continue;
        scraped.push({
          title: decodeEntities(m[2].trim()),
          link: url,
          source: "sweepsadvantage", category: "Sweepstakes",
        });
      }
    } catch (e) { /* SA page failed */ }
  }
}

// === TOP CLASS ACTIONS (RSS - open settlements) ===
{
  const xml = await fetchPage("https://topclassactions.com/feed/");
  if (xml) {
    for (const item of parseRssItems(xml)) {
      if (!item.title || !item.link) continue;
      // Only include settlement-related articles
      const titleLower = item.title.toLowerCase();
      if (titleLower.includes('settlement') || titleLower.includes('class action') ||
          titleLower.includes('refund') || titleLower.includes('claim')) {
        scraped.push({
          title: decodeEntities(item.title.trim()),
          link: item.link.trim(),
          source: "topclassactions", category: "Settlements",
        });
      }
    }
  }
}

// === FTC REFUNDS (government settlement/refund pages) ===
{
  const html = await fetchPage("https://www.ftc.gov/enforcement/refunds");
  if (html) {
    const refundRe = /<a[^>]*href="(\/enforcement\/refunds\/[^"]+)"[^>]*>([^<]+)/g;
    let m;
    while ((m = refundRe.exec(html)) !== null) {
      const title = m[2].trim();
      if (title.length < 5) continue;
      scraped.push({
        title: decodeEntities(title),
        link: "https://www.ftc.gov" + m[1],
        source: "ftc", category: "Settlements",
      });
    }
  }
}

// Step 3: Deduplicate against existing sheet entries
const newItems = [];
for (const item of scraped) {
  if (!item.link || !item.title) continue;
  if (existingLinks.has(item.link.trim())) continue;
  newItems.push({ json: item });
}

return newItems;
