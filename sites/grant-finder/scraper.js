#!/usr/bin/env node
// Grant Finder Scraper
// Aggregates government grants and funding programs from multiple sources
// Run: node scraper.js
// Uses only built-in Node.js modules — no npm dependencies

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const DATA_DIR = path.join(__dirname, 'data');
const SITE_DIR = path.join(__dirname, 'site');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const SITE_DATA_FILE = path.join(SITE_DIR, 'data.json');
const TIMEOUT = 30000; // 30-second timeout for government APIs

// Ensure output directories exist
[DATA_DIR, SITE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// === UTILITIES ===
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '') // strip HTML tags
    .trim();
}

function fetchPage(url, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchPage(resolved, timeout).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (d.includes('Just a moment') || d.includes('500 Server Error')) resolve(null);
        else resolve(d);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

function fetchJSON(url, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchJSON(resolved, timeout).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
  });
}

function postJSON(url, body, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      }
    };
    const req = mod.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return postJSON(resolved, body, timeout).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

function truncate(str, max = 500) {
  if (!str) return '';
  str = str.trim();
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    // Handle various date formats
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toISOString().split('T')[0];
  } catch (e) {
    return dateStr;
  }
}

// Convert Grants.gov MMDDYYYY to YYYY-MM-DD
function parseGrantsGovDate(str) {
  if (!str) return '';
  // Format: MMDDYYYY or MM/DD/YYYY
  const clean = str.replace(/\//g, '');
  if (clean.length === 8 && /^\d+$/.test(clean)) {
    const mm = clean.slice(0, 2);
    const dd = clean.slice(2, 4);
    const yyyy = clean.slice(4, 8);
    return `${yyyy}-${mm}-${dd}`;
  }
  return formatDate(str);
}

function guessCategory(title, desc) {
  const text = ((title || '') + ' ' + (desc || '')).toLowerCase();
  if (/\beducat|school|universit|scholar|student|college|training\b/.test(text)) return 'Education';
  if (/\bresearch|science|laborator|innovat\b/.test(text)) return 'Research';
  if (/\bsmall business|entrepreneur|startup|sba|commerce\b/.test(text)) return 'Small Business';
  if (/\bhealth|medic|hospital|clinic|mental\b/.test(text)) return 'Healthcare';
  if (/\bhousing|home|rent|mortgage|shelter\b/.test(text)) return 'Housing';
  if (/\bagricultur|farm|rural|usda\b/.test(text)) return 'Agriculture';
  if (/\btechnolog|cyber|digital|broadband|software|comput\b/.test(text)) return 'Technology';
  return 'Other';
}

function determineStatus(deadline) {
  if (!deadline) return 'Open';
  try {
    const d = new Date(deadline);
    const now = new Date();
    const daysLeft = (d - now) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0) return 'Open'; // expired deadlines get filtered or kept as open
    if (daysLeft <= 14) return 'Closing Soon';
    return 'Open';
  } catch (e) {
    return 'Open';
  }
}

// ============================================================
// SOURCE 1: Grants.gov
// ============================================================
async function scrapeGrantsGov() {
  log('Scraping Grants.gov...');
  const results = [];

  try {
    // Try the v2/json endpoint with POST
    const body = {
      keyword: '',
      oppStatuses: 'posted',
      sortBy: 'openDate|desc',
      rows: 50
    };

    // Try multiple Grants.gov API endpoints
    const grantsGovEndpoints = [
      'https://www.grants.gov/grantsws/rest/opportunities/search/v2/json',
      'https://www.grants.gov/grantsws/rest/opportunities/search/v2',
      'https://apply07.grants.gov/grantsws/rest/opportunities/search/v2/json',
      'https://apply07.grants.gov/grantsws/rest/opportunities/search/v2',
    ];

    let data = null;
    for (const ep of grantsGovEndpoints) {
      data = await postJSON(ep, body);
      if (data) {
        log(`  Grants.gov endpoint ${ep} returned keys: ${Object.keys(data).slice(0, 15).join(', ')}`);
        break;
      }
    }

    if (data && (data.oppHits || data.opportunities || data.fundingOpportunities || data.oppData || data.searchResults)) {
      const opps = data.oppHits || data.opportunities || data.fundingOpportunities || data.oppData || data.searchResults || [];
      for (const opp of opps) {
        const title = decodeEntities(opp.title || opp.oppTitle || '');
        if (!title) continue;

        const closeDate = parseGrantsGovDate(opp.closeDate || opp.archiveDate || '');
        const openDate = parseGrantsGovDate(opp.openDate || opp.postedDate || '');
        const oppNumber = opp.number || opp.oppNumber || opp.id || '';
        const agency = opp.agency || opp.agencyName || opp.parentAgency || '';
        const desc = decodeEntities(opp.description || opp.synopsis || opp.oppDesc || '');
        const oppStatus = (opp.oppStatus || opp.status || '').toLowerCase();

        let status = 'Open';
        if (oppStatus.includes('forecast')) status = 'Forecasted';
        else status = determineStatus(closeDate);

        const link = oppNumber
          ? `https://www.grants.gov/search-results-detail/${oppNumber}`
          : 'https://www.grants.gov';

        results.push({
          title: truncate(title, 200),
          description: truncate(desc),
          amount: opp.awardCeiling && opp.awardFloor
            ? `$${Number(opp.awardFloor).toLocaleString()} - $${Number(opp.awardCeiling).toLocaleString()}`
            : opp.awardCeiling
              ? `Up to $${Number(opp.awardCeiling).toLocaleString()}`
              : '',
          deadline: closeDate,
          category: guessCategory(title, desc),
          eligibility: decodeEntities(opp.eligibility || opp.applicantTypes || ''),
          agency: agency,
          link: link,
          source: 'grants_gov',
          date_posted: openDate || todayStr(),
          status: status,
        });
      }
      log(`  Grants.gov API returned ${results.length} results`);
      return results;
    }
  } catch (e) {
    log(`  Grants.gov API attempt 1 failed: ${e.message}`);
  }

  // Fallback: try the v2 endpoint (without /json suffix)
  if (results.length === 0) {
    try {
      const bodyAlt = {
        keyword: '',
        oppStatuses: 'posted',
        sortBy: 'openDate|desc',
        rows: 50
      };
      const dataAlt = await postJSON('https://www.grants.gov/grantsws/rest/opportunities/search/v2', bodyAlt);
      if (dataAlt) {
        log(`  Grants.gov v2 (no /json) keys: ${Object.keys(dataAlt).slice(0, 15).join(', ')}`);
        const opps = dataAlt.oppHits || dataAlt.opportunities || dataAlt.fundingOpportunities || [];
        for (const opp of (Array.isArray(opps) ? opps : [])) {
          const title = decodeEntities(opp.title || opp.oppTitle || '');
          if (!title) continue;
          results.push({
            title: truncate(title, 200),
            description: truncate(decodeEntities(opp.description || opp.synopsis || '')),
            amount: '',
            deadline: parseGrantsGovDate(opp.closeDate || ''),
            category: guessCategory(title, opp.description || ''),
            eligibility: '',
            agency: opp.agency || opp.agencyName || '',
            link: `https://www.grants.gov/search-results-detail/${opp.number || opp.id || ''}`,
            source: 'grants_gov',
            date_posted: parseGrantsGovDate(opp.openDate || '') || todayStr(),
            status: 'Open',
          });
        }
        if (results.length > 0) {
          log(`  Grants.gov v2 returned ${results.length} results`);
          return results;
        }
      }
    } catch (e) {
      log(`  Grants.gov v2 fallback error: ${e.message}`);
    }
  }

  // Fallback: try the new grants.gov search API (newer site)
  if (results.length === 0) {
    try {
      const newBody = {
        criteria: { keyword: '' },
        pagination: { page: 1, size: 50 },
        sorting: { field: 'openDate', order: 'desc' }
      };
      const newData = await postJSON('https://apply07.grants.gov/grantsws/rest/opportunities/search/v3', newBody);
      if (newData) {
        log(`  Grants.gov v3 keys: ${Object.keys(newData).slice(0, 15).join(', ')}`);
        const opps = newData.oppHits || newData.opportunities || newData.data || [];
        for (const opp of (Array.isArray(opps) ? opps : [])) {
          const title = decodeEntities(opp.title || opp.oppTitle || '');
          if (!title) continue;
          results.push({
            title: truncate(title, 200),
            description: truncate(decodeEntities(opp.description || opp.synopsis || '')),
            amount: '',
            deadline: parseGrantsGovDate(opp.closeDate || ''),
            category: guessCategory(title, opp.description || ''),
            eligibility: '',
            agency: opp.agency || opp.agencyName || '',
            link: `https://www.grants.gov/search-results-detail/${opp.number || opp.id || ''}`,
            source: 'grants_gov',
            date_posted: parseGrantsGovDate(opp.openDate || '') || todayStr(),
            status: 'Open',
          });
        }
        if (results.length > 0) {
          log(`  Grants.gov v3 returned ${results.length} results`);
          return results;
        }
      }
    } catch (e) {
      log(`  Grants.gov v3 error: ${e.message}`);
    }
  }

  // Fallback: try the opportunity/req endpoint
  if (results.length === 0) try {
    const body2 = {
      keyword: '',
      oppStatuses: 'posted,forecasted',
      sortBy: 'openDate',
      sortOrder: 'desc',
      rows: 50,
      offset: 0
    };
    const data2 = await postJSON('https://www.grants.gov/grantsws/rest/opportunity/req', body2);

    if (data2 && (data2.oppHits || data2.opportunities)) {
      const opps = data2.oppHits || data2.opportunities || [];
      for (const opp of opps) {
        const title = decodeEntities(opp.title || opp.oppTitle || '');
        if (!title) continue;

        results.push({
          title: truncate(title, 200),
          description: truncate(decodeEntities(opp.description || opp.synopsis || '')),
          amount: '',
          deadline: parseGrantsGovDate(opp.closeDate || ''),
          category: guessCategory(title, opp.description || ''),
          eligibility: '',
          agency: opp.agency || opp.agencyName || '',
          link: `https://www.grants.gov/search-results-detail/${opp.number || opp.id || ''}`,
          source: 'grants_gov',
          date_posted: parseGrantsGovDate(opp.openDate || '') || todayStr(),
          status: 'Open',
        });
      }
      log(`  Grants.gov fallback returned ${results.length} results`);
      return results;
    }
  } catch (e) {
    log(`  Grants.gov API attempt 2 failed: ${e.message}`);
  }

  // Fallback: scrape the XML extract listing page for download links
  try {
    const page = await fetchPage('https://www.grants.gov/xml-extract.html');
    if (page) {
      // Try to find recent grant postings from the page content
      const titleMatches = page.match(/<title[^>]*>([^<]+)<\/title>/i);
      log(`  Grants.gov XML extract page loaded (${page.length} bytes)`);
      // The XML extracts are large files; note them for future use but skip parsing
    }
  } catch (e) {
    log(`  Grants.gov XML extract failed: ${e.message}`);
  }

  // Fallback: try Grants.gov RSS/XML feeds
  if (results.length === 0) {
    const rssUrls = [
      'https://www.grants.gov/rss/GG_NewOppByAgency.xml',
      'https://www.grants.gov/rss/GG_OppModByAgency.xml',
      'https://www.grants.gov/web/grants/rss.html',
    ];
    for (const rssUrl of rssUrls) {
      if (results.length > 0) break;
      try {
        const xml = await fetchPage(rssUrl);
        if (!xml || xml.length < 500) continue;
        log(`  Grants.gov RSS ${rssUrl} loaded (${xml.length} bytes)`);
        // Skip if response is HTML (SPA shell) instead of XML
        if (xml.includes('<!DOCTYPE html') || xml.includes('<html')) {
          log(`  Grants.gov RSS returned HTML instead of XML, skipping`);
          continue;
        }

        // Parse RSS items
        const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
        let itemMatch;
        while ((itemMatch = itemPattern.exec(xml)) !== null) {
          const item = itemMatch[1];
          const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
          const descMatch = item.match(/<description>([\s\S]*?)<\/description>/i);
          const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
          const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

          const title = titleMatch ? decodeEntities(titleMatch[1]) : '';
          if (!title || title.length < 10) continue;

          results.push({
            title: truncate(title, 200),
            description: truncate(decodeEntities(descMatch ? descMatch[1] : '')),
            amount: '',
            deadline: '',
            category: guessCategory(title, descMatch ? descMatch[1] : ''),
            eligibility: '',
            agency: '',
            link: linkMatch ? decodeEntities(linkMatch[1]).trim() : 'https://www.grants.gov',
            source: 'grants_gov',
            date_posted: dateMatch ? formatDate(dateMatch[1].trim()) : todayStr(),
            status: 'Open',
          });
        }
        if (results.length > 0) {
          log(`  Grants.gov RSS: ${results.length} results`);
          return results;
        }
      } catch (e) {
        log(`  Grants.gov RSS error (${rssUrl}): ${e.message}`);
      }
    }
  }

  // Final fallback: scrape grants.gov search results page
  if (results.length === 0) {
    try {
      const page = await fetchPage('https://www.grants.gov/search-grants.html');
      if (page) {
        log(`  Grants.gov search page loaded (${page.length} bytes)`);
        // Extract any embedded JSON data from the search results page
        const jsonMatch = page.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
        if (jsonMatch) {
          try {
            const state = JSON.parse(jsonMatch[1]);
            const opps = state.searchResults || state.opportunities || [];
            for (const opp of opps.slice(0, 50)) {
              results.push({
                title: truncate(decodeEntities(opp.title || ''), 200),
                description: truncate(decodeEntities(opp.description || '')),
                amount: '',
                deadline: formatDate(opp.closeDate || ''),
                category: guessCategory(opp.title, opp.description),
                eligibility: '',
                agency: opp.agency || '',
                link: `https://www.grants.gov/search-results-detail/${opp.number || opp.id || ''}`,
                source: 'grants_gov',
                date_posted: formatDate(opp.openDate || '') || todayStr(),
                status: 'Open',
              });
            }
          } catch (e) {}
        }

        // Also try extracting visible grant links from the HTML
        if (results.length === 0) {
          const linkPattern = /<a[^>]*href="(\/search-results-detail\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          const seen = new Set();
          while ((match = linkPattern.exec(page)) !== null) {
            const href = match[1];
            const title = decodeEntities(match[2]).trim();
            if (!title || title.length < 10 || seen.has(title.toLowerCase())) continue;
            seen.add(title.toLowerCase());
            results.push({
              title: truncate(title, 200),
              description: '',
              amount: '',
              deadline: '',
              category: guessCategory(title, ''),
              eligibility: '',
              agency: '',
              link: `https://www.grants.gov${href}`,
              source: 'grants_gov',
              date_posted: todayStr(),
              status: 'Open',
            });
          }
        }
      }
    } catch (e) {
      log(`  Grants.gov page scrape failed: ${e.message}`);
    }
  }

  log(`  Grants.gov total: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 2: SBA.gov Funding Programs
// ============================================================
async function scrapeSBA() {
  log('Scraping SBA.gov...');
  const results = [];

  try {
    const page = await fetchPage('https://www.sba.gov/funding-programs');
    if (!page) {
      log('  SBA.gov: page fetch failed');
      return results;
    }

    // Extract program cards/sections
    // SBA page has program listings with titles, descriptions, and links
    const sections = page.match(/<(?:div|article|section)[^>]*class="[^"]*(?:card|program|listing|view-content|field-content)[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|section)>/gi) || [];

    // Also try finding links with program names
    const linkPattern = /<a[^>]*href="(\/funding-programs\/[^"]*)"[^>]*>([^<]+)<\/a>/gi;
    let match;
    const seen = new Set();

    while ((match = linkPattern.exec(page)) !== null) {
      const href = match[1];
      const title = decodeEntities(match[2]).trim();
      if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());

      results.push({
        title: truncate(title, 200),
        description: '',
        amount: '',
        deadline: '',
        category: 'Small Business',
        eligibility: 'Small businesses',
        agency: 'Small Business Administration (SBA)',
        link: `https://www.sba.gov${href}`,
        source: 'sba',
        date_posted: todayStr(),
        status: 'Open',
      });
    }

    // Also look for h2/h3 headings as program names
    const headingPattern = /<h[23][^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[23]>/gi;
    while ((match = headingPattern.exec(page)) !== null) {
      const href = match[1];
      const title = decodeEntities(match[2]).trim();
      if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());

      const link = href.startsWith('http') ? href : `https://www.sba.gov${href}`;
      results.push({
        title: truncate(title, 200),
        description: '',
        amount: '',
        deadline: '',
        category: 'Small Business',
        eligibility: 'Small businesses',
        agency: 'Small Business Administration (SBA)',
        link: link,
        source: 'sba',
        date_posted: todayStr(),
        status: 'Open',
      });
    }

    // Fetch sub-pages for more detail
    const subPages = [
      '/funding-programs/loans',
      '/funding-programs/investment-capital',
      '/funding-programs/disaster-assistance',
      '/funding-programs/surety-bonds',
      '/funding-programs/grants',
    ];

    for (const subPath of subPages) {
      try {
        const subPage = await fetchPage(`https://www.sba.gov${subPath}`);
        if (!subPage) continue;

        const subLinkPattern = /<a[^>]*href="(\/funding-programs\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((match = subLinkPattern.exec(subPage)) !== null) {
          const href = match[1];
          const title = decodeEntities(match[2]).trim();
          if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
          if (/skip|nav|menu|breadcrumb|footer/i.test(title)) continue;
          seen.add(title.toLowerCase());

          // Try to find a description near the link
          const idx = match.index;
          const nearby = subPage.slice(idx, idx + 1000);
          const descMatch = nearby.match(/<p[^>]*>([\s\S]*?)<\/p>/);
          const desc = descMatch ? decodeEntities(descMatch[1]) : '';

          results.push({
            title: truncate(title, 200),
            description: truncate(desc),
            amount: '',
            deadline: '',
            category: 'Small Business',
            eligibility: 'Small businesses',
            agency: 'Small Business Administration (SBA)',
            link: `https://www.sba.gov${href}`,
            source: 'sba',
            date_posted: todayStr(),
            status: 'Open',
          });
        }
      } catch (e) {}
    }
  } catch (e) {
    log(`  SBA.gov error: ${e.message}`);
  }

  log(`  SBA.gov: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 3: SAM.gov
// ============================================================
async function scrapeSAM() {
  log('Scraping SAM.gov...');
  const results = [];

  // SAM.gov expects MM/DD/YYYY date format
  function samDate(isoStr) {
    const [y, m, d] = isoStr.split('-');
    return `${m}/${d}/${y}`;
  }

  const fromISO = daysAgo(30);
  const toISO = todayStr();

  // Try v1 endpoint first (more reliable with DEMO_KEY)
  const endpoints = [
    `https://api.sam.gov/opportunities/v1/search?limit=25&api_key=DEMO_KEY&postedFrom=${samDate(fromISO)}&postedTo=${samDate(toISO)}`,
    `https://api.sam.gov/opportunities/v2/search?limit=25&api_key=DEMO_KEY&postedFrom=${samDate(fromISO)}&postedTo=${samDate(toISO)}`,
    `https://api.sam.gov/opportunities/v1/search?limit=25&api_key=DEMO_KEY&postedFrom=${fromISO}&postedTo=${toISO}`,
    `https://api.sam.gov/opportunities/v2/search?limit=25&api_key=DEMO_KEY&postedFrom=${fromISO}&postedTo=${toISO}`,
  ];

  for (const url of endpoints) {
    if (results.length > 0) break;
    try {
      const data = await fetchJSON(url);

      if (data && data.opportunitiesData) {
        for (const opp of data.opportunitiesData) {
          const title = decodeEntities(opp.title || '');
          if (!title) continue;

          const desc = decodeEntities(opp.description || opp.organizationType || '');
          const deadline = formatDate(opp.responseDeadLine || opp.archiveDate || '');
          const posted = formatDate(opp.postedDate || '');
          const solNum = opp.solicitationNumber || opp.noticeId || '';
          const link = solNum
            ? `https://sam.gov/opp/${solNum}/view`
            : opp.uiLink || 'https://sam.gov';

          results.push({
            title: truncate(title, 200),
            description: truncate(desc),
            amount: opp.award ? `$${Number(opp.award.amount || 0).toLocaleString()}` : '',
            deadline: deadline,
            category: guessCategory(title, desc),
            eligibility: opp.typeOfSetAside || '',
            agency: opp.fullParentPathName || opp.departmentName || opp.subtierAgency || '',
            link: link,
            source: 'sam_gov',
            date_posted: posted || todayStr(),
            status: determineStatus(deadline),
          });
        }
        if (results.length > 0) {
          log(`  SAM.gov: got ${results.length} from endpoint`);
        }
      } else if (data && data.error) {
        log(`  SAM.gov API error: ${JSON.stringify(data.error).slice(0, 200)}`);
      }
    } catch (e) {
      log(`  SAM.gov error: ${e.message}`);
    }
  }

  // Fallback: scrape SAM.gov search page
  if (results.length === 0) {
    try {
      const page = await fetchPage('https://sam.gov/search/?index=opp&sort=-modifiedDate&page=1&pageSize=25');
      if (page) {
        // Look for embedded JSON state
        const stateMatch = page.match(/window\.__(?:INITIAL_STATE|PRELOADED_STATE)__\s*=\s*({[\s\S]*?});/);
        if (stateMatch) {
          try {
            const state = JSON.parse(stateMatch[1]);
            const opps = state.results || state.opportunities || state.data || [];
            for (const opp of (Array.isArray(opps) ? opps : []).slice(0, 25)) {
              const title = decodeEntities(opp.title || '');
              if (!title) continue;
              results.push({
                title: truncate(title, 200),
                description: truncate(decodeEntities(opp.description || '')),
                amount: '',
                deadline: formatDate(opp.responseDeadLine || ''),
                category: guessCategory(title, opp.description || ''),
                eligibility: '',
                agency: opp.departmentName || '',
                link: opp.uiLink || 'https://sam.gov',
                source: 'sam_gov',
                date_posted: formatDate(opp.postedDate || '') || todayStr(),
                status: 'Open',
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      log(`  SAM.gov page scrape error: ${e.message}`);
    }
  }

  log(`  SAM.gov: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 4: USA.gov / Benefits.gov
// ============================================================
async function scrapeUSAGov() {
  log('Scraping Benefits.gov...');
  const results = [];

  try {
    // Try the Benefits.gov API
    const apiUrl = 'https://www.benefits.gov/api/benefit';
    const data = await fetchJSON(apiUrl);

    if (data && Array.isArray(data.benefits || data)) {
      const benefits = data.benefits || data;
      for (const b of benefits.slice(0, 50)) {
        const title = decodeEntities(b.title || b.name || '');
        if (!title) continue;

        results.push({
          title: truncate(title, 200),
          description: truncate(decodeEntities(b.summary || b.description || b.purpose || '')),
          amount: '',
          deadline: '',
          category: guessCategory(title, b.summary || b.description || ''),
          eligibility: decodeEntities(b.eligibility || b.whoIsEligible || ''),
          agency: decodeEntities(b.agency || b.sourceAgency || ''),
          link: b.link || (b.id ? `https://www.benefits.gov/benefit/${b.id}` : 'https://www.benefits.gov'),
          source: 'usa_gov',
          date_posted: todayStr(),
          status: 'Open',
        });
      }
    }
  } catch (e) {
    log(`  Benefits.gov API error: ${e.message}`);
  }

  // Fallback: scrape the benefit finder page
  if (results.length === 0) {
    try {
      const page = await fetchPage('https://www.benefits.gov/categories');
      if (page) {
        // Extract category links and benefit listings
        const linkPattern = /<a[^>]*href="(\/benefit\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        const seen = new Set();

        while ((match = linkPattern.exec(page)) !== null) {
          const href = match[1];
          const title = decodeEntities(match[2]).trim();
          if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
          seen.add(title.toLowerCase());

          results.push({
            title: truncate(title, 200),
            description: '',
            amount: '',
            deadline: '',
            category: guessCategory(title, ''),
            eligibility: '',
            agency: '',
            link: `https://www.benefits.gov${href}`,
            source: 'usa_gov',
            date_posted: todayStr(),
            status: 'Open',
          });
        }
      }
    } catch (e) {
      log(`  Benefits.gov page scrape error: ${e.message}`);
    }
  }

  // Also try USA.gov grants page
  if (results.length === 0) {
    try {
      const page = await fetchPage('https://www.usa.gov/grants');
      if (page) {
        const linkPattern = /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        const seen = new Set();

        while ((match = linkPattern.exec(page)) !== null) {
          const href = match[1];
          const title = decodeEntities(match[2]).trim();
          if (!title || title.length < 10 || seen.has(title.toLowerCase())) continue;
          if (/usa\.gov|nav|menu|footer|skip/i.test(title)) continue;
          seen.add(title.toLowerCase());

          results.push({
            title: truncate(title, 200),
            description: '',
            amount: '',
            deadline: '',
            category: guessCategory(title, ''),
            eligibility: '',
            agency: 'USA.gov',
            link: href,
            source: 'usa_gov',
            date_posted: todayStr(),
            status: 'Open',
          });
        }
      }
    } catch (e) {
      log(`  USA.gov page scrape error: ${e.message}`);
    }
  }

  log(`  USA.gov/Benefits.gov: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 5: CFPB Enforcement Actions
// ============================================================
async function scrapeCFPB() {
  log('Scraping CFPB...');
  const results = [];

  try {
    // Try the CFPB API first
    const apiUrl = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?size=25&sort=created_date_desc';
    // Actually, try the enforcement actions page
    const page = await fetchPage('https://www.consumerfinance.gov/enforcement/actions/');
    if (!page) {
      log('  CFPB: page fetch failed');
      return results;
    }

    // Extract enforcement action entries
    const entryPattern = /<(?:article|div|li)[^>]*class="[^"]*(?:o-post-preview|m-list_item|enforcement-action)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div|li)>/gi;
    const entries = page.match(entryPattern) || [];

    for (const entry of entries) {
      const titleMatch = entry.match(/<(?:h[234]|a)[^>]*(?:class="[^"]*(?:title|heading)[^"]*")?[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/(?:h[234]|a)>/i);
      if (!titleMatch) continue;

      const href = titleMatch[1];
      const title = decodeEntities(titleMatch[2]).trim();
      if (!title || title.length < 5) continue;

      const dateMatch = entry.match(/(?:datetime="([^"]+)"|(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b))/i);
      const date = dateMatch ? formatDate(dateMatch[1] || dateMatch[2]) : '';

      const descMatch = entry.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const desc = descMatch ? decodeEntities(descMatch[1]) : '';

      // Look for dollar amounts in the description
      const amountMatch = (desc + ' ' + title).match(/\$[\d,]+(?:\.\d{2})?(?:\s*(?:million|billion))?/i);
      const amount = amountMatch ? amountMatch[0] : '';

      const link = href.startsWith('http') ? href : `https://www.consumerfinance.gov${href}`;

      results.push({
        title: truncate(title, 200),
        description: truncate(desc),
        amount: amount,
        deadline: '',
        category: 'Other',
        eligibility: 'Affected consumers',
        agency: 'Consumer Financial Protection Bureau (CFPB)',
        link: link,
        source: 'cfpb',
        date_posted: date || todayStr(),
        status: 'Open',
      });
    }

    // Broader link extraction if no entries found
    if (results.length === 0) {
      const linkPattern = /<a[^>]*href="(\/enforcement\/actions\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      const seen = new Set();

      while ((match = linkPattern.exec(page)) !== null) {
        const href = match[1];
        const title = decodeEntities(match[2]).trim();
        if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());

        results.push({
          title: truncate(title, 200),
          description: '',
          amount: '',
          deadline: '',
          category: 'Other',
          eligibility: 'Affected consumers',
          agency: 'Consumer Financial Protection Bureau (CFPB)',
          link: `https://www.consumerfinance.gov${href}`,
          source: 'cfpb',
          date_posted: todayStr(),
          status: 'Open',
        });
      }
    }
  } catch (e) {
    log(`  CFPB error: ${e.message}`);
  }

  log(`  CFPB: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 6: SBIR.gov — Small Business Innovation Research
// ============================================================
async function scrapeSBIR() {
  log('Scraping SBIR.gov...');
  const results = [];

  // Try multiple SBIR API endpoints
  const sbirUrls = [
    'https://www.sbir.gov/api/solicitations.json?rows=50',
    'https://www.sbir.gov/api/solicitations.json?keyword=&rows=50',
    'https://www.sbir.gov/api/solicitations?rows=50',
  ];

  for (const sbirUrl of sbirUrls) {
    if (results.length > 0) break;
    try {
      const data = await fetchJSON(sbirUrl);
      if (!data) { log(`  SBIR API null response from ${sbirUrl}`); continue; }

      // Handle both array and object responses
      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.solicitations && Array.isArray(data.solicitations)) {
        items = data.solicitations;
      } else if (data.results && Array.isArray(data.results)) {
        items = data.results;
      } else if (data.data && Array.isArray(data.data)) {
        items = data.data;
      } else if (typeof data === 'object') {
        // Log the keys so we can see the structure
        log(`  SBIR API keys: ${Object.keys(data).slice(0, 10).join(', ')}`);
        // Try treating values as items if they look like solicitations
        const vals = Object.values(data);
        if (vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null) {
          items = vals.filter(v => v && (v.title || v.solicitation_title));
        }
      }

      for (const sol of items.slice(0, 50)) {
        const title = decodeEntities(sol.solicitation_title || sol.title || sol.topicTitle || '');
        if (!title) continue;

        results.push({
          title: truncate(title, 200),
          description: truncate(decodeEntities(sol.abstract || sol.description || sol.solicitation_topics || '')),
          amount: sol.award_ceiling ? `Up to $${Number(sol.award_ceiling).toLocaleString()}` :
                  sol.phase && sol.phase === '1' ? 'Up to $275,000 (Phase I typical)' :
                  sol.phase && sol.phase === '2' ? 'Up to $1,000,000 (Phase II typical)' : '',
          deadline: formatDate(sol.close_date || sol.application_due_date || sol.closingDate || ''),
          category: 'Small Business',
          eligibility: 'Small businesses (500 or fewer employees)',
          agency: decodeEntities(sol.agency || sol.branch || sol.agencyName || ''),
          link: sol.solicitation_id
            ? `https://www.sbir.gov/node/${sol.solicitation_id}`
            : sol.url || sol.link || 'https://www.sbir.gov/sbirsearch/topic/current',
          source: 'sbir',
          date_posted: formatDate(sol.open_date || sol.pre_release_date || sol.openDate || '') || todayStr(),
          status: determineStatus(sol.close_date || sol.application_due_date || ''),
        });
      }
      if (results.length > 0) {
        log(`  SBIR.gov API: ${results.length} results from ${sbirUrl}`);
        return results;
      }
    } catch (e) {
      log(`  SBIR.gov API error (${sbirUrl}): ${e.message}`);
    }
  }

  // Fallback: scrape the current topics page
  try {
    const page = await fetchPage('https://www.sbir.gov/sbirsearch/topic/current');
    if (page) {
      const linkPattern = /<a[^>]*href="(\/node\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      const seen = new Set();

      while ((match = linkPattern.exec(page)) !== null) {
        const href = match[1];
        const title = decodeEntities(match[2]).trim();
        if (!title || title.length < 10 || seen.has(title.toLowerCase())) continue;
        if (/menu|nav|skip|footer|breadcrumb/i.test(title)) continue;
        seen.add(title.toLowerCase());

        results.push({
          title: truncate(title, 200),
          description: '',
          amount: '',
          deadline: '',
          category: 'Small Business',
          eligibility: 'Small businesses (500 or fewer employees)',
          agency: 'SBIR/STTR',
          link: `https://www.sbir.gov${href}`,
          source: 'sbir',
          date_posted: todayStr(),
          status: 'Open',
        });
      }

      // Also try table rows
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowPattern.exec(page)) !== null) {
        const row = rowMatch[1];
        const cellLinkMatch = row.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!cellLinkMatch) continue;
        const href = cellLinkMatch[1];
        const title = decodeEntities(cellLinkMatch[2]).trim();
        if (!title || title.length < 10 || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());

        const agencyMatch = row.match(/<td[^>]*>(DOD|DOE|NASA|NSF|NIH|HHS|USDA|EPA|DOT|DHS|ED|DOC)[^<]*<\/td>/i);

        const link = href.startsWith('http') ? href : `https://www.sbir.gov${href}`;
        results.push({
          title: truncate(title, 200),
          description: '',
          amount: '',
          deadline: '',
          category: 'Small Business',
          eligibility: 'Small businesses',
          agency: agencyMatch ? agencyMatch[1] : 'SBIR/STTR',
          link: link,
          source: 'sbir',
          date_posted: todayStr(),
          status: 'Open',
        });
      }
    }
  } catch (e) {
    log(`  SBIR.gov page scrape error: ${e.message}`);
  }

  // Additional fallback: scrape the main SBIR page for any solicitation links
  if (results.length === 0) {
    try {
      const mainPage = await fetchPage('https://www.sbir.gov/');
      if (mainPage) {
        const seen = new Set();
        // Look for any links to solicitations or topics
        const patterns = [
          /<a[^>]*href="((?:\/sbirsearch\/detail|\/node)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
          /<a[^>]*href="(\/solicitations[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
          /<a[^>]*href="(\/topics[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        ];
        for (const pat of patterns) {
          let match;
          while ((match = pat.exec(mainPage)) !== null) {
            const href = match[1];
            const title = decodeEntities(match[2]).trim();
            if (!title || title.length < 10 || seen.has(title.toLowerCase())) continue;
            if (/menu|nav|skip|footer|breadcrumb/i.test(title)) continue;
            seen.add(title.toLowerCase());

            results.push({
              title: truncate(title, 200),
              description: '',
              amount: '',
              deadline: '',
              category: 'Small Business',
              eligibility: 'Small businesses',
              agency: 'SBIR/STTR',
              link: `https://www.sbir.gov${href}`,
              source: 'sbir',
              date_posted: todayStr(),
              status: 'Open',
            });
          }
        }
        log(`  SBIR main page scrape: ${results.length} results`);
      }
    } catch (e) {
      log(`  SBIR main page error: ${e.message}`);
    }
  }

  log(`  SBIR.gov: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 7: NEA.gov — National Endowment for the Arts
// ============================================================
async function scrapeNEA() {
  log('Scraping NEA.gov (arts.gov)...');
  const results = [];

  try {
    const page = await fetchPage('https://www.arts.gov/grants');
    if (!page) {
      log('  NEA: page fetch failed');
      return results;
    }

    // Extract grant program links
    const linkPattern = /<a[^>]*href="(\/grants\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seen = new Set();

    while ((match = linkPattern.exec(page)) !== null) {
      const href = match[1];
      const title = decodeEntities(match[2]).trim();
      if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
      if (/menu|nav|skip|footer|breadcrumb|log in|sign up/i.test(title)) continue;
      seen.add(title.toLowerCase());

      // Try to find nearby description
      const idx = match.index;
      const nearby = page.slice(idx, idx + 2000);
      const descMatch = nearby.match(/<(?:p|div)[^>]*class="[^"]*(?:desc|summary|body|text|field-content)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i);
      const desc = descMatch ? decodeEntities(descMatch[1]) : '';

      // Look for deadline info
      const deadlineMatch = nearby.match(/(?:deadline|due|closes?)[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
      const deadline = deadlineMatch ? formatDate(deadlineMatch[1]) : '';

      results.push({
        title: truncate(title, 200),
        description: truncate(desc),
        amount: '',
        deadline: deadline,
        category: guessCategory(title, desc) === 'Other' ? 'Education' : guessCategory(title, desc),
        eligibility: 'Nonprofit organizations, state/local governments, tribal communities',
        agency: 'National Endowment for the Arts (NEA)',
        link: `https://www.arts.gov${href}`,
        source: 'nea',
        date_posted: todayStr(),
        status: deadline ? determineStatus(deadline) : 'Open',
      });
    }

    // Also try heading-based extraction
    const headingPattern = /<h[234][^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[234]>/gi;
    while ((match = headingPattern.exec(page)) !== null) {
      const href = match[1];
      const title = decodeEntities(match[2]).trim();
      if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());

      const link = href.startsWith('http') ? href : `https://www.arts.gov${href}`;
      results.push({
        title: truncate(title, 200),
        description: '',
        amount: '',
        deadline: '',
        category: 'Education',
        eligibility: 'Nonprofit organizations, state/local governments',
        agency: 'National Endowment for the Arts (NEA)',
        link: link,
        source: 'nea',
        date_posted: todayStr(),
        status: 'Open',
      });
    }
  } catch (e) {
    log(`  NEA error: ${e.message}`);
  }

  log(`  NEA.gov: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 8: NEH.gov — National Endowment for the Humanities
// ============================================================
async function scrapeNEH() {
  log('Scraping NEH.gov...');
  const results = [];

  try {
    const page = await fetchPage('https://www.neh.gov/grants');
    if (!page) {
      log('  NEH: page fetch failed');
      return results;
    }

    // Extract grant program links
    const linkPattern = /<a[^>]*href="(\/grants\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seen = new Set();

    while ((match = linkPattern.exec(page)) !== null) {
      const href = match[1];
      const title = decodeEntities(match[2]).trim();
      if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
      if (/menu|nav|skip|footer|breadcrumb|log in|sign up/i.test(title)) continue;
      seen.add(title.toLowerCase());

      const idx = match.index;
      const nearby = page.slice(idx, idx + 2000);
      const descMatch = nearby.match(/<(?:p|div)[^>]*class="[^"]*(?:desc|summary|body|text|field-content)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i);
      const desc = descMatch ? decodeEntities(descMatch[1]) : '';

      const deadlineMatch = nearby.match(/(?:deadline|due|closes?)[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
      const deadline = deadlineMatch ? formatDate(deadlineMatch[1]) : '';

      results.push({
        title: truncate(title, 200),
        description: truncate(desc),
        amount: '',
        deadline: deadline,
        category: guessCategory(title, desc) === 'Other' ? 'Education' : guessCategory(title, desc),
        eligibility: 'Scholars, educators, nonprofits, tribal, state/local governments',
        agency: 'National Endowment for the Humanities (NEH)',
        link: `https://www.neh.gov${href}`,
        source: 'neh',
        date_posted: todayStr(),
        status: deadline ? determineStatus(deadline) : 'Open',
      });
    }

    // Also try heading-based extraction
    const headingPattern = /<h[234][^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[234]>/gi;
    while ((match = headingPattern.exec(page)) !== null) {
      const href = match[1];
      const title = decodeEntities(match[2]).trim();
      if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());

      const link = href.startsWith('http') ? href : `https://www.neh.gov${href}`;
      results.push({
        title: truncate(title, 200),
        description: '',
        amount: '',
        deadline: '',
        category: 'Education',
        eligibility: 'Scholars, educators, nonprofits',
        agency: 'National Endowment for the Humanities (NEH)',
        link: link,
        source: 'neh',
        date_posted: todayStr(),
        status: 'Open',
      });
    }
  } catch (e) {
    log(`  NEH error: ${e.message}`);
  }

  log(`  NEH.gov: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 9: NSF.gov — National Science Foundation
// ============================================================
async function scrapeNSF() {
  log('Scraping NSF.gov...');
  const results = [];

  // Try the NSF awards API
  try {
    const data = await fetchJSON('https://api.nsf.gov/services/v1/awards.json?printFields=title,abstractText,agency,fundsObligatedAmt,startDate,expDate,piFirstName,piLastName&offset=1&rpp=50&dateStart=01/01/2026');
    if (data && data.response && data.response.award) {
      for (const award of data.response.award) {
        const title = decodeEntities(award.title || '');
        if (!title) continue;

        results.push({
          title: truncate(title, 200),
          description: truncate(decodeEntities(award.abstractText || '')),
          amount: award.fundsObligatedAmt ? `$${Number(award.fundsObligatedAmt).toLocaleString()}` : '',
          deadline: formatDate(award.expDate || ''),
          category: 'Research',
          eligibility: 'Researchers, universities, nonprofits',
          agency: 'National Science Foundation (NSF)',
          link: award.id ? `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${award.id}` : 'https://www.nsf.gov/funding/',
          source: 'nsf',
          date_posted: formatDate(award.startDate || '') || todayStr(),
          status: 'Open',
        });
      }
      log(`  NSF API: ${results.length} results`);
      if (results.length > 0) return results;
    }
  } catch (e) {
    log(`  NSF API error: ${e.message}`);
  }

  // Fallback: scrape the funding opportunities page
  try {
    const page = await fetchPage('https://www.nsf.gov/funding/pgm_list.jsp?type=all');
    if (page) {
      const linkPattern = /<a[^>]*href="([^"]*\/funding\/pgm_summ\.jsp\?pims_id=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      const seen = new Set();

      while ((match = linkPattern.exec(page)) !== null) {
        const href = match[1];
        const title = decodeEntities(match[2]).trim();
        if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());

        const link = href.startsWith('http') ? href : `https://www.nsf.gov${href}`;
        results.push({
          title: truncate(title, 200),
          description: '',
          amount: '',
          deadline: '',
          category: 'Research',
          eligibility: 'Researchers, universities, nonprofits',
          agency: 'National Science Foundation (NSF)',
          link: link,
          source: 'nsf',
          date_posted: todayStr(),
          status: 'Open',
        });
      }
    }
  } catch (e) {
    log(`  NSF page scrape error: ${e.message}`);
  }

  // Fallback: try the new NSF funding page
  if (results.length === 0) {
    try {
      const page = await fetchPage('https://new.nsf.gov/funding/opportunities');
      if (page) {
        const linkPattern = /<a[^>]*href="(\/funding\/opportunities\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        const seen = new Set();

        while ((match = linkPattern.exec(page)) !== null) {
          const href = match[1];
          const title = decodeEntities(match[2]).trim();
          if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
          if (/menu|nav|skip|footer/i.test(title)) continue;
          seen.add(title.toLowerCase());

          results.push({
            title: truncate(title, 200),
            description: '',
            amount: '',
            deadline: '',
            category: 'Research',
            eligibility: 'Researchers, universities, nonprofits',
            agency: 'National Science Foundation (NSF)',
            link: `https://new.nsf.gov${href}`,
            source: 'nsf',
            date_posted: todayStr(),
            status: 'Open',
          });
        }
      }
    } catch (e) {
      log(`  NSF new site scrape error: ${e.message}`);
    }
  }

  log(`  NSF.gov: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 10: Candid.org (Foundation Directory)
// ============================================================
async function scrapeCandid() {
  log('Scraping Candid.org...');
  const results = [];

  try {
    const page = await fetchPage('https://candid.org/explore-issues');
    if (page) {
      const linkPattern = /<a[^>]*href="(https?:\/\/candid\.org\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      const seen = new Set();

      while ((match = linkPattern.exec(page)) !== null) {
        const href = match[1];
        const title = decodeEntities(match[2]).trim();
        if (!title || title.length < 10 || seen.has(title.toLowerCase())) continue;
        if (/menu|nav|skip|footer|breadcrumb|log in|sign |privacy|terms|cookie/i.test(title)) continue;
        seen.add(title.toLowerCase());

        results.push({
          title: truncate(title, 200),
          description: '',
          amount: '',
          deadline: '',
          category: guessCategory(title, ''),
          eligibility: 'Nonprofits, NGOs',
          agency: 'Candid (Foundation Directory)',
          link: href,
          source: 'candid',
          date_posted: todayStr(),
          status: 'Open',
        });
      }
    }
  } catch (e) {
    log(`  Candid explore-issues error: ${e.message}`);
  }

  // Also try their find-funding page
  try {
    const page = await fetchPage('https://candid.org/find-funding');
    if (page) {
      const linkPattern = /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      const seen = new Set(results.map(r => r.title.toLowerCase()));

      while ((match = linkPattern.exec(page)) !== null) {
        const href = match[1];
        const title = decodeEntities(match[2]).trim();
        if (!title || title.length < 10 || seen.has(title.toLowerCase())) continue;
        if (/menu|nav|skip|footer|breadcrumb|log in|sign |privacy|terms|cookie/i.test(title)) continue;
        if (!href.includes('candid.org')) continue;
        seen.add(title.toLowerCase());

        results.push({
          title: truncate(title, 200),
          description: '',
          amount: '',
          deadline: '',
          category: guessCategory(title, ''),
          eligibility: 'Nonprofits, NGOs',
          agency: 'Candid (Foundation Directory)',
          link: href,
          source: 'candid',
          date_posted: todayStr(),
          status: 'Open',
        });
      }
    }
  } catch (e) {
    log(`  Candid find-funding error: ${e.message}`);
  }

  log(`  Candid.org: ${results.length} results`);
  return results;
}

// ============================================================
// SOURCE 11: GrantWatch.com
// ============================================================
async function scrapeGrantWatch() {
  log('Scraping GrantWatch.com...');
  const results = [];

  // Try multiple GrantWatch pages
  const gwPages = [
    'https://www.grantwatch.com/',
    'https://www.grantwatch.com/grant-search.php',
    'https://www.grantwatch.com/grants-by-state.php',
  ];

  for (const gwUrl of gwPages) {
    try {
      const page = await fetchPage(gwUrl);
      if (!page) {
        log(`  GrantWatch: ${gwUrl} fetch failed (null/blocked)`);
        continue;
      }
      log(`  GrantWatch: ${gwUrl} loaded (${page.length} bytes)`);

      // Check for Cloudflare/bot protection
      if (page.length < 5000) {
        log(`  GrantWatch: response too small, likely blocked`);
        continue;
      }

      const seen = new Set(results.map(r => r.title.toLowerCase()));
      let match;

      // Try multiple link patterns (absolute and relative URLs)
      const patterns = [
        /<a[^>]*href="((?:https?:\/\/www\.grantwatch\.com)?\/grant\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        /<a[^>]*href="((?:https?:\/\/www\.grantwatch\.com)?\/cat\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        /<a[^>]*href="((?:https?:\/\/www\.grantwatch\.com)?\/[^"]*grant[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      ];

      for (const pat of patterns) {
        while ((match = pat.exec(page)) !== null) {
          let href = match[1];
          const title = decodeEntities(match[2]).trim();
          if (!title || title.length < 5 || seen.has(title.toLowerCase())) continue;
          if (/menu|nav|skip|footer|breadcrumb|log in|sign up|privacy|terms|javascript/i.test(title)) continue;
          seen.add(title.toLowerCase());

          // Normalize href
          if (href.startsWith('/')) href = `https://www.grantwatch.com${href}`;

          const isCat = href.includes('/cat/');
          results.push({
            title: isCat ? `${title} Grants` : truncate(title, 200),
            description: isCat ? `Browse ${title} grant opportunities on GrantWatch` : '',
            amount: '',
            deadline: '',
            category: guessCategory(title, ''),
            eligibility: '',
            agency: 'GrantWatch',
            link: href,
            source: 'grantwatch',
            date_posted: todayStr(),
            status: 'Open',
          });
        }
      }

      if (results.length > 0) break;
    } catch (e) {
      log(`  GrantWatch error (${gwUrl}): ${e.message}`);
    }
  }

  log(`  GrantWatch: ${results.length} results`);
  return results;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  log('=== Grant Finder Scraper Starting ===');
  const startTime = Date.now();

  // Run all scrapers in parallel
  const [grantsGov, sba, sam, usaGov, cfpb, sbir, nea, neh, nsf, candid, grantwatch] = await Promise.all([
    scrapeGrantsGov().catch(e => { log(`Grants.gov crashed: ${e.message}`); return []; }),
    scrapeSBA().catch(e => { log(`SBA crashed: ${e.message}`); return []; }),
    scrapeSAM().catch(e => { log(`SAM.gov crashed: ${e.message}`); return []; }),
    scrapeUSAGov().catch(e => { log(`USA.gov crashed: ${e.message}`); return []; }),
    scrapeCFPB().catch(e => { log(`CFPB crashed: ${e.message}`); return []; }),
    scrapeSBIR().catch(e => { log(`SBIR crashed: ${e.message}`); return []; }),
    scrapeNEA().catch(e => { log(`NEA crashed: ${e.message}`); return []; }),
    scrapeNEH().catch(e => { log(`NEH crashed: ${e.message}`); return []; }),
    scrapeNSF().catch(e => { log(`NSF crashed: ${e.message}`); return []; }),
    scrapeCandid().catch(e => { log(`Candid crashed: ${e.message}`); return []; }),
    scrapeGrantWatch().catch(e => { log(`GrantWatch crashed: ${e.message}`); return []; }),
  ]);

  // Combine all results
  let allResults = [...grantsGov, ...sba, ...sam, ...usaGov, ...cfpb, ...sbir, ...nea, ...neh, ...nsf, ...candid, ...grantwatch];

  // Deduplicate by title similarity
  const seen = new Set();
  allResults = allResults.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date posted (newest first)
  allResults.sort((a, b) => {
    if (!a.date_posted && !b.date_posted) return 0;
    if (!a.date_posted) return 1;
    if (!b.date_posted) return -1;
    return b.date_posted.localeCompare(a.date_posted);
  });

  // Add scraped timestamp
  const output = {
    last_updated: new Date().toISOString(),
    total: allResults.length,
    sources: {
      grants_gov: grantsGov.length,
      sba: sba.length,
      sam_gov: sam.length,
      usa_gov: usaGov.length,
      cfpb: cfpb.length,
      sbir: sbir.length,
      nea: nea.length,
      neh: neh.length,
      nsf: nsf.length,
      candid: candid.length,
      grantwatch: grantwatch.length,
    },
    results: allResults,
  };

  // Save results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${allResults.length} results to ${RESULTS_FILE}`);

  fs.writeFileSync(SITE_DATA_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${allResults.length} results to ${SITE_DATA_FILE}`);

  // Console summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== GRANT FINDER SUMMARY ===');
  console.log(`Total results: ${allResults.length}`);
  console.log(`  Grants.gov:    ${grantsGov.length}`);
  console.log(`  SBA.gov:       ${sba.length}`);
  console.log(`  SAM.gov:       ${sam.length}`);
  console.log(`  USA.gov:       ${usaGov.length}`);
  console.log(`  CFPB:          ${cfpb.length}`);
  console.log(`  SBIR.gov:      ${sbir.length}`);
  console.log(`  NEA.gov:       ${nea.length}`);
  console.log(`  NEH.gov:       ${neh.length}`);
  console.log(`  NSF.gov:       ${nsf.length}`);
  console.log(`  Candid.org:    ${candid.length}`);
  console.log(`  GrantWatch:    ${grantwatch.length}`);
  console.log(`Time elapsed:    ${elapsed}s`);
  console.log(`Output files:`);
  console.log(`  ${RESULTS_FILE}`);
  console.log(`  ${SITE_DATA_FILE}`);
  console.log('============================\n');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
