#!/usr/bin/env node
// Recall Alerts Scraper
// Run: node sites/recall-alerts/scraper.js
// Aggregates product recalls from CPSC, FDA, NHTSA, USDA FSIS, Health Canada, EU Safety Gate, Consumer Reports, and Australia

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const SITE_DATA_FILE = path.join(__dirname, 'site', 'data.json');
const LOG_FILE = path.join(DATA_DIR, 'scraper.log');

// === UTILITIES ===
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

function fetchJSON(url, timeout = 20000) {
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

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function cleanText(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

function fetchPage(url, timeout = 20000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchPage(resolved, timeout).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(timeout, () => { req.destroy(); resolve(''); });
  });
}

// === SCRAPERS ===

// 1. CPSC - Consumer Product Safety Commission
async function scrapeCPSC() {
  log('Scraping CPSC Recalls API...');
  const items = [];
  const startDate = formatDate(daysAgo(30));
  const url = `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${startDate}`;

  try {
    const data = await fetchJSON(url, 30000);
    if (!data || !Array.isArray(data)) {
      log('  CPSC: FAILED - no data or invalid response');
      return items;
    }

    for (const recall of data) {
      const recallNumber = recall.RecallNumber || '';
      const title = recall.Title || (recall.Products && recall.Products.length > 0 ? recall.Products[0].Name : '') || 'Unknown Product';
      const description = recall.Description || '';
      const hazards = (recall.Hazards || []).map(h => h.Name || h.HazardType || '').filter(Boolean).join('; ');
      const remedies = (recall.Remedies || []).map(r => r.Name || '').filter(Boolean).join('; ');
      const recallDate = recall.RecallDate || '';
      const images = (recall.Images || []).map(img => img.URL).filter(Boolean);
      const products = (recall.Products || []).map(p => p.Name).filter(Boolean).join(', ');

      // Determine severity based on hazard description
      const hazardLower = (hazards + ' ' + description).toLowerCase();
      let severity = 'Medium';
      if (hazardLower.includes('death') || hazardLower.includes('fatal') || hazardLower.includes('fire') ||
          hazardLower.includes('electrocution') || hazardLower.includes('serious injury') ||
          hazardLower.includes('burn') || hazardLower.includes('choking') || hazardLower.includes('laceration')) {
        severity = 'High';
      } else if (hazardLower.includes('minor') || hazardLower.includes('cosmetic')) {
        severity = 'Low';
      }

      items.push({
        title: cleanText(title),
        description: cleanText(hazards || description),
        category: 'Consumer Products',
        date: recallDate ? recallDate.split('T')[0] : formatDate(new Date()),
        severity,
        remedy: cleanText(remedies) || 'Contact manufacturer',
        link: `https://www.cpsc.gov/Recalls/${recallNumber}`,
        image: images.length > 0 ? images[0] : '',
        source: 'cpsc',
        recallNumber,
        products: cleanText(products),
      });
    }
    log(`  CPSC: ${items.length} recalls`);
  } catch (e) {
    log(`  CPSC ERROR: ${e.message}`);
  }
  return items;
}

// 2. FDA - Food and Drug Administration (food, drug, device)
async function scrapeFDA() {
  log('Scraping FDA Recalls API (food, drug, device)...');
  const items = [];
  const endpoints = [
    { url: 'https://api.fda.gov/food/enforcement.json?limit=50&sort=recall_initiation_date:desc', type: 'food' },
    { url: 'https://api.fda.gov/drug/enforcement.json?limit=50&sort=recall_initiation_date:desc', type: 'drug' },
    { url: 'https://api.fda.gov/device/enforcement.json?limit=50&sort=recall_initiation_date:desc', type: 'device' },
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJSON(endpoint.url, 20000);
      if (!data || !data.results || !Array.isArray(data.results)) {
        log(`  FDA ${endpoint.type}: FAILED - no results`);
        continue;
      }

      for (const recall of data.results) {
        const title = cleanText(recall.product_description || recall.reason_for_recall || 'Unknown Product');
        const description = cleanText(recall.reason_for_recall || '');
        const recallDate = recall.recall_initiation_date || '';
        const classification = recall.classification || '';
        const status = recall.status || '';
        const recallingFirm = recall.recalling_firm || '';
        const recallNumber = recall.recall_number || '';
        const city = recall.city || '';
        const state = recall.state || '';

        // Truncate long product descriptions for the title
        let displayTitle = title;
        if (displayTitle.length > 150) {
          displayTitle = displayTitle.substring(0, 147) + '...';
        }

        // FDA classification: Class I = most serious, Class III = least
        let severity = 'Medium';
        if (classification === 'Class I') severity = 'High';
        else if (classification === 'Class III') severity = 'Low';

        // Format the date (FDA uses YYYYMMDD format)
        let formattedDate = '';
        if (recallDate && recallDate.length === 8) {
          formattedDate = `${recallDate.substring(0, 4)}-${recallDate.substring(4, 6)}-${recallDate.substring(6, 8)}`;
        }

        items.push({
          title: displayTitle,
          description: cleanText(description),
          category: 'Food & Drug',
          date: formattedDate || formatDate(new Date()),
          severity,
          remedy: status === 'Ongoing' ? 'Do not consume/use - contact retailer' : 'Check FDA website for details',
          link: `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts`,
          image: '',
          source: 'fda',
          recallNumber,
          recallingFirm,
          classification,
          fdaType: endpoint.type,
          location: [city, state].filter(Boolean).join(', '),
        });
      }
      log(`  FDA ${endpoint.type}: ${data.results.length} recalls`);
    } catch (e) {
      log(`  FDA ${endpoint.type} ERROR: ${e.message}`);
    }
  }
  log(`  FDA total: ${items.length} recalls`);
  return items;
}

// 3. NHTSA - National Highway Traffic Safety Administration
async function scrapeNHTSA() {
  log('Scraping NHTSA Recalls API...');
  const items = [];
  const year = new Date().getFullYear();

  // Try multiple endpoint formats - the date-range endpoint often returns 0
  const urls = [
    `https://api.nhtsa.gov/recalls/recallsByYear?year=${year}&type=vehicle`,
    `https://api.nhtsa.gov/recalls/recallsByYear?year=${year}&type=equipment`,
    `https://api.nhtsa.gov/recalls/completeByYear?year=${year}&type=vehicle`,
    `https://api.nhtsa.gov/products/vehicle/recalls?modelYear=${year}`,
  ];

  // Also try the old date-range format
  const startDate = formatDate(daysAgo(30));
  const endDate = formatDate(new Date());
  const startParts = startDate.split('-');
  const endParts = endDate.split('-');
  const nhtsaStart = `${startParts[1]}/${startParts[2]}/${startParts[0]}`;
  const nhtsaEnd = `${endParts[1]}/${endParts[2]}/${endParts[0]}`;
  urls.push(`https://api.nhtsa.gov/recalls/recallsByDate?startDate=${nhtsaStart}&endDate=${nhtsaEnd}&type=vehicle`);

  const seenIds = new Set();

  for (const url of urls) {
    try {
      log(`  NHTSA trying: ${url}`);
      const data = await fetchJSON(url, 20000);
      if (!data) { log(`  NHTSA: null response`); continue; }

      // Handle various response shapes
      const results = Array.isArray(data) ? data
        : (data.results && Array.isArray(data.results)) ? data.results
        : (data.Results && Array.isArray(data.Results)) ? data.Results
        : [];

      if (results.length === 0) { log(`  NHTSA: 0 results from this endpoint`); continue; }

      for (const recall of results) {
        const manufacturer = recall.Manufacturer || recall.Make || '';
        const subject = recall.Subject || recall.Summary || recall.Component || '';
        const component = recall.Component || '';
        const nhtsaId = recall.NHTSACampaignNumber || recall.NHTSAActionNumber || recall.CampaignNumber || '';
        const recallDate = recall.ReportReceivedDate || recall.RecallDate || recall.ReportDate || '';
        const consequence = recall.Consequence || '';
        const remedy = recall.Remedy || recall.CorrectiveAction || '';
        const summary = recall.Summary || '';

        // Skip dupes across endpoint attempts
        if (nhtsaId && seenIds.has(nhtsaId)) continue;
        if (nhtsaId) seenIds.add(nhtsaId);

        const title = subject || `${manufacturer} ${component} Recall`;

        const consequenceLower = (consequence + ' ' + summary).toLowerCase();
        let severity = 'Medium';
        if (consequenceLower.includes('crash') || consequenceLower.includes('fire') ||
            consequenceLower.includes('injury') || consequenceLower.includes('death') ||
            consequenceLower.includes('fatal')) {
          severity = 'High';
        } else if (consequenceLower.includes('minor') || consequenceLower.includes('cosmetic') ||
                   consequenceLower.includes('label') || consequenceLower.includes('sticker')) {
          severity = 'Low';
        }

        let formattedDate = '';
        if (recallDate) {
          const parsed = new Date(recallDate);
          if (!isNaN(parsed.getTime())) {
            formattedDate = formatDate(parsed);
          }
        }

        items.push({
          title: cleanText(title),
          description: cleanText(consequence || summary),
          category: 'Vehicles',
          date: formattedDate || formatDate(new Date()),
          severity,
          remedy: cleanText(remedy) || 'Contact your dealer for a free repair',
          link: nhtsaId ? `https://www.nhtsa.gov/recalls?nhtsaId=${nhtsaId}` : 'https://www.nhtsa.gov/recalls',
          image: '',
          source: 'nhtsa',
          recallNumber: nhtsaId,
          manufacturer,
          component: cleanText(component),
        });
      }
      log(`  NHTSA: ${results.length} results from this endpoint (${items.length} total unique)`);
    } catch (e) {
      log(`  NHTSA ERROR for ${url}: ${e.message}`);
    }
  }
  log(`  NHTSA total: ${items.length} recalls`);
  return items;
}

// 4. USDA FSIS - Food Safety and Inspection Service
async function scrapeFSIS() {
  log('Scraping USDA FSIS Recalls...');
  const items = [];

  // Try multiple FSIS endpoints - the old one may have moved
  const urls = [
    'https://www.fsis.usda.gov/sites/default/files/media_file/recall-api.json',
    'https://www.fsis.usda.gov/sites/default/files/media_file/fsis-recalls.json',
    'https://www.fsis.usda.gov/recalls',
  ];

  let data = null;
  let usedUrl = '';
  for (const url of urls) {
    log(`  FSIS trying: ${url}`);
    if (url.endsWith('.json')) {
      data = await fetchJSON(url, 20000);
      if (data && (Array.isArray(data) || (data.results && Array.isArray(data.results)))) {
        usedUrl = url;
        break;
      }
    } else {
      // Try scraping the HTML page
      const html = await fetchPage(url, 20000);
      if (html && html.length > 1000) {
        log(`  FSIS: Got HTML page (${html.length} chars), parsing...`);
        // Look for JSON-LD or structured data embedded in page
        const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (jsonLdMatch) {
          try { data = JSON.parse(jsonLdMatch[1]); usedUrl = url; break; } catch (e) {}
        }
        // Try to extract recall entries from HTML
        const recallItems = [];
        const recallRegex = /<a[^>]+href="(\/recalls-alerts\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = recallRegex.exec(html)) !== null) {
          const href = match[1];
          const text = match[2].replace(/<[^>]+>/g, '').trim();
          if (text.length > 10 && !recallItems.find(r => r.title === text)) {
            recallItems.push({
              title: text,
              url: `https://www.fsis.usda.gov${href}`,
            });
          }
        }
        if (recallItems.length > 0) {
          log(`  FSIS: Extracted ${recallItems.length} items from HTML`);
          for (const ri of recallItems) {
            items.push({
              title: cleanText(ri.title),
              description: '',
              category: 'Food Safety',
              date: formatDate(new Date()),
              severity: 'Medium',
              remedy: 'Do not consume - return to place of purchase or discard',
              link: ri.url,
              image: '',
              source: 'fsis',
              recallNumber: '',
              establishment: '',
              quantity: '',
            });
          }
        }
      }
    }
    data = null;
  }

  // Process JSON data if we got it
  const records = data ? (Array.isArray(data) ? data : (data.results || [])) : [];
  if (records.length > 0) {
    log(`  FSIS: Got ${records.length} JSON records from ${usedUrl}`);
    const cutoffDate = daysAgo(90); // Widen window to 90 days

    for (const recall of records) {
      const title = recall.title || recall.recall_title || recall.product || recall.field_title || 'Unknown Product';
      const description = recall.reason || recall.description || recall.problem || recall.field_reason || '';
      const recallDate = recall.date || recall.recall_date || recall.posted_date || recall.field_date || '';
      const recallNumber = recall.recall_number || recall.id || recall.field_recall_number || '';
      const riskLevel = recall.risk_level || recall.classification || recall.field_risk_level || '';
      const quantity = recall.quantity || recall.field_quantity || '';
      const establishment = recall.establishment || recall.company || recall.field_establishment || '';
      const recallUrl = recall.url || recall.link || recall.field_url || '';

      let formattedDate = '';
      if (recallDate) {
        const parsed = new Date(recallDate);
        if (!isNaN(parsed.getTime())) {
          formattedDate = formatDate(parsed);
          if (parsed < cutoffDate) continue;
        }
      }

      let severity = 'Medium';
      const riskLower = (riskLevel + ' ' + description).toLowerCase();
      if (riskLower.includes('high') || riskLower.includes('class i') ||
          riskLower.includes('health hazard') || riskLower.includes('death')) {
        severity = 'High';
      } else if (riskLower.includes('low') || riskLower.includes('class iii') ||
                 riskLower.includes('marginal')) {
        severity = 'Low';
      }

      let link = recallUrl;
      if (!link || !link.startsWith('http')) {
        link = 'https://www.fsis.usda.gov/recalls-alerts';
      }

      items.push({
        title: cleanText(typeof title === 'string' ? title : JSON.stringify(title)),
        description: cleanText(typeof description === 'string' ? description : JSON.stringify(description)),
        category: 'Food Safety',
        date: formattedDate || formatDate(new Date()),
        severity,
        remedy: 'Do not consume - return to place of purchase or discard',
        link,
        image: '',
        source: 'fsis',
        recallNumber: String(recallNumber),
        establishment: cleanText(establishment),
        quantity: cleanText(quantity),
      });
    }
  }

  log(`  FSIS: ${items.length} recalls total`);
  return items;
}

// 5. Health Canada Recalls
async function scrapeHealthCanada() {
  log('Scraping Health Canada Recalls...');
  const items = [];

  // Try the recalls API (JSON)
  const apiUrls = [
    'https://recalls-rappels.canada.ca/api/search/recalls?lang=en&cat=1&lim=50',
    'https://recalls-rappels.canada.ca/api/search/recalls?lang=en&lim=50',
    'https://healthycanadians.gc.ca/recall-alert-rappel-avis/api/recent/en',
  ];

  for (const url of apiUrls) {
    try {
      log(`  HC trying: ${url}`);
      const data = await fetchJSON(url, 20000);
      if (!data) continue;

      // Handle various response shapes
      const results = Array.isArray(data) ? data
        : (data.results && Array.isArray(data.results)) ? data.results
        : (data.ALL && Array.isArray(data.ALL)) ? data.ALL
        : (data.results_en && Array.isArray(data.results_en)) ? data.results_en
        : [];

      if (results.length === 0) { log(`  HC: 0 results from ${url}`); continue; }

      const cutoff = daysAgo(60);
      for (const recall of results) {
        const title = recall.title || recall.recall_title || recall.Title || '';
        const desc = recall.issue || recall.description || recall.reason || recall.summary || '';
        const dateStr = recall.date_published || recall.start_date || recall.date || recall.Date || '';
        const recallId = recall.recall_id || recall.recallId || recall.id || '';
        const category = recall.category || recall.Category || '';
        const recallUrl = recall.url || recall.link || '';

        if (!title) continue;

        let formattedDate = '';
        if (dateStr) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) {
            formattedDate = formatDate(parsed);
            if (parsed < cutoff) continue;
          }
        }

        const descLower = (desc + ' ' + title).toLowerCase();
        let severity = 'Medium';
        if (descLower.includes('death') || descLower.includes('serious') || descLower.includes('fire') ||
            descLower.includes('choking') || descLower.includes('burn')) {
          severity = 'High';
        } else if (descLower.includes('minor') || descLower.includes('labelling')) {
          severity = 'Low';
        }

        let link = recallUrl;
        if (link && !link.startsWith('http')) {
          link = `https://recalls-rappels.canada.ca${link}`;
        }
        if (!link) link = 'https://recalls-rappels.canada.ca/en';

        items.push({
          title: cleanText(title),
          description: cleanText(desc),
          category: category || 'Consumer Products',
          date: formattedDate || formatDate(new Date()),
          severity,
          remedy: 'Stop using product and check Health Canada for details',
          link,
          image: '',
          source: 'health_canada',
          recallNumber: String(recallId),
        });
      }
      log(`  HC: ${items.length} recalls from API`);
      if (items.length > 0) break; // Got data, stop trying other URLs
    } catch (e) {
      log(`  HC ERROR: ${e.message}`);
    }
  }

  // Fallback: scrape the search page
  if (items.length === 0) {
    try {
      const html = await fetchPage('https://recalls-rappels.canada.ca/en/search/site?f%5B0%5D=category%3A172', 20000);
      if (html && html.length > 500) {
        const linkRegex = /<a[^>]+href="(\/en\/recall-alert\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          const text = match[2].replace(/<[^>]+>/g, '').trim();
          if (text.length > 10) {
            items.push({
              title: cleanText(text),
              description: '',
              category: 'Consumer Products',
              date: formatDate(new Date()),
              severity: 'Medium',
              remedy: 'Stop using product and check Health Canada for details',
              link: `https://recalls-rappels.canada.ca${match[1]}`,
              image: '',
              source: 'health_canada',
              recallNumber: '',
            });
          }
        }
        log(`  HC: ${items.length} recalls from HTML scrape`);
      }
    } catch (e) {
      log(`  HC HTML scrape ERROR: ${e.message}`);
    }
  }

  log(`  Health Canada total: ${items.length} recalls`);
  return items;
}

// 6. EU Safety Gate (RAPEX)
async function scrapeEUSafetyGate() {
  log('Scraping EU Safety Gate (RAPEX)...');
  const items = [];

  // Try the Safety Gate API / data export
  const urls = [
    'https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/listAlertsJSON',
    'https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertListJson',
  ];

  for (const url of urls) {
    try {
      log(`  EU trying: ${url}`);
      const data = await fetchJSON(url, 25000);
      if (!data) continue;

      const results = Array.isArray(data) ? data
        : (data.alerts && Array.isArray(data.alerts)) ? data.alerts
        : (data.data && Array.isArray(data.data)) ? data.data
        : [];

      if (results.length === 0) { log(`  EU: 0 results`); continue; }

      for (const alert of results.slice(0, 50)) {
        const title = alert.title || alert.product || alert.productName || alert.description || '';
        const desc = alert.description || alert.risk || alert.measures || '';
        const dateStr = alert.date || alert.notificationDate || alert.publicationDate || '';
        const alertRef = alert.reference || alert.alertNumber || alert.id || '';
        const country = alert.country || alert.notifyingCountry || '';
        const riskType = alert.riskType || alert.risk || alert.category || '';

        if (!title) continue;

        let formattedDate = '';
        if (dateStr) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) formattedDate = formatDate(parsed);
        }

        const descLower = (desc + ' ' + riskType).toLowerCase();
        let severity = 'Medium';
        if (descLower.includes('serious') || descLower.includes('death') || descLower.includes('fire') ||
            descLower.includes('chemical') || descLower.includes('choking')) {
          severity = 'High';
        }

        items.push({
          title: cleanText(title),
          description: cleanText(desc),
          category: riskType || 'Consumer Products',
          date: formattedDate || formatDate(new Date()),
          severity,
          remedy: 'Product withdrawn from market - do not use',
          link: alertRef ? `https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/${alertRef}` : 'https://ec.europa.eu/safety-gate-alerts/screen/webReport',
          image: '',
          source: 'eu_safety_gate',
          recallNumber: String(alertRef),
          country,
        });
      }
      log(`  EU: ${items.length} alerts from API`);
      if (items.length > 0) break;
    } catch (e) {
      log(`  EU ERROR: ${e.message}`);
    }
  }

  // Fallback: scrape the main page
  if (items.length === 0) {
    try {
      const html = await fetchPage('https://ec.europa.eu/safety-gate-alerts/screen/webReport', 25000);
      if (html && html.length > 500) {
        // Look for alert references in the page
        const alertRegex = /alertDetail\/(\w+\.\d+[^"'\s]*)"[^>]*>([^<]+)/gi;
        let match;
        while ((match = alertRegex.exec(html)) !== null) {
          const ref = match[1];
          const text = match[2].trim();
          if (text.length > 5) {
            items.push({
              title: cleanText(text),
              description: '',
              category: 'Consumer Products',
              date: formatDate(new Date()),
              severity: 'Medium',
              remedy: 'Product withdrawn from market - do not use',
              link: `https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/${ref}`,
              image: '',
              source: 'eu_safety_gate',
              recallNumber: ref,
            });
          }
        }
        log(`  EU: ${items.length} alerts from HTML scrape`);
      }
    } catch (e) {
      log(`  EU HTML scrape ERROR: ${e.message}`);
    }
  }

  log(`  EU Safety Gate total: ${items.length} alerts`);
  return items;
}

// 7. Consumer Reports Recalls
async function scrapeConsumerReports() {
  log('Scraping Consumer Reports Recalls...');
  const items = [];

  try {
    const html = await fetchPage('https://www.consumerreports.org/recalls/', 20000);
    if (!html || html.length < 500) {
      log('  CR: FAILED - no/short response');
      return items;
    }
    log(`  CR: Got page (${html.length} chars)`);

    // Try to find recall listing links
    const linkRegex = /<a[^>]+href="(https?:\/\/www\.consumerreports\.org\/recalls\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, '').trim();
      if (text.length > 10 && !text.toLowerCase().includes('sign in') && !text.toLowerCase().includes('menu')) {
        items.push({
          title: cleanText(text),
          description: '',
          category: 'Consumer Products',
          date: formatDate(new Date()),
          severity: 'Medium',
          remedy: 'Check Consumer Reports for details',
          link: href,
          image: '',
          source: 'consumer_reports',
          recallNumber: '',
        });
      }
    }

    // Also try generic article links with recall in path
    if (items.length === 0) {
      const genericRegex = /<a[^>]+href="(\/recalls\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = genericRegex.exec(html)) !== null) {
        const text = match[2].replace(/<[^>]+>/g, '').trim();
        if (text.length > 10 && !text.toLowerCase().includes('sign in')) {
          items.push({
            title: cleanText(text),
            description: '',
            category: 'Consumer Products',
            date: formatDate(new Date()),
            severity: 'Medium',
            remedy: 'Check Consumer Reports for details',
            link: `https://www.consumerreports.org${match[1]}`,
            image: '',
            source: 'consumer_reports',
            recallNumber: '',
          });
        }
      }
    }

    log(`  CR: ${items.length} recalls`);
  } catch (e) {
    log(`  CR ERROR: ${e.message}`);
  }
  return items;
}

// 8. Recalled.com.au (Australia)
async function scrapeRecalledAU() {
  log('Scraping Recalled.com.au...');
  const items = [];

  // Try RSS feed first
  const rssUrls = [
    'https://www.productsafety.gov.au/feeds/recalls',
    'https://www.productsafety.gov.au/rss/recalls',
    'https://www.recalls.gov.au/feed',
  ];

  for (const url of rssUrls) {
    try {
      log(`  AU trying RSS: ${url}`);
      const xml = await fetchPage(url, 20000);
      if (!xml || xml.length < 200) continue;

      // Parse RSS items
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const titleMatch = block.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/);
        const linkMatch = block.match(/<link>(.*?)<\/link>/);
        const descMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>|<description>([\s\S]*?)<\/description>/);
        const dateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/);

        const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '') : '';
        const link = linkMatch ? linkMatch[1].trim() : '';
        const desc = descMatch ? (descMatch[1] || descMatch[2] || '').replace(/<[^>]+>/g, '') : '';
        const pubDate = dateMatch ? dateMatch[1] : '';

        if (!title) continue;

        let formattedDate = '';
        if (pubDate) {
          const parsed = new Date(pubDate);
          if (!isNaN(parsed.getTime())) formattedDate = formatDate(parsed);
        }

        items.push({
          title: cleanText(title),
          description: cleanText(desc),
          category: 'Consumer Products',
          date: formattedDate || formatDate(new Date()),
          severity: 'Medium',
          remedy: 'Stop using product - check recall notice for details',
          link: link || 'https://www.productsafety.gov.au/recalls',
          image: '',
          source: 'recalled_au',
          recallNumber: '',
        });
      }
      if (items.length > 0) {
        log(`  AU: ${items.length} recalls from RSS`);
        break;
      }
    } catch (e) {
      log(`  AU RSS ERROR: ${e.message}`);
    }
  }

  // Fallback: scrape the main recalls page
  if (items.length === 0) {
    try {
      const html = await fetchPage('https://www.productsafety.gov.au/recalls', 20000);
      if (html && html.length > 500) {
        const linkRegex = /<a[^>]+href="(\/recalls\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          const text = match[2].replace(/<[^>]+>/g, '').trim();
          if (text.length > 10) {
            items.push({
              title: cleanText(text),
              description: '',
              category: 'Consumer Products',
              date: formatDate(new Date()),
              severity: 'Medium',
              remedy: 'Stop using product - check recall notice for details',
              link: `https://www.productsafety.gov.au${match[1]}`,
              image: '',
              source: 'recalled_au',
              recallNumber: '',
            });
          }
        }
        log(`  AU: ${items.length} recalls from HTML scrape`);
      }
    } catch (e) {
      log(`  AU HTML ERROR: ${e.message}`);
    }
  }

  log(`  Recalled AU total: ${items.length} recalls`);
  return items;
}

// === DEDUP ===
function dedup(allItems) {
  const seen = new Set();
  const deduped = [];
  for (const item of allItems) {
    // Key on recall number + source, or normalized title if no recall number
    const key = item.recallNumber
      ? `${item.source}:${item.recallNumber}`
      : `${item.source}:${item.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

// === MAIN ===
async function main() {
  const startTime = Date.now();
  log('========================================');
  log('Recall Alerts Scraper - Starting');
  log('========================================');

  // Ensure directories exist
  const dirs = [
    DATA_DIR,
    path.join(__dirname, 'site', 'data'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Scrape all sources in parallel
  const results_arr = await Promise.allSettled([
    scrapeCPSC().catch(e => { log(`CPSC FATAL: ${e.message}`); return []; }),
    scrapeFDA().catch(e => { log(`FDA FATAL: ${e.message}`); return []; }),
    scrapeNHTSA().catch(e => { log(`NHTSA FATAL: ${e.message}`); return []; }),
    scrapeFSIS().catch(e => { log(`FSIS FATAL: ${e.message}`); return []; }),
    scrapeHealthCanada().catch(e => { log(`Health Canada FATAL: ${e.message}`); return []; }),
    scrapeEUSafetyGate().catch(e => { log(`EU Safety Gate FATAL: ${e.message}`); return []; }),
    scrapeConsumerReports().catch(e => { log(`Consumer Reports FATAL: ${e.message}`); return []; }),
    scrapeRecalledAU().catch(e => { log(`Recalled AU FATAL: ${e.message}`); return []; }),
  ]);

  const allScraped = results_arr.flatMap(r => r.status === 'fulfilled' ? (r.value || []) : []);

  // Deduplicate
  const results = dedup(allScraped);

  // Sort by date descending (most recent first)
  results.sort((a, b) => {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return 0;
  });

  // Add scraped timestamp
  for (const item of results) {
    item.date_scraped = new Date().toISOString().split('T')[0];
  }

  // Count by source
  const counts = { cpsc: 0, fda: 0, nhtsa: 0, fsis: 0, health_canada: 0, eu_safety_gate: 0, consumer_reports: 0, recalled_au: 0 };
  for (const item of results) {
    counts[item.source] = (counts[item.source] || 0) + 1;
  }

  // Summary
  log('');
  log('========================================');
  log('RESULTS SUMMARY');
  log('========================================');
  log(`Total recalls found: ${allScraped.length}`);
  log(`After dedup: ${results.length}`);
  log('');
  log('By source:');
  for (const [src, count] of Object.entries(counts)) {
    log(`  ${src.toUpperCase()}: ${count}`);
  }

  // Count by severity
  const severityCounts = { High: 0, Medium: 0, Low: 0 };
  for (const item of results) {
    severityCounts[item.severity] = (severityCounts[item.severity] || 0) + 1;
  }
  log('');
  log('By severity:');
  for (const [sev, count] of Object.entries(severityCounts)) {
    log(`  ${sev}: ${count}`);
  }

  // Count by category
  const categoryCounts = {};
  for (const item of results) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  }
  log('');
  log('By category:');
  for (const [cat, count] of Object.entries(categoryCounts)) {
    log(`  ${cat}: ${count}`);
  }

  // Save results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  log(`\nSaved ${results.length} recalls to ${RESULTS_FILE}`);

  // Copy to site data
  fs.writeFileSync(SITE_DATA_FILE, JSON.stringify(results, null, 2));
  log(`Copied to ${SITE_DATA_FILE}`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`\nDone in ${elapsed}s`);
  log('========================================');
}

main().catch(e => {
  log(`FATAL ERROR: ${e.message}`);
  process.exit(1);
});
