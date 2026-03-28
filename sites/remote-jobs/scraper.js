#!/usr/bin/env node
// Remote Jobs Aggregator Scraper
// Run: node sites/remote-jobs/scraper.js
// Scrapes 6 sources for remote job listings, deduplicates, saves JSON

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

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/<!\[CDATA\[|\]\]>/g, '');
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(str, max = 200) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

function fetchPage(url, timeout = 20000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
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

function parseRssItems(xml) {
  return (xml.match(/<item>([\s\S]*?)<\/item>/g) || []).map(item => {
    const getTag = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decodeEntities(m[1].trim()) : '';
    };
    const getAllTags = (tag) => {
      return (item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')) || [])
        .map(c => decodeEntities(c.replace(new RegExp(`<\\/?${tag}[^>]*>`, 'g'), '')));
    };
    return {
      title: getTag('title'),
      link: getTag('link'),
      description: getTag('description'),
      pubDate: getTag('pubDate'),
      categories: getAllTags('category'),
    };
  });
}

// === CATEGORY NORMALIZATION ===
const CATEGORY_MAP = {
  'programming': 'Engineering', 'engineering': 'Engineering', 'software': 'Engineering',
  'devops': 'Engineering', 'backend': 'Engineering', 'frontend': 'Engineering',
  'full-stack': 'Engineering', 'full stack': 'Engineering', 'fullstack': 'Engineering',
  'data': 'Engineering', 'data science': 'Engineering', 'machine learning': 'Engineering',
  'sysadmin': 'Engineering', 'qa': 'Engineering', 'security': 'Engineering',
  'dev': 'Engineering', 'developer': 'Engineering', 'web dev': 'Engineering',
  'infosec': 'Engineering',
  'marketing': 'Marketing', 'seo': 'Marketing', 'content': 'Marketing', 'growth': 'Marketing',
  'copywriting': 'Marketing', 'social media': 'Marketing',
  'design': 'Design', 'ui': 'Design', 'ux': 'Design', 'graphic': 'Design',
  'product design': 'Design', 'visual': 'Design',
  'sales': 'Sales', 'business development': 'Sales', 'account': 'Sales',
  'customer support': 'Customer Support', 'customer service': 'Customer Support',
  'support': 'Customer Support', 'customer success': 'Customer Support',
  'product': 'Product', 'product management': 'Product', 'project management': 'Product',
};

function normalizeCategory(raw) {
  if (!raw) return 'Other';
  const lower = raw.toLowerCase().trim();
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) return val;
  }
  return 'Other';
}

function normalizeJobType(raw) {
  if (!raw) return 'Full-time';
  const lower = raw.toLowerCase();
  if (lower.includes('part')) return 'Part-time';
  if (lower.includes('contract') || lower.includes('freelance')) return 'Contract';
  if (lower.includes('freelance')) return 'Freelance';
  return 'Full-time';
}

function normalizeLocation(raw) {
  if (!raw) return 'Worldwide';
  const s = raw.trim();
  if (!s || s.toLowerCase() === 'anywhere' || s.toLowerCase() === 'remote') return 'Worldwide';
  return s;
}

function makeJob({ title, company, description, salary, category, location, link, image, source, date_posted, job_type }) {
  return {
    title: (title || '').trim(),
    company: (company || '').trim(),
    description: truncate(stripHtml(description || '')),
    salary: (salary || '').trim(),
    category: normalizeCategory(category),
    location: normalizeLocation(location),
    link: (link || '').trim(),
    image: (image || '').trim(),
    source: source || '',
    date_posted: date_posted || new Date().toISOString().split('T')[0],
    job_type: normalizeJobType(job_type),
  };
}

// === SCRAPERS ===

async function scrapeWeWorkRemotely() {
  log('Scraping We Work Remotely (RSS)...');
  const items = [];
  const xml = await fetchPage('https://weworkremotely.com/remote-jobs.rss');
  if (!xml) { log('  WWR: FAILED to fetch RSS'); return items; }

  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    // WWR titles are often "Company: Job Title"
    let company = '';
    let title = rss.title;
    const colonIdx = rss.title.indexOf(':');
    if (colonIdx > 0 && colonIdx < 60) {
      company = rss.title.substring(0, colonIdx).trim();
      title = rss.title.substring(colonIdx + 1).trim();
    }
    const catRaw = rss.categories.length > 0 ? rss.categories[0] : '';
    items.push(makeJob({
      title,
      company,
      description: rss.description,
      category: catRaw,
      link: rss.link,
      source: 'weworkremotely',
      date_posted: rss.pubDate ? new Date(rss.pubDate).toISOString().split('T')[0] : '',
    }));
  }
  log(`  WWR: ${items.length} jobs`);
  return items;
}

async function scrapeRemotive() {
  log('Scraping Remotive (JSON API)...');
  const items = [];
  const data = await fetchJSON('https://remotive.com/api/remote-jobs');
  if (!data || !data.jobs) { log('  Remotive: FAILED'); return items; }

  for (const job of data.jobs) {
    items.push(makeJob({
      title: job.title,
      company: job.company_name,
      description: job.description,
      salary: job.salary || '',
      category: job.category,
      location: job.candidate_required_location,
      link: job.url,
      image: job.company_logo_url || job.company_logo || '',
      source: 'remotive',
      date_posted: job.publication_date ? job.publication_date.split('T')[0] : '',
      job_type: job.job_type,
    }));
  }
  log(`  Remotive: ${items.length} jobs`);
  return items;
}

async function scrapeHimalayas() {
  log('Scraping Himalayas (JSON API)...');
  const items = [];
  const data = await fetchJSON('https://himalayas.app/jobs/api?limit=50');
  if (!data || !data.jobs) { log('  Himalayas: FAILED or unexpected format'); return items; }

  for (const job of data.jobs) {
    items.push(makeJob({
      title: job.title,
      company: job.companyName || (job.company && job.company.name) || '',
      description: job.excerpt || job.description || '',
      salary: job.minSalary && job.maxSalary
        ? `$${job.minSalary.toLocaleString()} - $${job.maxSalary.toLocaleString()}`
        : (job.salary || ''),
      category: (job.categories && job.categories[0]) || job.category || '',
      location: job.locationRestrictions
        ? (Array.isArray(job.locationRestrictions) ? job.locationRestrictions.join(', ') : job.locationRestrictions)
        : '',
      link: job.applicationUrl || job.url || (job.slug ? `https://himalayas.app/jobs/${job.slug}` : ''),
      image: job.companyLogo || (job.company && job.company.logo) || '',
      source: 'himalayas',
      date_posted: job.pubDate || job.publishedDate || job.postedDate || '',
      job_type: job.type || '',
    }));
  }
  log(`  Himalayas: ${items.length} jobs`);
  return items;
}

async function scrapeRemoteOK() {
  log('Scraping Remote OK (JSON API)...');
  const items = [];
  const data = await fetchJSON('https://remoteok.com/api');
  if (!data || !Array.isArray(data)) { log('  RemoteOK: FAILED'); return items; }

  for (const job of data) {
    // First item is usually a legal notice, skip non-job entries
    if (!job.position && !job.title) continue;
    if (job.legal) continue;

    const title = job.position || job.title || '';
    const tags = Array.isArray(job.tags) ? job.tags.join(', ') : '';
    const salary = (job.salary_min && job.salary_max)
      ? `$${Number(job.salary_min).toLocaleString()} - $${Number(job.salary_max).toLocaleString()}`
      : (job.salary || '');

    items.push(makeJob({
      title,
      company: job.company || '',
      description: job.description || tags,
      salary,
      category: tags,
      location: job.location || '',
      link: job.url || (job.slug ? `https://remoteok.com/remote-jobs/${job.slug}` : ''),
      image: job.company_logo || job.logo || '',
      source: 'remoteok',
      date_posted: job.date ? job.date.split('T')[0] : '',
      job_type: '',
    }));
  }
  log(`  RemoteOK: ${items.length} jobs`);
  return items;
}

async function scrapeHackerNewsHiring() {
  log('Scraping Hacker News Who is Hiring...');
  const items = [];

  // Find the latest "Who is hiring?" thread from the HN user "whoishiring"
  const user = await fetchJSON('https://hacker-news.firebaseio.com/v0/user/whoishiring.json');
  if (!user || !user.submitted || user.submitted.length === 0) {
    log('  HN: FAILED to fetch whoishiring user');
    return items;
  }

  // Check the most recent submissions to find the hiring thread
  let hiringThreadId = null;
  const candidates = user.submitted.slice(0, 6); // Check last 6 posts
  for (const id of candidates) {
    const story = await fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    if (story && story.title && story.title.toLowerCase().includes('who is hiring')) {
      hiringThreadId = id;
      log(`  HN: Found hiring thread: "${story.title}" (ID: ${id})`);
      break;
    }
  }

  if (!hiringThreadId) {
    log('  HN: Could not find recent hiring thread');
    return items;
  }

  const thread = await fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${hiringThreadId}.json`);
  if (!thread || !thread.kids || thread.kids.length === 0) {
    log('  HN: Thread has no comments');
    return items;
  }

  // Fetch up to 50 top-level comments
  const commentIds = thread.kids.slice(0, 50);
  const comments = [];
  // Batch fetch comments
  for (let i = 0; i < commentIds.length; i += 10) {
    const batch = commentIds.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(cid => fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${cid}.json`))
    );
    comments.push(...results.filter(Boolean));
  }

  for (const comment of comments) {
    if (!comment.text || comment.dead || comment.deleted) continue;
    const text = stripHtml(comment.text);
    if (text.length < 20) continue;

    // HN hiring posts typically start with "Company | Role | Location | ..."
    const parts = text.split('|').map(p => p.trim());
    let company = '', title = '', location = '';
    if (parts.length >= 2) {
      company = parts[0].substring(0, 80);
      title = parts[1].substring(0, 120);
      location = parts.length >= 3 ? parts[2].substring(0, 80) : 'Remote';
    } else {
      // Single line — use first ~100 chars as title
      title = text.substring(0, 120);
    }

    // Check if it mentions remote
    const lowerText = text.toLowerCase();
    const isRemote = lowerText.includes('remote') || lowerText.includes('anywhere')
      || lowerText.includes('distributed') || lowerText.includes('work from home');
    if (!isRemote && parts.length >= 3) continue; // Skip non-remote posts

    // Try to extract salary
    let salary = '';
    const salaryMatch = text.match(/\$[\d,]+\s*[-\u2013]\s*\$[\d,]+/);
    if (salaryMatch) salary = salaryMatch[0];

    items.push(makeJob({
      title: title || 'See posting',
      company,
      description: truncate(text, 200),
      salary,
      category: '',
      location: location || 'Remote',
      link: `https://news.ycombinator.com/item?id=${comment.id}`,
      source: 'hackernews',
      date_posted: comment.time ? new Date(comment.time * 1000).toISOString().split('T')[0] : '',
    }));
  }
  log(`  HN: ${items.length} remote jobs from hiring thread`);
  return items;
}

async function scrapeArbeitnow() {
  log('Scraping Arbeitnow (JSON API)...');
  const items = [];
  const data = await fetchJSON('https://www.arbeitnow.com/api/job-board-api?page=1');
  if (!data || !data.data) { log('  Arbeitnow: FAILED'); return items; }

  for (const job of data.data) {
    // Only include remote jobs
    if (!job.remote) continue;

    items.push(makeJob({
      title: job.title,
      company: job.company_name,
      description: job.description || job.tags ? job.tags.join(', ') : '',
      salary: job.salary || '',
      category: (job.tags && job.tags.length > 0) ? job.tags[0] : '',
      location: job.location || 'Remote',
      link: job.url,
      image: job.company_logo || '',
      source: 'arbeitnow',
      date_posted: job.created_at ? new Date(job.created_at * 1000).toISOString().split('T')[0] : '',
      job_type: job.job_types ? job.job_types[0] : '',
    }));
  }
  log(`  Arbeitnow: ${items.length} remote jobs`);
  return items;
}

// --- NEW SOURCES ---

async function scrapeJobicy() {
  log('Scraping Jobicy (JSON API)...');
  const items = [];
  const data = await fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=50');
  if (!data || !data.jobs) { log('  Jobicy: FAILED'); return items; }
  for (const job of data.jobs) {
    items.push(makeJob({
      title: job.jobTitle || '',
      company: job.companyName || '',
      description: job.jobExcerpt || job.jobDescription || '',
      salary: job.annualSalaryMin && job.annualSalaryMax ? `$${job.annualSalaryMin} - $${job.annualSalaryMax}` : (job.annualSalaryMin ? `$${job.annualSalaryMin}+` : ''),
      category: job.jobIndustry ? job.jobIndustry[0] || '' : '',
      location: job.jobGeo || 'Worldwide',
      link: job.url || '',
      image: job.companyLogo || '',
      source: 'jobicy',
      date_posted: job.pubDate ? job.pubDate.split('T')[0] : '',
      job_type: job.jobType ? job.jobType[0] || '' : '',
    }));
  }
  log(`  Jobicy: ${items.length} jobs`);
  return items;
}

async function scrapeRemotecoZA() {
  log('Scraping Remoteco (RSS)...');
  const items = [];
  const xml = await fetchPage('https://remote.co/remote-jobs/feed/');
  if (!xml) { log('  Remoteco: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    const cat = rss.categories.length > 0 ? rss.categories[0] : '';
    items.push(makeJob({
      title: decodeEntities(rss.title.trim()),
      company: '',
      description: '',
      salary: '',
      category: cat,
      location: 'Remote',
      link: rss.link.trim(),
      image: '',
      source: 'remoteco',
      date_posted: '',
      job_type: 'Full-time',
    }));
  }
  log(`  Remoteco: ${items.length} jobs`);
  return items;
}

async function scrapeBuiltInRemote() {
  log('Scraping BuiltIn Remote Jobs (RSS)...');
  const items = [];
  const xml = await fetchPage('https://builtin.com/jobs/remote/feed');
  if (!xml) {
    // Try alternate URL
    const xml2 = await fetchPage('https://builtin.com/feed/jobs');
    if (!xml2) { log('  BuiltIn: FAILED'); return items; }
  }
  const feed = xml || '';
  for (const rss of parseRssItems(feed)) {
    if (!rss.title || !rss.link) continue;
    if (!rss.title.toLowerCase().includes('remote') && !rss.link.includes('remote')) continue;
    items.push(makeJob({
      title: decodeEntities(rss.title.trim()),
      company: '',
      description: '',
      salary: '',
      category: rss.categories.length > 0 ? rss.categories[0] : '',
      location: 'Remote',
      link: rss.link.trim(),
      image: '',
      source: 'builtin',
      date_posted: '',
      job_type: 'Full-time',
    }));
  }
  log(`  BuiltIn: ${items.length} remote jobs`);
  return items;
}

async function scrapeJobspresso() {
  log('Scraping Jobspresso (RSS)...');
  const items = [];
  const xml = await fetchPage('https://jobspresso.co/browsejobs/feed/');
  if (!xml) { log('  Jobspresso: FAILED'); return items; }
  for (const rss of parseRssItems(xml)) {
    if (!rss.title || !rss.link) continue;
    items.push(makeJob({
      title: decodeEntities(rss.title.trim()),
      company: '',
      description: '',
      salary: '',
      category: rss.categories.length > 0 ? rss.categories[0] : '',
      location: 'Remote',
      link: rss.link.trim(),
      image: '',
      source: 'jobspresso',
      date_posted: '',
      job_type: 'Full-time',
    }));
  }
  log(`  Jobspresso: ${items.length} jobs`);
  return items;
}

async function scrapeFindRemotelyDev() {
  log('Scraping FindRemotely (JSON)...');
  const items = [];
  const data = await fetchJSON('https://findremotely.com/api/jobs');
  if (data && Array.isArray(data)) {
    for (const job of data.slice(0, 50)) {
      items.push(makeJob({
        title: job.title || '',
        company: job.company || '',
        description: job.description || '',
        salary: job.salary || '',
        category: job.category || '',
        location: job.location || 'Remote',
        link: job.url || job.link || '',
        image: job.logo || '',
        source: 'findremotely',
        date_posted: job.date || '',
        job_type: job.type || 'Full-time',
      }));
    }
  }
  if (!items.length) { log('  FindRemotely: no results or FAILED'); }
  else { log(`  FindRemotely: ${items.length} jobs`); }
  return items;
}

async function scrapeWorkingNomads() {
  log('Scraping Working Nomads (JSON API)...');
  const items = [];
  const data = await fetchJSON('https://www.workingnomads.com/api/exposed_jobs/');
  if (!data || !Array.isArray(data)) { log('  WorkingNomads: FAILED'); return items; }
  for (const job of data.slice(0, 100)) {
    items.push(makeJob({
      title: job.title || '',
      company: job.company_name || '',
      description: job.description || '',
      salary: '',
      category: job.category_name || '',
      location: job.location || 'Remote',
      link: job.url || '',
      image: '',
      source: 'workingnomads',
      date_posted: job.pub_date ? job.pub_date.split('T')[0] : '',
      job_type: 'Full-time',
    }));
  }
  log(`  WorkingNomads: ${items.length} jobs`);
  return items;
}

// === DEDUPLICATION ===
function deduplicateJobs(jobs) {
  const seen = new Set();
  const unique = [];
  for (const job of jobs) {
    // Key on normalized title + company
    const key = (job.title + '||' + job.company).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    // Also check URL dedup
    if (job.link && seen.has(job.link)) continue;
    seen.add(key);
    if (job.link) seen.add(job.link);
    unique.push(job);
  }
  return unique;
}

// === MAIN ===
async function main() {
  log('=== Remote Jobs Scraper START ===');
  const startTime = Date.now();

  // Ensure directories exist
  for (const dir of [DATA_DIR, path.join(__dirname, 'site', 'data')]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Run all scrapers (some in parallel where safe)
  const results = await Promise.allSettled([
    scrapeWeWorkRemotely(),
    scrapeRemotive(),
    scrapeHimalayas(),
    scrapeRemoteOK(),
    scrapeHackerNewsHiring(),
    scrapeArbeitnow(),
    scrapeJobicy(),
    scrapeRemotecoZA(),
    scrapeBuiltInRemote(),
    scrapeJobspresso(),
    scrapeFindRemotelyDev(),
    scrapeWorkingNomads(),
  ]);

  const sourceNames = ['weworkremotely', 'remotive', 'himalayas', 'remoteok', 'hackernews', 'arbeitnow', 'jobicy', 'remoteco', 'builtin', 'jobspresso', 'findremotely', 'workingnomads'];
  let allJobs = [];
  const counts = {};

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = sourceNames[i];
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      counts[name] = r.value.length;
      allJobs.push(...r.value);
    } else {
      counts[name] = 0;
      log(`  ${name}: ERROR - ${r.reason || 'unknown'}`);
    }
  }

  // Filter out jobs without title or link
  allJobs = allJobs.filter(j => j.title && j.link);

  const beforeDedup = allJobs.length;
  allJobs = deduplicateJobs(allJobs);

  // Sort by date posted (newest first)
  allJobs.sort((a, b) => {
    if (!a.date_posted) return 1;
    if (!b.date_posted) return -1;
    return b.date_posted.localeCompare(a.date_posted);
  });

  // Save results
  const output = {
    last_updated: new Date().toISOString(),
    total_jobs: allJobs.length,
    sources: counts,
    jobs: allJobs,
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${RESULTS_FILE}`);

  fs.writeFileSync(SITE_DATA_FILE, JSON.stringify(output, null, 2));
  log(`Saved ${SITE_DATA_FILE}`);

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('');
  log('=== SUMMARY ===');
  log(`Total raw: ${beforeDedup} | After dedup: ${allJobs.length} | Time: ${elapsed}s`);
  for (const [src, count] of Object.entries(counts)) {
    log(`  ${src}: ${count}`);
  }
  log('=== Remote Jobs Scraper DONE ===');
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
