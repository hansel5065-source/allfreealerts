#!/usr/bin/env node
// Verified Paid Opportunities Directory Scraper
// Run: node sites/paid-opps/scraper.js
// Aggregates surveys, user testing, focus groups, product testing, mystery shopping, medical studies
// Includes 130+ curated platforms + live ClinicalTrials.gov API scraping

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const SITE_DATA_FILE = path.join(__dirname, 'site', 'data.json');
const LOG_FILE = path.join(DATA_DIR, 'scraper.log');
const RATE_LIMIT_MS = 600; // delay between URL validation requests
const URL_CHECK_TIMEOUT = 12000;
const CLINICAL_TRIALS_LIMIT = 50;

// === UTILITIES ===
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(str, max = 300) {
  if (!str) return '';
  str = str.trim();
  return str.length > max ? str.substring(0, max).replace(/\s+\S*$/, '') + '...' : str;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function fetchUrl(url, options = {}) {
  const timeout = options.timeout || 15000;
  const acceptJson = options.json || false;
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': acceptJson ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const resolved = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchUrl(resolved, options).then(resolve);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: d, ok: res.statusCode >= 200 && res.statusCode < 400 });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: '', ok: false, error: e.message }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, body: '', ok: false, error: 'timeout' }); });
  });
}

async function checkUrl(url) {
  try {
    const res = await fetchUrl(url, { timeout: URL_CHECK_TIMEOUT });
    return res.ok;
  } catch {
    return false;
  }
}

// === MASSIVE CURATED DATABASE ===
// Each entry is a verified paid opportunity platform

const CURATED_PLATFORMS = [

  // ========================================================================
  // SURVEYS (36 platforms)
  // ========================================================================
  {
    title: 'Prolific',
    category: 'surveys',
    url: 'https://www.prolific.com',
    signupUrl: 'https://app.prolific.com/register/participant',
    description: 'Academic research platform connecting researchers with participants. Known for fair pay and ethical research standards. One of the highest-paying survey platforms.',
    payType: 'cash',
    typicalPay: '$8-$16/hr',
    payRange: { min: 8, max: 16 },
    format: 'remote',
    qualification: 'General public, 18+, multiple countries',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly', 'high-pay'],
    pros: ['Highest per-hour pay among survey sites', 'Ethical research standards', 'Quick PayPal payouts', 'Transparent pay rates shown upfront'],
    cons: ['Studies fill up fast', 'Some demographic groups get fewer studies', 'Must check frequently for new studies']
  },
  {
    title: 'Survey Junkie',
    category: 'surveys',
    url: 'https://www.surveyjunkie.com',
    signupUrl: 'https://www.surveyjunkie.com/signup',
    description: 'One of the largest survey platforms with millions of members. Complete profile surveys to get matched with relevant studies. Points convert to cash or gift cards.',
    payType: 'mixed',
    typicalPay: '$1-$5/survey',
    payRange: { min: 1, max: 40 },
    format: 'remote',
    qualification: 'US, Canada, Australia, 16+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Low cashout threshold ($5)', 'Many surveys available daily', 'Direct bank transfer option', 'A+ BBB rating'],
    cons: ['Frequent disqualifications', 'Some surveys pay under $1', 'Points expire after 12 months of inactivity']
  },
  {
    title: 'Pinecone Research',
    category: 'surveys',
    url: 'https://www.pineconeresearch.com',
    signupUrl: 'https://www.pineconeresearch.com',
    description: 'Invite-only premium survey panel by Nielsen. Known for consistent pay per survey and occasional product testing opportunities.',
    payType: 'cash',
    typicalPay: '$3-$5/survey',
    payRange: { min: 3, max: 5 },
    format: 'remote',
    qualification: 'Invite-only, US 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'needs-qualification'],
    pros: ['Consistent $3-5 per survey', 'No disqualifications once invited', 'Product testing opportunities', 'Check or PayPal payments'],
    cons: ['Invite-only registration', 'Limited number of surveys per month', 'Not always accepting new members']
  },
  {
    title: 'Swagbucks',
    category: 'surveys',
    url: 'https://www.swagbucks.com',
    signupUrl: 'https://www.swagbucks.com/register',
    description: 'Multi-reward platform offering surveys, watching videos, shopping cashback, and more. One of the most popular GPT sites with a $5 signup bonus.',
    payType: 'mixed',
    typicalPay: '$0.50-$5/survey',
    payRange: { min: 0, max: 50 },
    format: 'remote',
    qualification: 'US, UK, Canada, Australia, 13+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Multiple ways to earn beyond surveys', '$5 signup bonus', 'Low $5 cashout for gift cards', 'Established company since 2008'],
    cons: ['Low pay for most surveys', 'Frequent screener disqualifications', 'Videos pay very little']
  },
  {
    title: 'Branded Surveys',
    category: 'surveys',
    url: 'https://www.branded.com/surveys',
    signupUrl: 'https://www.branded.com/surveys/signup',
    description: 'Growing survey platform with a loyalty program that increases earnings over time. Offers daily and weekly challenges for bonus points.',
    payType: 'mixed',
    typicalPay: '$0.50-$5/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'US, UK, Canada, 16+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Loyalty tiers increase earnings', 'Daily polls for quick points', 'Multiple cashout options', 'Fast payments'],
    cons: ['Screener disqualifications', 'Need to reach $5 minimum', 'Some surveys are repetitive']
  },
  {
    title: 'InboxDollars',
    category: 'surveys',
    url: 'https://www.inboxdollars.com',
    signupUrl: 'https://www.inboxdollars.com/signup',
    description: 'Cash-based rewards site that pays for surveys, reading emails, watching videos, and playing games. Owned by Prodege. $5 sign-up bonus.',
    payType: 'cash',
    typicalPay: '$0.50-$5/survey',
    payRange: { min: 0, max: 20 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['$5 signup bonus', 'Shows earnings in dollars not points', 'Multiple earning methods', 'Long-standing company'],
    cons: ['High $15 minimum cashout', 'Low pay per activity', 'Processing fees on some withdrawals']
  },
  {
    title: 'MyPoints',
    category: 'surveys',
    url: 'https://www.mypoints.com',
    signupUrl: 'https://www.mypoints.com/join',
    description: 'Points-based rewards platform offering surveys, shopping cashback, and various offers. Sister site to InboxDollars. Redeem for gift cards or PayPal.',
    payType: 'mixed',
    typicalPay: '$0.50-$5/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['$10 signup bonus with first purchase', 'Shopping cashback included', 'Many gift card options', 'Part of Prodege network'],
    cons: ['Points system can be confusing', 'Surveys can be repetitive', 'Some offers require purchases']
  },
  {
    title: 'LifePoints',
    category: 'surveys',
    url: 'https://www.lifepointspanel.com',
    signupUrl: 'https://www.lifepointspanel.com/signup',
    description: 'Global survey panel by Lightspeed (Kantar). Earn points for surveys on consumer products, services, and trends. Available in 40+ countries.',
    payType: 'mixed',
    typicalPay: '$0.50-$3/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'Global, 16+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Available worldwide in 40+ countries', 'Reputable market research company', 'Regular survey invitations', 'Gift card and PayPal options'],
    cons: ['Low pay per survey', 'Frequent disqualifications', 'Points expire after 2 years inactivity']
  },
  {
    title: 'Toluna',
    category: 'surveys',
    url: 'https://www.toluna.com',
    signupUrl: 'https://www.toluna.com/registration',
    description: 'Large international survey community with product testing opportunities. Create polls, engage with content, and earn rewards for sharing opinions.',
    payType: 'mixed',
    typicalPay: '$1-$5/survey',
    payRange: { min: 0, max: 15 },
    format: 'remote',
    qualification: 'Global, 16+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Community features and polls', 'Product testing opportunities', 'Available in many countries', 'Sweepstakes entries'],
    cons: ['Slow point accumulation', 'High minimum to redeem', 'Some surveys are long']
  },
  {
    title: 'Opinion Outpost',
    category: 'surveys',
    url: 'https://www.opinionoutpost.com',
    signupUrl: 'https://www.opinionoutpost.com/join',
    description: 'Survey panel by Dynata (formerly Survey Sampling International). Complete surveys to earn points redeemable for cash and gift cards.',
    payType: 'mixed',
    typicalPay: '$0.50-$5/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'US, UK, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Low $5 cashout threshold', 'Frequent survey invitations', 'Backed by major research company', 'Quarterly prize draws'],
    cons: ['Many disqualifications', 'Some surveys are very long', 'Limited to US and UK']
  },
  {
    title: 'YouGov',
    category: 'surveys',
    url: 'https://www.yougov.com',
    signupUrl: 'https://account.yougov.com/us-en/join',
    description: 'Global public opinion and data analytics company. Participate in political, social, and brand surveys. Data used by major news outlets.',
    payType: 'mixed',
    typicalPay: '$0.50-$2/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Reputable international brand', 'Interesting political/social topics', 'No disqualifications once started', 'Community polls'],
    cons: ['Slow earnings', 'High $15 minimum to cash out', 'Surveys can be short but low-paying']
  },
  {
    title: 'Harris Poll Online',
    category: 'surveys',
    url: 'https://www.harrispollonline.com',
    signupUrl: 'https://www.harrispollonline.com/join',
    description: 'Online survey arm of the famous Harris Poll. Participate in influential surveys on politics, public policy, and consumer trends.',
    payType: 'mixed',
    typicalPay: '$1-$3/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Prestigious research organization', 'Surveys influence public discourse', 'Multiple reward options'],
    cons: ['Fewer surveys than other panels', 'Slow point accumulation', 'High minimum for redemption']
  },
  {
    title: 'i-Say (Ipsos)',
    category: 'surveys',
    url: 'https://www.ipsosisay.com',
    signupUrl: 'https://www.ipsosisay.com/join',
    description: 'Survey panel by Ipsos, one of the world\'s largest market research companies. Earn points for sharing opinions on brands, products, and services.',
    payType: 'mixed',
    typicalPay: '$0.50-$3/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Global, 16+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Backed by Ipsos - major research firm', 'Loyalty program with bonuses', 'Poll predictions for extra points', 'Available globally'],
    cons: ['Frequent disqualifications', 'Low pay for short surveys', 'Can be slow to accumulate enough to redeem']
  },
  {
    title: 'Qmee',
    category: 'surveys',
    url: 'https://www.qmee.com',
    signupUrl: 'https://www.qmee.com/signup',
    description: 'Survey platform with no minimum cashout threshold. Earn for surveys, search results, and cashback shopping. Instant PayPal payments.',
    payType: 'cash',
    typicalPay: '$0.25-$5/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'US, UK, Canada, Australia, 16+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['No minimum cashout — withdraw any amount', 'Instant PayPal payments', 'Browser extension for bonus earnings', 'Cashback shopping'],
    cons: ['Low pay per survey', 'Many short screener surveys', 'Browser extension can be distracting']
  },
  {
    title: 'AttaPoll',
    category: 'surveys',
    url: 'https://attapoll.app',
    signupUrl: 'https://attapoll.app',
    description: 'Mobile survey app with short, well-paying surveys. Clean interface with estimated time and pay shown upfront. Low $3 minimum payout.',
    payType: 'cash',
    typicalPay: '$0.20-$3/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Low $3 minimum payout', 'Clean mobile app', 'Shows estimated pay upfront', 'Quick surveys under 5 minutes'],
    cons: ['Mobile only', 'Pay varies widely by country', 'Some surveys disqualify after starting']
  },
  {
    title: 'PrizeRebel',
    category: 'surveys',
    url: 'https://www.prizerebel.com',
    signupUrl: 'https://www.prizerebel.com/register',
    description: 'GPT (Get Paid To) site offering surveys, offers, and tasks. Level system that unlocks better rewards over time. $2 minimum cashout.',
    payType: 'mixed',
    typicalPay: '$0.50-$3/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Low $2 minimum payout', 'Level system with increasing perks', 'Multiple earning methods', 'Daily challenges'],
    cons: ['Some offers require purchases', 'Can be overwhelming for new users', 'Lower-paying than dedicated survey sites']
  },
  {
    title: 'PointClub',
    category: 'surveys',
    url: 'https://www.pointclub.com',
    signupUrl: 'https://www.pointclub.com/join',
    description: 'Survey panel that rewards bonus points for consistent participation. Community-driven platform with member rewards and referral bonuses.',
    payType: 'mixed',
    typicalPay: '$0.50-$3/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Bonus points for activity streaks', 'Referral program', '5000 point signup bonus', 'Gift cards and PayPal'],
    cons: ['US only', 'High minimum to redeem', 'Fewer surveys than major platforms']
  },
  {
    title: 'Surveytime',
    category: 'surveys',
    url: 'https://surveytime.io',
    signupUrl: 'https://surveytime.io',
    description: 'Instant-pay survey platform. Get $1 instantly via PayPal for every completed survey. No points, no minimums, just immediate cash.',
    payType: 'cash',
    typicalPay: '$1/survey',
    payRange: { min: 1, max: 1 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Instant $1 PayPal payment per survey', 'No points system', 'No minimum cashout', 'Available worldwide'],
    cons: ['Limited surveys available', 'Always $1 regardless of length', 'Disqualifications still possible']
  },
  {
    title: 'Crowdtap',
    category: 'surveys',
    url: 'https://www.crowdtap.com',
    signupUrl: 'https://www.crowdtap.com',
    description: 'Brand engagement platform offering quick surveys and product sampling. Answer short questions about brands for gift card rewards.',
    payType: 'gift-card',
    typicalPay: '$0.10-$1/task',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'remote', 'beginner-friendly'],
    pros: ['Very quick tasks (1-2 minutes)', 'Product sampling opportunities', 'Clean mobile app', 'No disqualifications'],
    cons: ['Gift cards only, no cash', 'Very low pay per task', 'US only']
  },
  {
    title: 'e-Rewards',
    category: 'surveys',
    url: 'https://www.e-rewards.com',
    signupUrl: 'https://www.e-rewards.com',
    description: 'Invite-only survey panel by Dynata. Offers opinion dollars redeemable for airline miles, hotel points, magazine subscriptions, and retail gift cards.',
    payType: 'mixed',
    typicalPay: '$2-$10/survey',
    payRange: { min: 2, max: 10 },
    format: 'remote',
    qualification: 'Invite-only, US',
    trustLevel: 'medium',
    badges: ['verified', 'remote', 'needs-qualification'],
    pros: ['Airline miles and hotel points as rewards', 'Higher pay than average', 'Major research company'],
    cons: ['Invite only', 'No direct cash option', 'Opinion dollars have limited redemption options']
  },
  {
    title: 'National Consumer Panel',
    category: 'surveys',
    url: 'https://www.nationalconsumerpanel.com',
    signupUrl: 'https://www.nationalconsumerpanel.com/join',
    description: 'Nielsen/IRI joint venture. Scan your groceries and purchases with their app to earn reward points. One of the most unique panel formats.',
    payType: 'mixed',
    typicalPay: 'Points for prizes',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'US, application-based',
    trustLevel: 'high',
    badges: ['verified', 'remote', 'needs-qualification'],
    pros: ['Earn by scanning everyday purchases', 'Sweepstakes entries', 'Gift cards and electronics as rewards', 'Backed by Nielsen and IRI'],
    cons: ['Must scan purchases consistently', 'Points accumulate slowly', 'Application-based acceptance']
  },
  {
    title: 'SurveyMonkey Rewards',
    category: 'surveys',
    url: 'https://www.surveymonkey.com/mp/earn-money/',
    signupUrl: 'https://www.surveymonkey.com/mp/earn-money/',
    description: 'Mobile app by SurveyMonkey that donates to charity or gives gift cards for completing surveys. Simple interface backed by a well-known brand.',
    payType: 'mixed',
    typicalPay: '$0.25-$1/survey (donated or gift card)',
    payRange: { min: 0, max: 2 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'remote', 'beginner-friendly'],
    pros: ['Charity donation option', 'Trusted SurveyMonkey brand', 'Simple clean interface', 'Quick surveys'],
    cons: ['Very low pay per survey', 'Gift cards only (or charity)', 'Limited availability']
  },
  {
    title: 'Google Opinion Rewards',
    category: 'surveys',
    url: 'https://surveys.google.com/google-opinion-rewards/',
    signupUrl: 'https://surveys.google.com/google-opinion-rewards/',
    description: 'Google\'s mobile survey app. Answer quick questions about places you visited and earn Google Play credits (Android) or PayPal cash (iOS).',
    payType: 'mixed',
    typicalPay: '$0.10-$1/survey',
    payRange: { min: 0, max: 1 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'remote', 'beginner-friendly'],
    pros: ['By Google — totally trustworthy', 'Very quick surveys (10-30 seconds)', 'Location-based surveys pop up automatically', 'PayPal on iOS'],
    cons: ['Very low pay', 'Google Play credits on Android only', 'Infrequent surveys for some users']
  },
  {
    title: 'Pureprofile',
    category: 'surveys',
    url: 'https://www.pureprofile.com',
    signupUrl: 'https://www.pureprofile.com/member/register',
    description: 'Australian-based global survey platform. Shows exact pay and time estimate before each survey. Earn cash for sharing opinions.',
    payType: 'cash',
    typicalPay: '$0.50-$3/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Australia, UK, US, NZ, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Shows pay upfront before starting', 'PayPal cashout', 'No points system — real dollars', 'Quick surveys'],
    cons: ['Limited to certain countries', 'Not many surveys in some regions', 'Occasional long screeners']
  },
  {
    title: 'Valued Opinions',
    category: 'surveys',
    url: 'https://www.valuedopinions.com',
    signupUrl: 'https://www.valuedopinions.com/signup',
    description: 'Survey panel by Dynata offering gift card rewards for sharing opinions about products, services, and advertisements.',
    payType: 'gift-card',
    typicalPay: '$1-$5/survey',
    payRange: { min: 1, max: 5 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'remote', 'beginner-friendly'],
    pros: ['Higher pay per survey than average', 'Many gift card options', 'Available in many countries', 'No disqualification after starting'],
    cons: ['Gift cards only — no cash', '$10-20 minimum to redeem', 'Fewer surveys than bigger platforms']
  },
  {
    title: 'Univox Community',
    category: 'surveys',
    url: 'https://www.univoxcommunity.com',
    signupUrl: 'https://www.univoxcommunity.com/signup',
    description: 'Global survey community with a milestone bonus system. Earn points for surveys and get bonuses for reaching activity milestones.',
    payType: 'mixed',
    typicalPay: '$0.50-$3/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Milestone bonuses for activity', 'Global availability', 'PayPal and gift card options', 'Community forums'],
    cons: ['Points conversion rate varies', 'Disqualifications common', 'Minimum $25 for PayPal']
  },
  {
    title: 'OneOpinion',
    category: 'surveys',
    url: 'https://www.oneopinion.com',
    signupUrl: 'https://www.oneopinion.com/join',
    description: 'Survey panel offering points for surveys and product testing. Redeem points for Visa virtual prepaid cards or Amazon gift cards.',
    payType: 'mixed',
    typicalPay: '$1-$5/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Visa virtual card option', 'Product testing opportunities', '25,000 points = $25', 'No spam emails'],
    cons: ['US only', 'Limited survey availability', 'Points take time to accumulate']
  },
  {
    title: 'Mindswarms',
    category: 'surveys',
    url: 'https://www.mindswarms.com',
    signupUrl: 'https://www.mindswarms.com/signup',
    description: 'Video survey platform paying $50 per study. Record short video responses to questions about your experiences with brands and products.',
    payType: 'cash',
    typicalPay: '$50/study',
    payRange: { min: 50, max: 50 },
    format: 'remote',
    qualification: 'Global, 18+, needs webcam',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['$50 per completed study', 'PayPal within 24 hours', 'Quick 10-minute video surveys', 'Interesting topics'],
    cons: ['Must record video responses', 'Limited study availability', 'Must pass screening', 'Webcam required']
  },
  {
    title: 'Forthright',
    category: 'surveys',
    url: 'https://www.beforthright.com',
    signupUrl: 'https://www.beforthright.com/signup',
    description: 'Transparent survey platform that shows pay upfront and respects your time. Compensates for disqualifications with sweepstakes entries.',
    payType: 'cash',
    typicalPay: '$1-$5/survey',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Transparent pay shown upfront', 'Compensates for disqualifications', 'Direct deposit available', 'Respects participant time'],
    cons: ['Newer platform', 'Limited survey volume', 'US only']
  },
  {
    title: 'Maru Voice Canada',
    category: 'surveys',
    url: 'https://www.maruvoice.ca',
    signupUrl: 'https://www.maruvoice.ca/signup',
    description: 'Canadian survey panel offering visa gift cards and Air Miles for participating in market research studies on Canadian brands and services.',
    payType: 'mixed',
    typicalPay: '$0.50-$3/survey (CAD)',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Canada, 16+',
    trustLevel: 'medium',
    badges: ['verified', 'remote'],
    pros: ['Air Miles option', 'Canadian-focused content', 'Regular survey invitations', 'Visa gift cards'],
    cons: ['Canada only', 'Slow point accumulation', 'Limited survey volume']
  },
  {
    title: 'Earnably',
    category: 'surveys',
    url: 'https://www.earnably.com',
    signupUrl: 'https://www.earnably.com/signup',
    description: 'GPT site with surveys, offer walls, and videos. Clean interface with Bitcoin, PayPal, and gift card cashout options.',
    payType: 'mixed',
    typicalPay: '$0.25-$3/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Global, 13+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Bitcoin cashout option', 'Low minimum thresholds', 'Clean modern interface', 'Promo codes for bonus earnings'],
    cons: ['Lower earnings than top platforms', 'Some offers are spammy', 'Smaller community']
  },
  {
    title: 'KashKick',
    category: 'surveys',
    url: 'https://www.kashkick.com',
    signupUrl: 'https://www.kashkick.com/signup',
    description: 'Cashback and survey platform offering paid surveys, game offers, and cashback deals. Pays via PayPal with a $10 minimum cashout. US only.',
    payType: 'cash',
    typicalPay: '$0.50-$5/survey',
    payRange: { min: 0, max: 25 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['PayPal cashout', 'Multiple earning methods beyond surveys', 'Cashback deals included', '$10 minimum is reasonable'],
    cons: ['US only', '$10 minimum cashout', 'Some offers require purchases', 'Newer platform']
  },
  {
    title: 'Freecash',
    category: 'surveys',
    url: 'https://freecash.com',
    signupUrl: 'https://freecash.com/signup',
    description: 'Global rewards platform combining surveys, offer walls, and games. Offers PayPal, crypto, and gift card payouts. Fast-growing community with leaderboard bonuses.',
    payType: 'mixed',
    typicalPay: '$0.50-$10/task',
    payRange: { min: 0, max: 50 },
    format: 'remote',
    qualification: 'Global, 16+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Crypto payout option', 'Global availability', 'Multiple earning methods', 'Leaderboard bonuses for top earners'],
    cons: ['Some offers are spammy', 'Earnings vary widely', 'Must be careful with offer walls', 'Newer platform']
  },
  {
    title: 'Clickworker',
    category: 'user-testing',
    url: 'https://www.clickworker.com',
    signupUrl: 'https://www.clickworker.com/clickworker/',
    description: 'Microtask and data-labeling platform offering data categorization, text creation, web research, and UHRS tasks from Microsoft. Low $5 minimum cashout via PayPal or SEPA.',
    payType: 'cash',
    typicalPay: '$5-$15/hr',
    payRange: { min: 3, max: 20 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['UHRS tasks available for higher pay', 'Low $5 minimum cashout', 'Variety of task types', 'Global availability'],
    cons: ['UHRS access not guaranteed', 'Pay varies widely by task', 'Some tasks are tedious', 'Assessments required for some tasks']
  },
  {
    title: 'Tellwut',
    category: 'surveys',
    url: 'https://www.tellwut.com',
    signupUrl: 'https://www.tellwut.com/signup',
    description: 'Opinion poll and survey platform for US and Canadian users. Create your own polls or participate in others. Earn rewards points redeemable for gift cards.',
    payType: 'mixed',
    typicalPay: '$0.05-$0.50/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'US, Canada, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'remote', 'beginner-friendly'],
    pros: ['Create your own polls', 'Simple interface', 'US and Canada', 'Community engagement features'],
    cons: ['Very low pay per survey', 'Gift cards only', 'Slow point accumulation', 'Limited survey selection']
  },
  {
    title: 'iResearch Panel',
    category: 'surveys',
    url: 'https://www.iresearchpanel.com',
    signupUrl: 'https://www.iresearchpanel.com/signup',
    description: 'Market research survey panel offering PayPal payments for completing surveys on consumer products and services. Averaging about $1 per survey.',
    payType: 'cash',
    typicalPay: '$0.50-$3/survey',
    payRange: { min: 0, max: 5 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['PayPal payments', 'Global availability', 'Straightforward surveys', 'No minimum for some rewards'],
    cons: ['Low pay per survey', 'Frequent disqualifications', 'Limited survey volume', 'Slow invitation rate']
  },
  {
    title: 'Premise',
    category: 'user-testing',
    url: 'https://www.premise.com',
    signupUrl: 'https://www.premise.com/contributors/',
    description: 'Location-based data collection platform with a gig-economy style. Complete field tasks, photo verification jobs, and location-based surveys. Available globally with PayPal payouts.',
    payType: 'cash',
    typicalPay: '$0.10-$5/task',
    payRange: { min: 0, max: 10 },
    format: 'remote',
    qualification: 'Global, 18+, smartphone required',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Global availability', 'Gig-style flexibility', 'Field tasks pay more', 'Mobile-first experience'],
    cons: ['Low pay for basic surveys', 'Must enable location services', 'Task availability varies by region', 'Photo tasks can be time-consuming']
  },
  {
    title: 'Measure Protocol',
    category: 'surveys',
    url: 'https://www.measureprotocol.com',
    signupUrl: 'https://www.measureprotocol.com/earn',
    description: 'Earn cryptocurrency for sharing anonymous behavioral data from your mobile device. Privacy-focused platform using blockchain technology for data ownership.',
    payType: 'mixed',
    typicalPay: '$1-$5/month',
    payRange: { min: 1, max: 10 },
    format: 'remote',
    qualification: 'Global, 18+, smartphone required',
    trustLevel: 'medium',
    badges: ['verified', 'remote', 'beginner-friendly'],
    pros: ['Passive earning potential', 'Privacy-focused with anonymous data', 'Crypto payments', 'Blockchain-backed data ownership'],
    cons: ['Low earnings', 'Crypto-only payouts', 'Must share device data', 'Newer platform with limited track record']
  },

  // ========================================================================
  // USER TESTING (22 platforms)
  // ========================================================================
  {
    title: 'UserTesting',
    category: 'user-testing',
    url: 'https://www.usertesting.com',
    signupUrl: 'https://www.usertesting.com/get-paid-to-test',
    description: 'The largest user testing platform. Test websites, apps, and prototypes by recording your screen and speaking your thoughts aloud. $4-$10 per test.',
    payType: 'cash',
    typicalPay: '$4-$10/test (20min), $30-$120/live interview',
    payRange: { min: 4, max: 120 },
    format: 'remote',
    qualification: 'Global, 18+, needs microphone',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay', 'beginner-friendly'],
    pros: ['Well-established platform', '$10 per 20-min test', 'Live interviews pay $30-120', 'PayPal within 7 days', 'Many tests available'],
    cons: ['Must pass sample test', 'Tests fill up fast', 'Rating system can be strict', 'Need quiet environment']
  },
  {
    title: 'User Interviews',
    category: 'user-testing',
    url: 'https://www.userinterviews.com',
    signupUrl: 'https://www.userinterviews.com/participant-sign-up',
    description: 'Research recruitment platform connecting participants with paid studies. Studies include interviews, surveys, diary studies, and usability tests. Often $50-$200 per session.',
    payType: 'mixed',
    typicalPay: '$50-$200/session',
    payRange: { min: 20, max: 200 },
    format: 'both',
    qualification: 'US primarily, 18+, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['High pay per study ($50-200)', 'Wide variety of study types', 'Professional researchers', 'Many studies available'],
    cons: ['Competitive — many applicants', 'Must match specific demographics', 'Scheduling can be tricky', 'Some studies US-only']
  },
  {
    title: 'Respondent',
    category: 'user-testing',
    url: 'https://www.respondent.io',
    signupUrl: 'https://app.respondent.io/signup',
    description: 'Premium research platform connecting professionals with high-paying studies. Focuses on B2B and professional audiences. Average pay $100-$250/hour.',
    payType: 'cash',
    typicalPay: '$100-$250/hr',
    payRange: { min: 50, max: 500 },
    format: 'both',
    qualification: 'Global, professionals, verified LinkedIn',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay', 'needs-qualification'],
    pros: ['Highest-paying platform for research', 'Average $100+/hr', 'Professional B2B studies', 'PayPal payments'],
    cons: ['Requires LinkedIn verification', 'Competitive screening', 'Professional/niche demographics needed', 'Studies can take weeks to schedule']
  },
  {
    title: 'Trymata (formerly TryMyUI)',
    category: 'user-testing',
    url: 'https://www.trymata.com',
    signupUrl: 'https://www.trymata.com/get-paid-to-test',
    description: 'Usability testing platform. Record your screen and voice while testing websites and apps. Pay starts at $10 per 15-20 minute test.',
    payType: 'cash',
    typicalPay: '$10/test (15-20 min)',
    payRange: { min: 10, max: 10 },
    format: 'remote',
    qualification: 'Global, 18+, needs mic',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['$10 per test', 'Quick 15-20 minute tests', 'PayPal payments', 'Simple think-aloud format'],
    cons: ['Must pass qualification test', 'Tests fill up quickly', 'Limited availability for some demographics']
  },
  {
    title: 'Userlytics',
    category: 'user-testing',
    url: 'https://www.userlytics.com',
    signupUrl: 'https://www.userlytics.com/tester-sign-up',
    description: 'Remote usability testing platform offering higher pay than competitors. Test websites, prototypes, and apps. Some tests include live interviews.',
    payType: 'cash',
    typicalPay: '$5-$90/test',
    payRange: { min: 5, max: 90 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['Pay up to $90 per test', 'Works on mobile and desktop', 'Live interview options', 'Global availability'],
    cons: ['Variable test availability', 'Some tests pay only $5', 'Must install recording software']
  },
  {
    title: 'TestingTime',
    category: 'user-testing',
    url: 'https://www.testingtime.com',
    signupUrl: 'https://www.testingtime.com/en/become-a-paid-testuser/',
    description: 'European-focused UX research platform. Participate in user tests, interviews, and focus groups. Pay ranges from CHF 30-100 per session.',
    payType: 'cash',
    typicalPay: '$30-$100/session',
    payRange: { min: 30, max: 100 },
    format: 'both',
    qualification: 'Europe, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['Good pay for European testers', 'Professional studies', 'Bank transfer payments', 'In-person and remote options'],
    cons: ['Europe-focused', 'Limited availability', 'Must match study criteria']
  },
  {
    title: 'Intellizoom',
    category: 'user-testing',
    url: 'https://www.intellizoom.com',
    signupUrl: 'https://www.intellizoom.com/panelist-sign-up',
    description: 'Platform by UserZoom for quick usability tests and surveys. Tests usually take 10-20 minutes and pay $2-$10 via PayPal.',
    payType: 'cash',
    typicalPay: '$2-$10/test',
    payRange: { min: 2, max: 10 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Part of UserZoom network', 'No recording software needed', 'Quick tests', 'PayPal payments'],
    cons: ['Lower pay than UserTesting', 'Tests fill up fast', 'Availability varies']
  },
  {
    title: 'dscout',
    category: 'user-testing',
    url: 'https://dscout.com',
    signupUrl: 'https://dscout.com/be-a-scout',
    description: 'Mobile research platform for in-context research. Complete "missions" by recording video diary entries about your daily experiences. Pay $10-$300+ per mission.',
    payType: 'cash',
    typicalPay: '$10-$300/mission',
    payRange: { min: 10, max: 300 },
    format: 'remote',
    qualification: 'US, 18+, smartphone required',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['High pay for missions ($10-300)', 'Interesting diary study format', 'Mobile-first experience', 'Top scouts earn consistently'],
    cons: ['Must complete all mission parts', 'Time commitment can be large', 'US-focused', 'Competitive screening']
  },
  {
    title: 'PlaytestCloud',
    category: 'user-testing',
    url: 'https://www.playtestcloud.com',
    signupUrl: 'https://www.playtestcloud.com/become-a-tester',
    description: 'Gaming-focused user testing platform. Play unreleased mobile games and provide feedback. Get paid via PayPal for each playtest session.',
    payType: 'cash',
    typicalPay: '$7-$15/test',
    payRange: { min: 7, max: 15 },
    format: 'remote',
    qualification: 'Global, gamers, smartphone/tablet',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Get paid to play games', 'Fun and engaging', 'Quick PayPal payments', 'No special equipment needed'],
    cons: ['Mobile games only', 'Limited test availability', 'Must match gamer profile']
  },
  {
    title: 'BetaTesting',
    category: 'user-testing',
    url: 'https://betatesting.com',
    signupUrl: 'https://betatesting.com/beta-testers',
    description: 'Beta testing platform for pre-release software, apps, and hardware. Test new products before launch and provide structured feedback.',
    payType: 'mixed',
    typicalPay: '$10-$50/project',
    payRange: { min: 10, max: 50 },
    format: 'remote',
    qualification: 'Global, varies by project',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Test cutting-edge products', 'Cash or gift card payment', 'Flexible schedule', 'Fun variety of products'],
    cons: ['Variable pay', 'Not all tests are paid', 'Must provide detailed feedback']
  },
  {
    title: 'Enroll',
    category: 'user-testing',
    url: 'https://www.enrollapp.com',
    signupUrl: 'https://www.enrollapp.com',
    description: 'Quick screener-based user research platform. Answer questions to qualify for paid studies that include interviews, surveys, and usability tests.',
    payType: 'cash',
    typicalPay: '$10-$100/study',
    payRange: { min: 10, max: 100 },
    format: 'remote',
    qualification: 'US primarily, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Quick screener process', 'Good pay for qualified studies', 'Variety of study types'],
    cons: ['Must pass screeners', 'Limited availability', 'US-focused']
  },
  {
    title: 'Loop11',
    category: 'user-testing',
    url: 'https://www.loop11.com',
    signupUrl: 'https://www.loop11.com',
    description: 'Usability testing tool that sometimes recruits testers through their panel. Test websites by completing specific tasks and answering questions.',
    payType: 'cash',
    typicalPay: '$5-$20/test',
    payRange: { min: 5, max: 20 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Browser-based — no downloads', 'Quick tests', 'International', 'Multiple payment options'],
    cons: ['Inconsistent test availability', 'Lower pay than competitors', 'Tests can be basic']
  },
  {
    title: 'Userbrain',
    category: 'user-testing',
    url: 'https://www.userbrain.com',
    signupUrl: 'https://tester.userbrain.com',
    description: 'Simple user testing platform based in Europe. Complete tests by following scenarios on websites and speaking your thoughts aloud.',
    payType: 'cash',
    typicalPay: '$5/test',
    payRange: { min: 5, max: 5 },
    format: 'remote',
    qualification: 'Global, 18+, needs mic',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Simple test format', 'PayPal payments', 'Available internationally', 'Quick 5-15 min tests'],
    cons: ['Only $5 per test', 'Limited test volume', 'Must speak English clearly']
  },
  {
    title: 'Testbirds',
    category: 'user-testing',
    url: 'https://www.testbirds.com',
    signupUrl: 'https://nest.testbirds.com/signup',
    description: 'European crowdtesting platform for software quality assurance and UX testing. Test apps and websites, report bugs, and earn per approved bug report.',
    payType: 'cash',
    typicalPay: '$5-$50/project',
    payRange: { min: 5, max: 50 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Bug bounty style earnings', 'Wide range of devices accepted', 'European market leader', 'Flexible schedule'],
    cons: ['Pay per bug found — not guaranteed', 'Technical skills helpful', 'Variable project availability']
  },
  {
    title: 'Ubertesters',
    category: 'user-testing',
    url: 'https://ubertesters.com',
    signupUrl: 'https://ubertesters.com/become-a-tester/',
    description: 'Mobile app testing platform where testers find bugs and provide feedback on pre-release applications. Earn per approved bug report.',
    payType: 'cash',
    typicalPay: '$5-$25/project',
    payRange: { min: 5, max: 25 },
    format: 'remote',
    qualification: 'Global, various devices',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Mobile testing focus', 'Multiple device types accepted', 'Flexible schedule', 'International'],
    cons: ['Pay depends on bugs found', 'Must be thorough and detail-oriented', 'Not all projects paid equally']
  },
  {
    title: 'Conversion Crimes',
    category: 'user-testing',
    url: 'https://conversioncrimes.com',
    signupUrl: 'https://conversioncrimes.com/become-a-tester/',
    description: 'Affordable usability testing platform for small businesses. Testers record their screens while completing tasks and earn per test.',
    payType: 'cash',
    typicalPay: '$5-$10/test',
    payRange: { min: 5, max: 10 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Beginner-friendly', 'Quick tests', 'PayPal payment', 'Flexible schedule'],
    cons: ['Lower pay', 'Limited test volume', 'Newer platform']
  },
  {
    title: 'Askable',
    category: 'user-testing',
    url: 'https://www.askable.com',
    signupUrl: 'https://www.askable.com/participants',
    description: 'UX research participant platform operating in Australia, US, and UK. Pays $50-200 per session for interviews, usability tests, and focus groups.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'both',
    qualification: 'AU, US, UK, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['Good pay rates', 'Available in multiple countries', 'Both remote and in-person', 'Fast payment processing'],
    cons: ['Limited to AU/US/UK', 'Must match demographics', 'Variable study availability', 'Screening required']
  },
  {
    title: 'Recruit by UserZoom',
    category: 'user-testing',
    url: 'https://www.usertesting.com/get-paid-to-test',
    signupUrl: 'https://www.usertesting.com/get-paid-to-test',
    description: 'Paid UX studies from UserZoom, a leading enterprise UX research platform. Complete remote usability tests, card sorts, and surveys for $10-100 per test.',
    payType: 'cash',
    typicalPay: '$10-$100/test',
    payRange: { min: 10, max: 100 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'beginner-friendly'],
    pros: ['Enterprise-backed platform', 'Variety of test types', 'Global availability', 'Clear task instructions'],
    cons: ['Pay varies widely by test', 'Some tests pay low', 'Must qualify for each study', 'Can be slow to get studies']
  },
  {
    title: 'Wynter',
    category: 'user-testing',
    url: 'https://wynter.com',
    signupUrl: 'https://wynter.com/panelists',
    description: 'B2B message testing platform where you review marketing copy and provide feedback. Quick 5-15 minute tests paying $5-60. Ideal for professionals in B2B industries.',
    payType: 'cash',
    typicalPay: '$5-$60/test',
    payRange: { min: 5, max: 60 },
    format: 'remote',
    qualification: 'B2B professionals, specific job titles',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'quick-tasks'],
    pros: ['Quick 5-15 minute tests', 'Good pay for time spent', 'No screen recording needed', 'Professional content review'],
    cons: ['Must be B2B professional', 'Specific job titles required', 'Limited test frequency', 'Niche audience only']
  },
  {
    title: 'UserCrowd',
    category: 'user-testing',
    url: 'https://www.usercrowd.com',
    signupUrl: 'https://www.usercrowd.com/signup',
    description: 'Quick design survey platform where you answer short questions about website designs and interfaces. Tasks pay $0.10-$0.50 each and take under a minute.',
    payType: 'cash',
    typicalPay: '$0.10-$0.50/task',
    payRange: { min: 0, max: 1 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'quick-tasks', 'beginner-friendly'],
    pros: ['Very quick tasks under 1 minute', 'No recording required', 'Beginner-friendly', 'Frequent task availability'],
    cons: ['Very low pay per task', 'Must do many for meaningful earnings', 'Repetitive', 'PayPal only']
  },

  // ========================================================================
  // FOCUS GROUPS (21 platforms)
  // ========================================================================
  {
    title: 'Fieldwork',
    category: 'focus-groups',
    url: 'https://www.fieldwork.com',
    signupUrl: 'https://www.fieldwork.com/participants/',
    description: 'One of the largest focus group facility networks in the US. Conducts in-person and online focus groups across 15+ locations. Pay typically $75-$250 per session.',
    payType: 'cash',
    typicalPay: '$75-$250/session',
    payRange: { min: 75, max: 250 },
    format: 'both',
    qualification: 'US, 18+, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['High pay per session', 'Major US market research firm', 'In-person and online options', 'Professional facilities'],
    cons: ['Must be near a facility', 'Competitive screening', 'Irregular scheduling', 'Limited to US cities']
  },
  {
    title: 'Sago (Schlesinger Group)',
    category: 'focus-groups',
    url: 'https://www.sago.com',
    signupUrl: 'https://www.sago.com/en/participate-in-research/',
    description: 'Global research recruitment company (formerly Schlesinger Group). Recruits for focus groups, interviews, online studies, and mock juries. $50-$400 per session.',
    payType: 'cash',
    typicalPay: '$50-$400/session',
    payRange: { min: 50, max: 400 },
    format: 'both',
    qualification: 'US, UK, Europe, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Very high pay potential ($400+)', 'Global presence', 'Wide variety of study types', 'Professional organization'],
    cons: ['Competitive screening', 'Must match specific demographics', 'Irregular opportunities']
  },
  {
    title: 'FocusGroup.com',
    category: 'focus-groups',
    url: 'https://www.focusgroup.com',
    signupUrl: 'https://www.focusgroup.com/join',
    description: 'Online platform connecting participants with paid focus groups and research studies across the US. Lists studies from multiple facilities.',
    payType: 'cash',
    typicalPay: '$50-$300/session',
    payRange: { min: 50, max: 300 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Aggregates studies from many facilities', 'Good variety of topics', 'Both online and in-person', 'Decent pay'],
    cons: ['US only', 'Many studies have narrow demographics', 'Email notifications can be delayed']
  },
  {
    title: 'FindFocusGroups.com',
    category: 'focus-groups',
    url: 'https://www.findfocusgroups.com',
    signupUrl: 'https://www.findfocusgroups.com/participants/',
    description: 'Directory of focus group opportunities across the US. Helps participants find studies in their area or online.',
    payType: 'cash',
    typicalPay: '$50-$250/session',
    payRange: { min: 50, max: 250 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Directory format — see many options', 'Filter by location', 'Both online and in-person', 'Free to join'],
    cons: ['Listing quality varies', 'Not all listings current', 'US only']
  },
  {
    title: 'L&E Research',
    category: 'focus-groups',
    url: 'https://www.leresearch.com',
    signupUrl: 'https://www.leresearch.com/join-our-panel',
    description: 'Full-service market research company with focus group facilities across the US. Conducts qualitative and quantitative research studies.',
    payType: 'cash',
    typicalPay: '$75-$300/session',
    payRange: { min: 75, max: 300 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Professional facilities', 'High pay', 'Multiple US locations', 'Online options available'],
    cons: ['Must be near facilities', 'Competitive screening', 'Irregular scheduling']
  },
  {
    title: '20|20 Research',
    category: 'focus-groups',
    url: 'https://www.2020research.com',
    signupUrl: 'https://www.2020research.com/participants',
    description: 'Research technology and services company offering online qualitative research including webcam focus groups, bulletin boards, and mobile diaries.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['Online-first approach', 'Innovative research methods', 'Good pay', 'Flexible participation'],
    cons: ['Requires webcam', 'Must meet study criteria', 'Variable availability']
  },
  {
    title: 'Recruit & Field',
    category: 'focus-groups',
    url: 'https://www.recruitandfield.com',
    signupUrl: 'https://www.recruitandfield.com/sign-up/',
    description: 'Research recruitment agency specializing in finding participants for focus groups, in-depth interviews, and online communities.',
    payType: 'cash',
    typicalPay: '$75-$300/session',
    payRange: { min: 75, max: 300 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Professional recruitment', 'High-quality studies', 'Good pay rates', 'Variety of formats'],
    cons: ['Must match demographics', 'Irregular opportunities', 'Screening process']
  },
  {
    title: 'Plaza Research',
    category: 'focus-groups',
    url: 'https://www.plazaresearch.com',
    signupUrl: 'https://www.plazaresearch.com/participants',
    description: 'Focus group facility based in South Florida with a large participant database. Conducts consumer research studies with competitive compensation.',
    payType: 'cash',
    typicalPay: '$75-$200/session',
    payRange: { min: 75, max: 200 },
    format: 'both',
    qualification: 'US (FL), 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Established facility', 'Good pay', 'Regular studies', 'Professional environment'],
    cons: ['Florida-focused', 'Must be local for in-person', 'Limited online options']
  },
  {
    title: 'Probe Market Research',
    category: 'focus-groups',
    url: 'https://www.probemarket.com',
    signupUrl: 'https://www.probemarket.com/join',
    description: 'Market research firm recruiting for focus groups, taste tests, product evaluations, and mock jury panels across the US.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Variety of study types', 'Mock jury opportunities', 'Decent pay', 'Regular opportunities'],
    cons: ['Regional availability', 'Must pass screeners', 'Variable scheduling']
  },
  {
    title: 'Murray Hill National',
    category: 'focus-groups',
    url: 'https://www.murrayhillnational.com',
    signupUrl: 'https://www.murrayhillnational.com/participants/',
    description: 'Full-service focus group facility in Dallas, TX. Recruits for qualitative research studies including focus groups, taste tests, and product evaluations.',
    payType: 'cash',
    typicalPay: '$75-$250/session',
    payRange: { min: 75, max: 250 },
    format: 'both',
    qualification: 'US (TX area), 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Established facility', 'High pay', 'Regular studies in TX area', 'Professional environment'],
    cons: ['Dallas/TX focused', 'In-person mostly', 'Must match demographics']
  },
  {
    title: 'Nichols Research',
    category: 'focus-groups',
    url: 'https://www.nicholsresearch.com',
    signupUrl: 'https://www.nicholsresearch.com/participants/',
    description: 'Texas-based market research facility conducting focus groups, taste tests, mock trials, and other qualitative research studies.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'both',
    qualification: 'US (TX), 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Good Texas presence', 'Variety of study types', 'Fair pay', 'Mock trial opportunities'],
    cons: ['Texas/regional only', 'Must pass screeners', 'Irregular scheduling']
  },
  {
    title: 'Adler Weiner Research',
    category: 'focus-groups',
    url: 'https://www.adlerweiner.com',
    signupUrl: 'https://www.adlerweiner.com/participate',
    description: 'Chicago and Los Angeles based focus group facility. One of the oldest in the industry, conducting qualitative research since 1967.',
    payType: 'cash',
    typicalPay: '$75-$250/session',
    payRange: { min: 75, max: 250 },
    format: 'both',
    qualification: 'US (Chicago/LA), 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Established since 1967', 'Chicago and LA locations', 'High-quality studies', 'Professional facilities'],
    cons: ['Chicago/LA only', 'Must be local', 'Competitive screening']
  },
  {
    title: 'Opinions Ltd',
    category: 'focus-groups',
    url: 'https://www.opinionsltd.com',
    signupUrl: 'https://www.opinionsltd.com/join/',
    description: 'Market research company in the Queens, NY area. Recruits for focus groups, taste tests, and product evaluations with competitive pay.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'in-person',
    qualification: 'US (NYC area), 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['NYC area studies', 'Taste test opportunities', 'Cash payments', 'Regular studies'],
    cons: ['NYC only', 'Must travel to facility', 'Limited to local participants']
  },
  {
    title: 'QualRec',
    category: 'focus-groups',
    url: 'https://www.qualrec.com',
    signupUrl: 'https://www.qualrec.com/participants',
    description: 'Qualitative research recruitment firm finding participants for focus groups, in-depth interviews, and ethnographic studies nationwide.',
    payType: 'cash',
    typicalPay: '$75-$300/session',
    payRange: { min: 75, max: 300 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Nationwide recruitment', 'High pay potential', 'Various study types', 'Professional'],
    cons: ['Must meet specific criteria', 'Irregular opportunities', 'Screening required']
  },
  {
    title: 'Inspired Opinions',
    category: 'focus-groups',
    url: 'https://www.inspiredopinions.com',
    signupUrl: 'https://www.inspiredopinions.com/join-our-panel',
    description: 'Charlotte, NC based market research facility. Conducts focus groups, product tests, taste tests, and online research studies.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'both',
    qualification: 'US (Charlotte NC area), 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Charlotte NC local studies', 'Variety of study types', 'Fair pay', 'Online options available'],
    cons: ['Regional focus', 'Must pass screeners', 'Variable availability']
  },
  {
    title: 'Herron Associates',
    category: 'focus-groups',
    url: 'https://www.herron-research.com',
    signupUrl: 'https://www.herron-research.com/join',
    description: 'Indianapolis-based market research facility conducting focus groups, interviews, and various qualitative research studies.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'both',
    qualification: 'US (Indianapolis area), 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Indianapolis local studies', 'Professional facility', 'Fair pay', 'Regular studies'],
    cons: ['Regional only', 'In-person focus', 'Must be local']
  },
  {
    title: 'Delve',
    category: 'focus-groups',
    url: 'https://www.delve.com',
    signupUrl: 'https://www.delve.com/participate',
    description: 'Research consultancy that recruits for focus groups, online communities, in-depth interviews, and shop-along studies.',
    payType: 'cash',
    typicalPay: '$75-$250/session',
    payRange: { min: 75, max: 250 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Unique study formats', 'Good pay', 'National recruitment', 'Professional researchers'],
    cons: ['Competitive screening', 'Must match demographics', 'Irregular scheduling']
  },
  {
    title: 'Focus Pointe Global',
    category: 'focus-groups',
    url: 'https://www.focuspointeglobal.com',
    signupUrl: 'https://www.focuspointeglobal.com/participants',
    description: 'National network of focus group facilities. Operates in multiple US cities and conducts a wide range of qualitative research studies.',
    payType: 'cash',
    typicalPay: '$75-$250/session',
    payRange: { min: 75, max: 250 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['National facility network', 'Many US city locations', 'High-quality studies', 'Good pay'],
    cons: ['Must be near a location', 'Competitive screening', 'Irregular scheduling']
  },
  {
    title: 'Discuss.io',
    category: 'focus-groups',
    url: 'https://www.discuss.io',
    signupUrl: 'https://www.discuss.io/participants',
    description: 'Video-based qualitative research platform hosting live focus groups, IDIs, and video surveys. Participants join from home via webcam for paid research sessions.',
    payType: 'cash',
    typicalPay: '$50-$200/session',
    payRange: { min: 50, max: 200 },
    format: 'remote',
    qualification: 'US, 18+, webcam required',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['Remote video sessions from home', 'Good pay per session', 'Professional research platform', 'Wide range of topics'],
    cons: ['Webcam required', 'Must be articulate on camera', 'Limited session availability', 'Screening required']
  },
  {
    title: 'Remesh',
    category: 'focus-groups',
    url: 'https://www.remesh.ai',
    signupUrl: 'https://www.remesh.ai/participants',
    description: 'AI-moderated focus group platform where you participate in live group discussions analyzed by AI. Sessions are text-based and pay $50-150 for 30-60 minutes.',
    payType: 'cash',
    typicalPay: '$50-$150/session',
    payRange: { min: 50, max: 150 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['Text-based — no webcam needed', 'AI-moderated for efficiency', 'Good pay for time', 'Innovative format'],
    cons: ['Must type quickly', 'Limited session availability', 'US-focused', 'Screening required']
  },
  {
    title: 'FocusLynx',
    category: 'focus-groups',
    url: 'https://www.focuslynx.com',
    signupUrl: 'https://www.focuslynx.com/join',
    description: 'Focus group recruiting firm offering both in-person and online research sessions. Pays $75-300 per session for consumer opinions on products and services.',
    payType: 'cash',
    typicalPay: '$75-$300/session',
    payRange: { min: 75, max: 300 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['High pay per session', 'Both online and in-person options', 'Nationwide recruitment', 'Variety of study topics'],
    cons: ['Competitive screening process', 'Must match demographics', 'Irregular scheduling', 'In-person may require travel']
  },

  // ========================================================================
  // PRODUCT TESTING (22 platforms)
  // ========================================================================
  {
    title: 'Home Tester Club',
    category: 'product-testing',
    url: 'https://www.hometesterclub.com',
    signupUrl: 'https://www.hometesterclub.com/signup',
    description: 'Free product testing community. Apply for product testing campaigns, receive free products at home, and share your honest reviews.',
    payType: 'product',
    typicalPay: 'Free products (keep them)',
    payRange: { min: 5, max: 100 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Keep all products for free', 'Wide variety of products', 'Global availability', 'Active community'],
    cons: ['No cash payment', 'Must leave reviews', 'Competitive applications', 'Not all applications accepted']
  },
  {
    title: 'Influenster',
    category: 'product-testing',
    url: 'https://www.influenster.com',
    signupUrl: 'https://www.influenster.com/signup',
    description: 'Product discovery and review platform. Receive free VoxBoxes with full-size products to test. Write reviews and share on social media.',
    payType: 'product',
    typicalPay: 'Free product boxes ($20-$100 value)',
    payRange: { min: 20, max: 100 },
    format: 'remote',
    qualification: 'US, 18+, social media accounts',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Full-size products', 'Major brand partnerships', 'Fun unboxing experience', 'Build your reviewer profile'],
    cons: ['Must be active on social media', 'Long waits between boxes', 'Can\'t choose products', 'No cash payment']
  },
  {
    title: 'BzzAgent',
    category: 'product-testing',
    url: 'https://www.bzzagent.com',
    signupUrl: 'https://www.bzzagent.com/join',
    description: 'Word-of-mouth marketing platform. Receive free products to try and share your opinions with friends and online. Part of the Swaarm network.',
    payType: 'product',
    typicalPay: 'Free products',
    payRange: { min: 5, max: 50 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Free products to try', 'Simple review process', 'Share with friends', 'Variety of product categories'],
    cons: ['Must promote products socially', 'No cash payment', 'Long waits between campaigns', 'US only']
  },
  {
    title: 'Smiley360',
    category: 'product-testing',
    url: 'https://www.smiley360.com',
    signupUrl: 'https://www.smiley360.com/join',
    description: 'Product testing and word-of-mouth community. Receive free products, share experiences with friends, and provide feedback to brands.',
    payType: 'product',
    typicalPay: 'Free products + coupons',
    payRange: { min: 5, max: 30 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Free products', 'Community-driven', 'Coupons for additional products', 'Fun campaigns'],
    cons: ['No cash payment', 'Must share socially', 'Small product sizes sometimes', 'US only']
  },
  {
    title: 'PINCHme',
    category: 'product-testing',
    url: 'https://www.pinchme.com',
    signupUrl: 'https://www.pinchme.com/signup',
    description: 'Free sample box service. Every few weeks, claim free samples of new products from major brands. Provide feedback in exchange.',
    payType: 'product',
    typicalPay: 'Free sample boxes',
    payRange: { min: 5, max: 30 },
    format: 'remote',
    qualification: 'US, Australia, 18+',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Completely free samples', 'Major brand products', 'Regular sample days', 'No purchase required'],
    cons: ['Samples go fast', 'Mostly sample-size products', 'Must provide reviews', 'Limited availability']
  },
  {
    title: 'Toluna Product Testing',
    category: 'product-testing',
    url: 'https://www.toluna.com',
    signupUrl: 'https://www.toluna.com/registration',
    description: 'Toluna\'s product testing arm offers free products to test at home. Combined with their survey platform for extra earning potential.',
    payType: 'product',
    typicalPay: 'Free products to test',
    payRange: { min: 10, max: 100 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote'],
    pros: ['Product testing + surveys', 'Global availability', 'Major brand products', 'Keep tested items'],
    cons: ['Must complete reviews', 'Limited product testing slots', 'More surveys than product tests']
  },
  {
    title: 'McCormick Consumer Testing',
    category: 'product-testing',
    url: 'https://www.mccormick.com',
    signupUrl: 'https://www.mccormick.com/consumer-testing',
    description: 'McCormick & Company\'s consumer testing panel. Taste test new spices, seasonings, and food products before they hit shelves.',
    payType: 'mixed',
    typicalPay: '$20-$50/session + free products',
    payRange: { min: 20, max: 50 },
    format: 'in-person',
    qualification: 'US (MD area), 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'product-only'],
    pros: ['Cash payment + free products', 'Taste test food', 'Major brand', 'Fun experience'],
    cons: ['Maryland area only', 'In-person required', 'Limited sessions', 'Must be near headquarters']
  },
  {
    title: 'Johnson & Johnson Panel',
    category: 'product-testing',
    url: 'https://www.jnj.com',
    signupUrl: 'https://www.jnj.com/consumer-product-testing',
    description: 'J&J recruits consumers to test healthcare, beauty, and baby products. Participants receive compensation and free products.',
    payType: 'mixed',
    typicalPay: '$25-$100/study + free products',
    payRange: { min: 25, max: 100 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'product-only'],
    pros: ['Major brand', 'Cash + free products', 'Quality health/beauty products', 'Professional studies'],
    cons: ['Limited availability', 'Must match product demographics', 'Can involve skin patch tests']
  },
  {
    title: 'P&G Everyday',
    category: 'product-testing',
    url: 'https://www.pgeveryday.com',
    signupUrl: 'https://www.pgeveryday.com/signup',
    description: 'Procter & Gamble\'s consumer community. Access coupons, samples, and product testing opportunities for P&G brands like Tide, Pampers, Gillette.',
    payType: 'product',
    typicalPay: 'Free products + coupons',
    payRange: { min: 5, max: 50 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Major P&G brands', 'Free products and coupons', 'Trusted company', 'Regular opportunities'],
    cons: ['Mostly coupons, less full products', 'Must be P&G product user', 'Limited testing spots']
  },
  {
    title: 'Samsung Members',
    category: 'product-testing',
    url: 'https://www.samsung.com/us/samsung-members/',
    signupUrl: 'https://www.samsung.com/us/samsung-members/',
    description: 'Samsung\'s community app for Galaxy device owners. Beta test new software, provide feedback, and occasionally test unreleased hardware.',
    payType: 'product',
    typicalPay: 'Early access + beta features',
    payRange: { min: 0, max: 0 },
    format: 'remote',
    qualification: 'Samsung device owners',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote'],
    pros: ['Early access to features', 'Direct Samsung community', 'Beta testing new software', 'Samsung rewards points'],
    cons: ['Samsung devices only', 'No cash payment', 'Beta software can have bugs', 'Limited hardware testing']
  },
  {
    title: 'Xbox Insiders',
    category: 'product-testing',
    url: 'https://www.xbox.com/en-US/insiders',
    signupUrl: 'https://www.xbox.com/en-US/insiders',
    description: 'Microsoft\'s Xbox insider program. Beta test console updates, new features, and games before public release. Earn XP and badges.',
    payType: 'product',
    typicalPay: 'Early access + exclusive content',
    payRange: { min: 0, max: 0 },
    format: 'remote',
    qualification: 'Xbox owners',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Early access to Xbox features', 'Beta test games', 'Community badges', 'Help shape Xbox products'],
    cons: ['Xbox required', 'No monetary compensation', 'Beta software issues', 'XP system has limited value']
  },
  {
    title: 'Apple Beta Software Program',
    category: 'product-testing',
    url: 'https://beta.apple.com',
    signupUrl: 'https://beta.apple.com',
    description: 'Apple\'s public beta program. Test pre-release versions of iOS, macOS, iPadOS, watchOS, and tvOS before public launch.',
    payType: 'product',
    typicalPay: 'Early access to Apple software',
    payRange: { min: 0, max: 0 },
    format: 'remote',
    qualification: 'Apple device owners, Apple ID',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Early access to Apple OS updates', 'Free to join', 'Easy enrollment', 'Help improve Apple products'],
    cons: ['No payment', 'Beta software may have bugs', 'Can affect device stability', 'Apple devices required']
  },
  {
    title: 'Google User Research',
    category: 'product-testing',
    url: 'https://userresearch.google.com',
    signupUrl: 'https://userresearch.google.com',
    description: 'Google\'s UX research program. Participate in studies about Google products for cash compensation. Remote and in-person at Google offices.',
    payType: 'cash',
    typicalPay: '$50-$200/study',
    payRange: { min: 50, max: 200 },
    format: 'both',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'high-pay'],
    pros: ['Direct from Google', 'Good pay ($50-200)', 'Test Google products', 'Remote and in-person options'],
    cons: ['Competitive screening', 'Must match study criteria', 'Not many studies per person']
  },
  {
    title: 'Amazon Vine',
    category: 'product-testing',
    url: 'https://www.amazon.com/vine/about',
    signupUrl: 'https://www.amazon.com/vine/about',
    description: 'Amazon\'s invite-only product review program. Vine Voices receive free products in exchange for honest reviews on Amazon.',
    payType: 'product',
    typicalPay: 'Free products ($0-$1000+ value)',
    payRange: { min: 0, max: 1000 },
    format: 'remote',
    qualification: 'Invite-only, established Amazon reviewers',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'needs-qualification', 'high-pay'],
    pros: ['Free products of high value', 'Wide selection of items', 'Keep everything you review', 'Amazon-backed program'],
    cons: ['Invite only', 'Must write detailed reviews', 'Tax implications on product value', 'Items may be low quality']
  },
  {
    title: 'UserTesting Product Board',
    category: 'product-testing',
    url: 'https://www.usertesting.com',
    signupUrl: 'https://www.usertesting.com/get-paid-to-test',
    description: 'UserTesting also offers product-specific testing campaigns. Test physical and digital products, provide video feedback.',
    payType: 'cash',
    typicalPay: '$10-$60/test',
    payRange: { min: 10, max: 60 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Cash payment', 'Major platform', 'Remote testing', 'Regular opportunities'],
    cons: ['Must pass qualification', 'Tests fill up fast', 'Specific product criteria']
  },
  {
    title: 'Burt\'s Bees Hive',
    category: 'product-testing',
    url: 'https://www.burtsbees.com',
    signupUrl: 'https://www.burtsbees.com/natural-hive',
    description: 'Burt\'s Bees product testing community. Test new natural beauty and personal care products before they launch.',
    payType: 'product',
    typicalPay: 'Free Burt\'s Bees products',
    payRange: { min: 5, max: 30 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Free natural products', 'Trusted brand', 'Regular campaigns', 'Keep all products'],
    cons: ['Limited to Burt\'s Bees products', 'No cash', 'Must review products', 'US only']
  },
  {
    title: 'Verizon Device Testing',
    category: 'product-testing',
    url: 'https://devicetrial.com',
    signupUrl: 'https://devicetrial.com',
    description: 'Verizon\'s device trial program. Test unreleased phones, tablets, and connected devices for Verizon\'s network.',
    payType: 'mixed',
    typicalPay: '$50-$200 + device time',
    payRange: { min: 50, max: 200 },
    format: 'remote',
    qualification: 'US, Verizon customers preferred',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Test new devices', 'Cash compensation', 'Major carrier', 'Interesting products'],
    cons: ['Limited availability', 'Must return devices', 'Verizon-focused', 'Geographic restrictions']
  },
  {
    title: 'SheSpeaks',
    category: 'product-testing',
    url: 'https://www.shespeaks.com',
    signupUrl: 'https://www.shespeaks.com/join',
    description: 'Women-focused product testing and review community. Receive free products from major brands and share reviews with the community.',
    payType: 'product',
    typicalPay: 'Free products',
    payRange: { min: 5, max: 50 },
    format: 'remote',
    qualification: 'US, women 18+',
    trustLevel: 'medium',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Women-focused community', 'Major brand products', 'Regular campaigns', 'Free products'],
    cons: ['Women-targeted only', 'No cash payment', 'Must share on social media', 'US only']
  },
  {
    title: 'Ripple Street',
    category: 'product-testing',
    url: 'https://www.ripplestreet.com',
    signupUrl: 'https://www.ripplestreet.com/signup',
    description: 'Host product parties and experiences with friends. Receive free products from major brands to try and share with your social circle. Formerly House Party.',
    payType: 'product',
    typicalPay: 'Free products + party kits',
    payRange: { min: 10, max: 100 },
    format: 'in-person',
    qualification: 'US, 18+, social media presence helpful',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'beginner-friendly'],
    pros: ['Free product party kits', 'Fun social experience', 'Major brand products', 'No purchase required'],
    cons: ['No cash payment', 'Must host a party or gathering', 'Competitive selection', 'US only']
  },
  {
    title: 'Viewpoints',
    category: 'product-testing',
    url: 'https://www.viewpoints.com',
    signupUrl: 'https://www.viewpoints.com/signup',
    description: 'Product review platform where you write detailed reviews of products you own or receive. Earn rewards and occasionally receive free products to test and review.',
    payType: 'mixed',
    typicalPay: 'Free products + reward points',
    payRange: { min: 0, max: 25 },
    format: 'remote',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Write reviews for products you already own', 'Occasional free products', 'Build reviewer reputation', 'Simple to get started'],
    cons: ['Low monetary rewards', 'Must write detailed reviews', 'Free product offers are competitive', 'Slow reward accumulation']
  },
  {
    title: 'Chatterbox by House Party',
    category: 'product-testing',
    url: 'https://www.ripplestreet.com/chatterbox',
    signupUrl: 'https://www.ripplestreet.com/signup',
    description: 'Host branded product sampling events and share products with friends. Receive free product kits and party supplies from major consumer brands.',
    payType: 'product',
    typicalPay: 'Free products + party supplies',
    payRange: { min: 10, max: 75 },
    format: 'in-person',
    qualification: 'US, 18+, active social media',
    trustLevel: 'medium',
    badges: ['verified', 'product-only', 'beginner-friendly'],
    pros: ['Free product party kits', 'Social and fun experience', 'Major brand products', 'Share with friends'],
    cons: ['No cash compensation', 'Must host events', 'Social media sharing expected', 'Competitive selection process']
  },
  {
    title: 'Social Nature',
    category: 'product-testing',
    url: 'https://www.socialnature.com',
    signupUrl: 'https://www.socialnature.com/signup',
    description: 'Try natural and organic products for free in exchange for honest reviews. Focus on health-conscious, eco-friendly, and organic brands.',
    payType: 'product',
    typicalPay: 'Free natural/organic products',
    payRange: { min: 5, max: 30 },
    format: 'remote',
    qualification: 'US, Canada, 18+',
    trustLevel: 'high',
    badges: ['verified', 'product-only', 'remote', 'beginner-friendly'],
    pros: ['Free natural/organic products', 'Health-conscious brands', 'Simple review process', 'US and Canada'],
    cons: ['No cash payment', 'Must write reviews', 'Products are smaller samples', 'Limited to natural brands']
  },

  // ========================================================================
  // MYSTERY SHOPPING (14 platforms)
  // ========================================================================
  {
    title: 'BestMark',
    category: 'mystery-shopping',
    url: 'https://www.bestmark.com',
    signupUrl: 'https://www.bestmark.com/apply',
    description: 'One of the largest mystery shopping companies in North America. Evaluate restaurants, hotels, retail stores, banks, and more.',
    payType: 'mixed',
    typicalPay: '$10-$50/shop + reimbursements',
    payRange: { min: 10, max: 50 },
    format: 'in-person',
    qualification: 'US, Canada, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'beginner-friendly'],
    pros: ['Major mystery shopping company', 'Wide variety of assignments', 'Restaurant reimbursements', 'Regular opportunities'],
    cons: ['Must visit locations in person', 'Detailed reports required', 'Pay varies widely', 'Travel expenses on you']
  },
  {
    title: 'Market Force',
    category: 'mystery-shopping',
    url: 'https://www.marketforce.com',
    signupUrl: 'https://www.marketforce.com/mystery-shopper-application',
    description: 'Global customer experience management company. Mystery shop major brands including restaurants, retail, grocery, and financial services.',
    payType: 'mixed',
    typicalPay: '$5-$30/shop + reimbursements',
    payRange: { min: 5, max: 30 },
    format: 'in-person',
    qualification: 'US, Canada, UK, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'beginner-friendly'],
    pros: ['Major brands', 'Free meals at restaurants', 'Global presence', 'Regular assignments'],
    cons: ['Lower base pay', 'Detailed reporting', 'Must follow strict guidelines', 'Reimbursements are the main perk']
  },
  {
    title: 'IntelliShop',
    category: 'mystery-shopping',
    url: 'https://www.intelli-shop.com',
    signupUrl: 'https://www.intelli-shop.com/shoppers/',
    description: 'Mystery shopping and compliance auditing company. Evaluate customer service at retail stores, restaurants, and service businesses.',
    payType: 'mixed',
    typicalPay: '$10-$40/shop + reimbursements',
    payRange: { min: 10, max: 40 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash'],
    pros: ['Good variety of shops', 'Fair pay', 'Compliance-focused (easy to follow)', 'Regular opportunities'],
    cons: ['In-person required', 'Detailed reports', 'Some low-pay shops', 'Must be thorough']
  },
  {
    title: 'Sinclair Customer Metrics',
    category: 'mystery-shopping',
    url: 'https://www.sinclaircustomermetrics.com',
    signupUrl: 'https://www.sinclaircustomermetrics.com/shoppers/',
    description: 'Customer experience measurement company specializing in hospitality, auto, and financial services mystery shopping.',
    payType: 'mixed',
    typicalPay: '$15-$50/shop + reimbursements',
    payRange: { min: 15, max: 50 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash'],
    pros: ['Hospitality and auto focus', 'Good pay for specialized shops', 'Professional company', 'Hotel and restaurant shops'],
    cons: ['Specialized industries', 'Must be detail-oriented', 'In-person only', 'Report deadlines']
  },
  {
    title: 'A Closer Look',
    category: 'mystery-shopping',
    url: 'https://www.acloserlook.com',
    signupUrl: 'https://www.acloserlook.com/mystery-shoppers/',
    description: 'Mystery shopping company focusing on retail, restaurants, entertainment, and apartments. Known for good communication with shoppers.',
    payType: 'mixed',
    typicalPay: '$10-$35/shop + reimbursements',
    payRange: { min: 10, max: 35 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'beginner-friendly'],
    pros: ['Good shopper communication', 'Entertainment venue shops', 'Apartment shopping opportunities', 'Beginner-friendly'],
    cons: ['Lower base pay', 'In-person required', 'Report writing', 'Some shops have tight deadlines']
  },
  {
    title: 'Secret Shopper',
    category: 'mystery-shopping',
    url: 'https://www.secretshopper.com',
    signupUrl: 'https://www.secretshopper.com/shoppers/register.asp',
    description: 'One of the original mystery shopping companies. Evaluate retail stores, restaurants, banks, and car dealerships across the US.',
    payType: 'mixed',
    typicalPay: '$10-$30/shop + reimbursements',
    payRange: { min: 10, max: 30 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'beginner-friendly'],
    pros: ['Well-established company', 'Many shop types', 'National coverage', 'Decent training resources'],
    cons: ['Lower pay than some competitors', 'Strict reporting requirements', 'In-person only', 'Some shops barely cover expenses']
  },
  {
    title: 'MSPA Americas',
    category: 'mystery-shopping',
    url: 'https://www.mspa-americas.org',
    signupUrl: 'https://www.mspa-americas.org/find-a-mystery-shopping-company',
    description: 'Mystery Shopping Professionals Association directory. Not a shopping company itself but connects you to all legitimate mystery shopping companies.',
    payType: 'mixed',
    typicalPay: 'Varies by company',
    payRange: { min: 5, max: 100 },
    format: 'in-person',
    qualification: 'US, Canada, 18+',
    trustLevel: 'high',
    badges: ['verified'],
    pros: ['Official industry association', 'Verified legitimate companies', 'Find local opportunities', 'Anti-scam resource'],
    cons: ['Directory only — not a direct employer', 'Must apply to each company', 'Not all companies listed are great']
  },
  {
    title: 'Confero',
    category: 'mystery-shopping',
    url: 'https://www.conferoinc.com',
    signupUrl: 'https://www.conferoinc.com/mystery-shoppers/',
    description: 'Mystery shopping and customer experience company. Specializes in automotive, retail, healthcare, and financial services evaluations.',
    payType: 'mixed',
    typicalPay: '$10-$40/shop + reimbursements',
    payRange: { min: 10, max: 40 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash'],
    pros: ['Automotive shop specialization', 'Healthcare opportunities', 'Fair pay', 'Professional company'],
    cons: ['In-person required', 'Detailed reports', 'Specialized knowledge sometimes needed', 'Variable availability']
  },
  {
    title: 'Reality Based Group',
    category: 'mystery-shopping',
    url: 'https://www.realitybasedgroup.com',
    signupUrl: 'https://www.realitybasedgroup.com/mystery-shoppers/',
    description: 'Customer experience company using mystery shopping and video mystery shopping. Evaluate restaurants, retail, and service businesses.',
    payType: 'mixed',
    typicalPay: '$10-$50/shop',
    payRange: { min: 10, max: 50 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash'],
    pros: ['Video shopping opportunities', 'Higher pay for video shops', 'Restaurant evaluations', 'Modern approach'],
    cons: ['Video shopping requires equipment', 'In-person only', 'Must follow strict protocols', 'Limited areas']
  },
  {
    title: 'Coyle Hospitality',
    category: 'mystery-shopping',
    url: 'https://www.coylehospitality.com',
    signupUrl: 'https://www.coylehospitality.com/shoppers/',
    description: 'Luxury hospitality mystery shopping. Evaluate hotels, resorts, restaurants, and spas. Reimbursed stays and dining at premium locations.',
    payType: 'reimbursement',
    typicalPay: 'Reimbursed stays + $50-$200 fee',
    payRange: { min: 50, max: 200 },
    format: 'in-person',
    qualification: 'US, International, 21+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'high-pay'],
    pros: ['Luxury hotel and resort stays', 'Fine dining evaluations', 'International opportunities', 'Premium experiences'],
    cons: ['Must front costs (reimbursed later)', 'Detailed multi-page reports', 'High standards expected', 'Limited availability']
  },
  {
    title: 'Quest for Best',
    category: 'mystery-shopping',
    url: 'https://www.questforbest.com',
    signupUrl: 'https://www.questforbest.com/shoppers/',
    description: 'Mystery shopping company specializing in retail, grocery, and food service evaluations. Offers regular assignments in many US markets.',
    payType: 'mixed',
    typicalPay: '$8-$30/shop + reimbursements',
    payRange: { min: 8, max: 30 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'beginner-friendly'],
    pros: ['Grocery and food service focus', 'Regular assignments', 'Free meals', 'Good for beginners'],
    cons: ['Lower base pay', 'Detailed reports', 'In-person only', 'Food service mainly']
  },
  {
    title: 'iSecretShop',
    category: 'mystery-shopping',
    url: 'https://isecretshop.com',
    signupUrl: 'https://isecretshop.com',
    description: 'Mystery shopping aggregator app. Browse and accept mystery shopping assignments from multiple companies in one place.',
    payType: 'mixed',
    typicalPay: '$5-$30/shop + reimbursements',
    payRange: { min: 5, max: 30 },
    format: 'in-person',
    qualification: 'US, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'beginner-friendly'],
    pros: ['Aggregates multiple companies', 'Easy mobile app', 'See nearby shops on map', 'Quick acceptance'],
    cons: ['Some shops pay very little', 'In-person only', 'Must complete reports', 'Variable quality of assignments']
  },
  {
    title: 'Shoppers Confidential',
    category: 'mystery-shopping',
    url: 'https://www.shoppersconfidential.com',
    signupUrl: 'https://www.shoppersconfidential.com/join',
    description: 'Canadian mystery shopping company. Evaluate retail, food service, and hospitality businesses across Canada.',
    payType: 'mixed',
    typicalPay: '$10-$30 CAD/shop + reimbursements',
    payRange: { min: 10, max: 30 },
    format: 'in-person',
    qualification: 'Canada, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash'],
    pros: ['Canadian focus', 'Regular assignments', 'Food and retail shops', 'Good for Canadian shoppers'],
    cons: ['Canada only', 'CAD payments', 'In-person only', 'Variable pay']
  },
  {
    title: 'Bare International',
    category: 'mystery-shopping',
    url: 'https://www.bareinternational.com',
    signupUrl: 'https://www.bareinternational.com/mystery-shoppers/',
    description: 'Global customer experience research company. Mystery shopping, auditing, and customer experience evaluations in 150+ countries.',
    payType: 'mixed',
    typicalPay: '$10-$50/shop + reimbursements',
    payRange: { min: 10, max: 50 },
    format: 'in-person',
    qualification: 'Global, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash'],
    pros: ['Global presence (150+ countries)', 'Major international brands', 'Hotel and restaurant shops', 'Professional company'],
    cons: ['In-person required', 'Detailed reports', 'Must front costs', 'Variable availability by location']
  },

  // ========================================================================
  // MEDICAL/CLINICAL STUDIES - Curated Platforms (23 platforms)
  // ========================================================================
  {
    title: 'ClinicalTrials.gov',
    category: 'medical-studies',
    url: 'https://clinicaltrials.gov',
    signupUrl: 'https://clinicaltrials.gov/search?aggFilters=status:rec',
    description: 'US government database of clinical studies. Search thousands of actively recruiting studies with compensation. The most comprehensive source for clinical trials.',
    payType: 'mixed',
    typicalPay: '$50-$10,000+ depending on study',
    payRange: { min: 50, max: 10000 },
    format: 'both',
    qualification: 'Varies by study, often 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Largest clinical trial database', 'Government-run and verified', 'Many studies pay well', 'Wide range of conditions'],
    cons: ['Must meet medical criteria', 'Can involve medications/procedures', 'Time commitment varies', 'Location-dependent']
  },
  {
    title: 'CenterWatch',
    category: 'medical-studies',
    url: 'https://www.centerwatch.com',
    signupUrl: 'https://www.centerwatch.com/clinical-trials/listings/',
    description: 'Clinical trials listing service and resource for patients. Find actively recruiting studies with compensation in your area.',
    payType: 'mixed',
    typicalPay: '$100-$5,000/study',
    payRange: { min: 100, max: 5000 },
    format: 'both',
    qualification: 'Varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Curated trial listings', 'Patient education resources', 'Compensation details listed', 'Trusted since 1994'],
    cons: ['Must meet medical criteria', 'Many studies location-specific', 'Not all studies compensate well']
  },
  {
    title: 'Fortrea (formerly Covance)',
    category: 'medical-studies',
    url: 'https://www.fortrea.com',
    signupUrl: 'https://www.fortrea.com/patients/volunteer',
    description: 'Major contract research organization conducting clinical trials. Healthy volunteer studies often pay $1,000-$10,000+ for multi-day stays.',
    payType: 'cash',
    typicalPay: '$1,000-$10,000/study',
    payRange: { min: 1000, max: 10000 },
    format: 'in-person',
    qualification: 'Healthy adults, 18-55, various locations',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Very high compensation', 'Professional facilities', 'Meals and housing provided', 'Well-established company'],
    cons: ['Multi-day confinement stays', 'Blood draws and procedures', 'Strict health requirements', 'Must be near facility']
  },
  {
    title: 'Rare Patient Voice',
    category: 'medical-studies',
    url: 'https://www.rarepatientvoice.com',
    signupUrl: 'https://www.rarepatientvoice.com/patients/',
    description: 'Connects patients with rare diseases to paid research studies. Helps pharmaceutical companies understand rare condition experiences.',
    payType: 'cash',
    typicalPay: '$50-$500/study',
    payRange: { min: 50, max: 500 },
    format: 'remote',
    qualification: 'Patients with specific conditions',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'medical', 'needs-qualification'],
    pros: ['Remote participation', 'Good pay for patients', 'Help advance rare disease research', 'Quick online surveys'],
    cons: ['Must have specific conditions', 'Limited by diagnosis', 'Not for healthy volunteers']
  },
  {
    title: 'ResearchMatch',
    category: 'medical-studies',
    url: 'https://www.researchmatch.org',
    signupUrl: 'https://www.researchmatch.org/volunteers/',
    description: 'Non-profit clinical trial matching service funded by NIH. Connects volunteers with researchers at academic medical centers nationwide.',
    payType: 'mixed',
    typicalPay: 'Varies by study',
    payRange: { min: 0, max: 5000 },
    format: 'both',
    qualification: 'US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'medical', 'beginner-friendly'],
    pros: ['NIH-funded', 'Non-profit and trustworthy', 'Academic medical center studies', 'Free to join'],
    cons: ['Not all studies compensate', 'Must wait for matches', 'US only', 'Academic research pace']
  },
  {
    title: 'Antidote',
    category: 'medical-studies',
    url: 'https://www.antidote.me',
    signupUrl: 'https://www.antidote.me/patients',
    description: 'Clinical trial matching platform. Answer questions about your health and get matched with relevant compensated studies in your area.',
    payType: 'mixed',
    typicalPay: 'Varies by study',
    payRange: { min: 0, max: 5000 },
    format: 'both',
    qualification: 'Global, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'medical'],
    pros: ['Intelligent matching system', 'Global availability', 'Patient-friendly interface', 'Multiple conditions covered'],
    cons: ['Not all studies paid', 'Must meet health criteria', 'Matching can take time']
  },
  {
    title: 'CISCRP',
    category: 'medical-studies',
    url: 'https://www.ciscrp.org',
    signupUrl: 'https://www.ciscrp.org/education-center/find-a-clinical-trial/',
    description: 'Center for Information & Study on Clinical Research Participation. Educational resource helping people find and understand clinical trials.',
    payType: 'mixed',
    typicalPay: 'Varies by study',
    payRange: { min: 0, max: 5000 },
    format: 'both',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'medical'],
    pros: ['Educational focus', 'Non-profit organization', 'Helps understand trial process', 'Find trials near you'],
    cons: ['Directory/educational — not direct enrollment', 'Not all trials listed', 'Information-focused']
  },
  {
    title: 'Meridian Clinical Research',
    category: 'medical-studies',
    url: 'https://www.meridiantrials.com',
    signupUrl: 'https://www.meridiantrials.com/volunteer/',
    description: 'Multi-site research organization conducting Phase I-IV clinical trials. Studies in vaccines, infectious disease, dermatology, and more.',
    payType: 'cash',
    typicalPay: '$100-$5,000/study',
    payRange: { min: 100, max: 5000 },
    format: 'in-person',
    qualification: 'US, varies by study, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Multiple US locations', 'Vaccine and infectious disease studies', 'Good compensation', 'Professional facilities'],
    cons: ['In-person visits required', 'Must meet health criteria', 'Location-dependent', 'Study commitments can be long']
  },
  {
    title: 'PPD (Thermo Fisher)',
    category: 'medical-studies',
    url: 'https://www.ppd.com',
    signupUrl: 'https://www.ppd.com/participate-in-clinical-trials/',
    description: 'Global contract research organization now part of Thermo Fisher Scientific. Conducts clinical studies across therapeutic areas worldwide.',
    payType: 'cash',
    typicalPay: '$500-$10,000/study',
    payRange: { min: 500, max: 10000 },
    format: 'in-person',
    qualification: 'Healthy adults, 18-55, near facilities',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Thermo Fisher backing', 'Very high pay for healthy volunteers', 'Global facilities', 'Professional care'],
    cons: ['Multi-day confinement often required', 'Strict health screening', 'Must be near facility', 'Medical procedures involved']
  },
  {
    title: 'ICON plc',
    category: 'medical-studies',
    url: 'https://www.iconplc.com',
    signupUrl: 'https://www.iconplc.com/patients/',
    description: 'Global healthcare intelligence and clinical research organization. Runs clinical trials in almost every therapeutic area.',
    payType: 'cash',
    typicalPay: '$200-$5,000/study',
    payRange: { min: 200, max: 5000 },
    format: 'both',
    qualification: 'Global, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Global research network', 'Many therapeutic areas', 'Professional organization', 'Good compensation'],
    cons: ['Must meet study criteria', 'Location-dependent', 'Medical procedures', 'Long commitments possible']
  },
  {
    title: 'Syneos Health',
    category: 'medical-studies',
    url: 'https://www.syneoshealth.com',
    signupUrl: 'https://www.syneoshealth.com/patients',
    description: 'Biopharmaceutical solutions organization. Conducts clinical trials from Phase I through post-marketing across all therapeutic areas.',
    payType: 'cash',
    typicalPay: '$200-$8,000/study',
    payRange: { min: 200, max: 8000 },
    format: 'both',
    qualification: 'Global, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Large CRO', 'Many study types', 'Global presence', 'Good compensation'],
    cons: ['Study-specific requirements', 'Medical procedures', 'Time commitment', 'Must qualify']
  },
  {
    title: 'Science 37',
    category: 'medical-studies',
    url: 'https://www.science37.com',
    signupUrl: 'https://www.science37.com/patients',
    description: 'Decentralized clinical trial company. Participate in studies from home through telemedicine, connected devices, and local labs.',
    payType: 'cash',
    typicalPay: '$50-$2,000/study',
    payRange: { min: 50, max: 2000 },
    format: 'remote',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote', 'medical'],
    pros: ['Home-based participation', 'No travel to research sites', 'Telemedicine visits', 'Modern approach'],
    cons: ['Must meet health criteria', 'Connected devices required', 'US only', 'Newer company']
  },
  {
    title: 'Clinical Connection',
    category: 'medical-studies',
    url: 'https://www.clinicalconnection.com',
    signupUrl: 'https://www.clinicalconnection.com',
    description: 'Free clinical trial search platform. Find paid medical studies in your area by condition, location, and compensation level.',
    payType: 'mixed',
    typicalPay: 'Varies by study',
    payRange: { min: 0, max: 5000 },
    format: 'both',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'medical'],
    pros: ['Free search tool', 'Compensation info listed', 'Filter by location', 'Many conditions covered'],
    cons: ['Directory — not direct enrollment', 'Must contact each site', 'Not all trials listed']
  },
  {
    title: 'Parexel',
    category: 'medical-studies',
    url: 'https://www.parexel.com',
    signupUrl: 'https://www.parexel.com/participants',
    description: 'Global biopharmaceutical services company conducting clinical trials. Their Early Phase units recruit healthy volunteers for well-compensated studies.',
    payType: 'cash',
    typicalPay: '$1,000-$8,000/study',
    payRange: { min: 1000, max: 8000 },
    format: 'in-person',
    qualification: 'Healthy adults, 18-55, near facilities',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Very high compensation', 'Professional facilities', 'Meals and accommodation', 'Long-standing company'],
    cons: ['Multi-day confinement', 'Blood draws and procedures', 'Strict screening', 'Must be near facility']
  },
  {
    title: 'ProofPilot',
    category: 'medical-studies',
    url: 'https://www.proofpilot.com',
    signupUrl: 'https://www.proofpilot.com',
    description: 'Digital clinical trial platform making it easier to participate in research from your phone. Focus on behavioral and wellness studies.',
    payType: 'cash',
    typicalPay: '$20-$200/study',
    payRange: { min: 20, max: 200 },
    format: 'remote',
    qualification: 'US, varies by study',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'medical'],
    pros: ['Phone-based participation', 'Behavioral/wellness focus', 'Easy to use', 'Remote participation'],
    cons: ['Fewer studies available', 'Lower compensation', 'Must meet criteria', 'Newer platform']
  },
  {
    title: 'ObvioHealth',
    category: 'medical-studies',
    url: 'https://www.obviohealth.com',
    signupUrl: 'https://www.obviohealth.com/participants/',
    description: 'Virtual clinical trial company specializing in decentralized research. Participate from home for nutrition, wellness, and health studies.',
    payType: 'cash',
    typicalPay: '$50-$1,000/study',
    payRange: { min: 50, max: 1000 },
    format: 'remote',
    qualification: 'US, varies by study',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote', 'medical'],
    pros: ['Home-based studies', 'Nutrition and wellness focus', 'Modern app-based experience', 'Good compensation'],
    cons: ['Limited studies available', 'Must meet health criteria', 'US-focused', 'Newer company']
  },
  {
    title: 'Velocity Clinical Research',
    category: 'medical-studies',
    url: 'https://www.velocityclinical.com',
    signupUrl: 'https://www.velocityclinical.com/volunteer/',
    description: 'Network of dedicated clinical research sites across the US. Conducts vaccine, infectious disease, and general health studies.',
    payType: 'cash',
    typicalPay: '$100-$5,000/study',
    payRange: { min: 100, max: 5000 },
    format: 'in-person',
    qualification: 'US, varies by study, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Multiple US locations', 'Vaccine studies', 'Good compensation', 'Growing network'],
    cons: ['In-person required', 'Must meet criteria', 'Location-dependent', 'Study commitments']
  },
  {
    title: 'TrialSpark (now Formation Bio)',
    category: 'medical-studies',
    url: 'https://formation.bio',
    signupUrl: 'https://formation.bio',
    description: 'Formerly TrialSpark, now part of Formation Bio. Technology-driven clinical trial company that connects patients with trials near them. Focuses on making trial participation easier with local clinics and streamlined processes.',
    payType: 'cash',
    typicalPay: '$100-$3,000/study',
    payRange: { min: 100, max: 3000 },
    format: 'in-person',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Local clinic locations', 'Streamlined enrollment', 'Good compensation', 'Technology-forward approach'],
    cons: ['In-person visits required', 'Must meet health criteria', 'Limited locations', 'Study commitments vary']
  },
  {
    title: 'StudyPages',
    category: 'medical-studies',
    url: 'https://www.studypages.com',
    signupUrl: 'https://www.studypages.com/patients/',
    description: 'Clinical trial search platform helping patients discover local paid research studies. Aggregates trials from multiple research centers with compensation details.',
    payType: 'cash',
    typicalPay: '$50-$5,000/study',
    payRange: { min: 50, max: 5000 },
    format: 'both',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Easy trial search by location', 'Compensation details shown upfront', 'Wide range of studies', 'Both remote and in-person'],
    cons: ['Aggregator — must apply separately', 'Must meet study criteria', 'Variable availability by area', 'Enrollment not guaranteed']
  },
  {
    title: 'Recruit.me',
    category: 'medical-studies',
    url: 'https://www.recruit.me',
    signupUrl: 'https://www.recruit.me/volunteers/',
    description: 'Clinical trial matching service that pairs volunteers with relevant studies based on their health profile. Free to join with personalized study recommendations.',
    payType: 'cash',
    typicalPay: '$100-$5,000/study',
    payRange: { min: 100, max: 5000 },
    format: 'both',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Personalized study matching', 'Free to join', 'Wide range of therapeutic areas', 'Both remote and in-person options'],
    cons: ['Must share health information', 'Not all matches lead to enrollment', 'Study availability varies', 'Must meet specific criteria']
  },
  {
    title: 'Power',
    category: 'medical-studies',
    url: 'https://www.withpower.com',
    signupUrl: 'https://www.withpower.com/participants',
    description: 'Patient-owned research platform that puts participants in control of their data. Find and join paid clinical studies while maintaining ownership of your health information.',
    payType: 'cash',
    typicalPay: '$50-$2,000/study',
    payRange: { min: 50, max: 2000 },
    format: 'both',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'remote'],
    pros: ['Patient data ownership', 'Privacy-focused', 'Multiple study options', 'Modern platform experience'],
    cons: ['Newer platform', 'Limited study volume', 'Must share health data to match', 'Variable compensation']
  },
  {
    title: 'Clara Health',
    category: 'medical-studies',
    url: 'https://www.clarahealth.com',
    signupUrl: 'https://www.clarahealth.com/patients',
    description: 'AI-powered clinical trial matching platform. Uses artificial intelligence to match patients with relevant trials based on their health profile and preferences.',
    payType: 'cash',
    typicalPay: '$100-$5,000/study',
    payRange: { min: 100, max: 5000 },
    format: 'both',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['AI-powered matching for better fits', 'Free for patients', 'Wide therapeutic coverage', 'Streamlined application process'],
    cons: ['Must share detailed health info', 'Not all matches lead to acceptance', 'US-focused', 'In-person visits often required']
  },
  {
    title: 'Acurian (now TrialMed)',
    category: 'medical-studies',
    url: 'https://www.trialmed.com',
    signupUrl: 'https://www.trialmed.com',
    description: 'Formerly Acurian, now operating as TrialMed. Clinical trial recruitment company that connects patients with paid research studies. Phone screening process to match you with appropriate trials in your area.',
    payType: 'cash',
    typicalPay: '$100-$5,000/study',
    payRange: { min: 100, max: 5000 },
    format: 'in-person',
    qualification: 'US, varies by study',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'medical', 'high-pay'],
    pros: ['Phone screening for convenience', 'Large trial network', 'Established recruitment company', 'Good compensation'],
    cons: ['Phone screening required', 'In-person visits needed', 'Must meet health criteria', 'May receive recruitment calls']
  },

  // ========================================================================
  // ADDITIONAL MISC HIGH-VALUE PLATFORMS
  // ========================================================================
  {
    title: 'Testable Minds',
    category: 'surveys',
    url: 'https://minds.testable.org',
    signupUrl: 'https://minds.testable.org',
    description: 'Academic research platform for cognitive and psychological studies. Participate in experiments from universities worldwide via your browser.',
    payType: 'cash',
    typicalPay: '$3-$15/study',
    payRange: { min: 3, max: 15 },
    format: 'remote',
    qualification: 'Global, 18+',
    trustLevel: 'medium',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Academic research', 'Interesting cognitive studies', 'Browser-based', 'PayPal payments'],
    cons: ['Fewer studies than Prolific', 'Variable availability', 'Some studies are unpaid']
  },
  {
    title: 'Leger',
    category: 'focus-groups',
    url: 'https://leger360.com',
    signupUrl: 'https://leger360.com/panel/',
    description: 'Leger is a top Canadian market research firm conducting surveys, focus groups, and opinion polls. Major panel in Canada and US.',
    payType: 'mixed',
    typicalPay: '$1-$5/survey, $75-$200/focus group',
    payRange: { min: 1, max: 200 },
    format: 'both',
    qualification: 'Canada, US, 18+',
    trustLevel: 'high',
    badges: ['verified', 'cash', 'remote'],
    pros: ['Major Canadian firm', 'Both surveys and focus groups', 'Good pay for groups', 'Professional'],
    cons: ['Canada-focused', 'Variable availability', 'Must match demographics for groups']
  },
];


// ========================================================================
// ClinicalTrials.gov API Scraper
// ========================================================================
async function scrapeClinicalTrials() {
  log('Scraping ClinicalTrials.gov API for paid recruiting studies...');
  const listings = [];

  try {
    // Search for recruiting studies mentioning compensation/payment
    const queries = [
      'paid+participants',
      'compensation+for+participation',
      'stipend+volunteers'
    ];

    for (const q of queries) {
      const apiUrl = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(q)}&filter.overallStatus=RECRUITING&pageSize=20&format=json`;
      log(`  Fetching: ${apiUrl}`);

      const res = await fetchUrl(apiUrl, { json: true, timeout: 20000 });
      if (!res.ok || !res.body) {
        log(`  WARNING: ClinicalTrials.gov API returned status ${res.status}`);
        continue;
      }

      let data;
      try {
        data = JSON.parse(res.body);
      } catch (e) {
        log(`  WARNING: Failed to parse ClinicalTrials.gov JSON: ${e.message}`);
        continue;
      }

      const studies = data.studies || [];
      log(`  Found ${studies.length} studies for query "${q}"`);

      for (const study of studies) {
        try {
          const proto = study.protocolSection || {};
          const idModule = proto.identificationModule || {};
          const descModule = proto.descriptionModule || {};
          const statusModule = proto.statusModule || {};
          const eligModule = proto.eligibilityModule || {};
          const contactsModule = proto.contactsLocationsModule || {};
          const conditionsModule = proto.conditionsModule || {};

          const nctId = idModule.nctId || '';
          const title = idModule.briefTitle || idModule.officialTitle || 'Untitled Study';
          const briefSummary = stripHtml(descModule.briefSummary || '');
          const conditions = (conditionsModule.conditions || []).join(', ');
          const eligCriteria = stripHtml(eligModule.eligibilityCriteria || '').substring(0, 200);
          const minAge = eligModule.minimumAge || '18 Years';
          const maxAge = eligModule.maximumAge || 'N/A';
          const sex = eligModule.sex || 'ALL';

          // Extract locations
          const locations = (contactsModule.locations || []).slice(0, 3);
          const locationStr = locations.map(l => {
            return [l.facility, l.city, l.state, l.country].filter(Boolean).join(', ');
          }).join(' | ') || 'Multiple locations';

          const slug = slugify(`ct-${nctId}-${title.substring(0, 40)}`);

          // Check for duplicates
          if (listings.find(l => l.id === slug)) continue;

          listings.push({
            id: slug,
            title: truncate(title, 100),
            category: 'medical-studies',
            url: `https://clinicaltrials.gov/study/${nctId}`,
            description: truncate(briefSummary || `Clinical study for ${conditions || 'various conditions'}. ${eligCriteria}`, 300),
            payType: 'cash',
            typicalPay: 'Compensation varies — check study details',
            payRange: { min: 0, max: 0 },
            format: 'in-person',
            qualification: `${sex === 'ALL' ? 'All genders' : sex}, Age ${minAge}${maxAge !== 'N/A' ? '-' + maxAge : '+'}, ${conditions ? 'Conditions: ' + truncate(conditions, 80) : 'See eligibility'}`,
            trustLevel: 'high',
            badges: ['verified', 'medical'],
            signupUrl: `https://clinicaltrials.gov/study/${nctId}`,
            pros: ['Government-registered study', 'Medical supervision', conditions ? `Studying: ${truncate(conditions, 60)}` : 'Various conditions', `Location: ${truncate(locationStr, 60)}`],
            cons: ['Must meet medical criteria', 'May involve procedures', 'Time commitment required', 'Location-dependent'],
            source: 'clinicaltrials',
            lastChecked: today(),
            isActive: true
          });
        } catch (e) {
          log(`  WARNING: Error parsing study: ${e.message}`);
        }
      }

      await sleep(RATE_LIMIT_MS);
    }

    // Deduplicate by NCT ID
    const seen = new Set();
    const deduped = [];
    for (const l of listings) {
      const nctMatch = l.url.match(/NCT\d+/);
      const key = nctMatch ? nctMatch[0] : l.id;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(l);
      }
    }

    log(`  ClinicalTrials.gov: ${deduped.length} unique paid studies found`);
    return deduped.slice(0, CLINICAL_TRIALS_LIMIT);
  } catch (e) {
    log(`  ERROR scraping ClinicalTrials.gov: ${e.message}`);
    return [];
  }
}


// ========================================================================
// URL Validation
// ========================================================================
async function validateUrls(listings) {
  log(`Validating URLs for ${listings.length} listings...`);
  let alive = 0;
  let dead = 0;
  let skipped = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    // Skip clinical trials API results (they're from a live API, definitely valid)
    if (listing.source === 'clinicaltrials') {
      listing.isActive = true;
      skipped++;
      continue;
    }

    try {
      const isAlive = await checkUrl(listing.url);
      listing.isActive = isAlive;
      if (isAlive) {
        alive++;
      } else {
        dead++;
        log(`  DEAD LINK: ${listing.title} — ${listing.url}`);
      }
    } catch (e) {
      listing.isActive = true; // assume alive on error
      skipped++;
    }

    // Rate limit
    if ((i + 1) % 10 === 0) {
      log(`  Checked ${i + 1}/${listings.length} URLs (${alive} alive, ${dead} dead, ${skipped} skipped)`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  log(`URL Validation complete: ${alive} alive, ${dead} dead, ${skipped} skipped`);
  return listings;
}


// ========================================================================
// Build final listings from curated database
// ========================================================================
function buildCuratedListings() {
  log(`Building curated listings from ${CURATED_PLATFORMS.length} platforms...`);
  return CURATED_PLATFORMS.map(p => ({
    id: slugify(p.title),
    title: p.title,
    category: p.category,
    url: p.url,
    description: p.description,
    payType: p.payType,
    typicalPay: p.typicalPay,
    payRange: p.payRange,
    format: p.format,
    qualification: p.qualification,
    trustLevel: p.trustLevel,
    badges: p.badges,
    signupUrl: p.signupUrl || p.url,
    pros: p.pros,
    cons: p.cons,
    source: 'curated',
    lastChecked: today(),
    isActive: true
  }));
}


// ========================================================================
// Sort and organize
// ========================================================================
function sortListings(listings) {
  const categoryOrder = ['surveys', 'user-testing', 'focus-groups', 'product-testing', 'mystery-shopping', 'medical-studies'];
  const trustOrder = { high: 0, medium: 1, low: 2 };

  return listings.sort((a, b) => {
    const catA = categoryOrder.indexOf(a.category);
    const catB = categoryOrder.indexOf(b.category);
    if (catA !== catB) return catA - catB;

    const trustA = trustOrder[a.trustLevel] || 2;
    const trustB = trustOrder[b.trustLevel] || 2;
    if (trustA !== trustB) return trustA - trustB;

    return a.title.localeCompare(b.title);
  });
}


// ========================================================================
// Stats
// ========================================================================
function printStats(listings) {
  log('\n========================================');
  log('SCRAPER RESULTS SUMMARY');
  log('========================================');

  const categories = {};
  const sources = {};
  let active = 0;
  let inactive = 0;

  for (const l of listings) {
    categories[l.category] = (categories[l.category] || 0) + 1;
    sources[l.source] = (sources[l.source] || 0) + 1;
    if (l.isActive) active++;
    else inactive++;
  }

  log(`\nTotal listings: ${listings.length}`);
  log(`Active: ${active} | Inactive: ${inactive}`);

  log('\nBy Category:');
  const categoryLabels = {
    'surveys': 'Surveys',
    'user-testing': 'User Testing',
    'focus-groups': 'Focus Groups',
    'product-testing': 'Product Testing',
    'mystery-shopping': 'Mystery Shopping',
    'medical-studies': 'Medical/Clinical Studies'
  };
  for (const [cat, label] of Object.entries(categoryLabels)) {
    log(`  ${label}: ${categories[cat] || 0}`);
  }

  log('\nBy Source:');
  for (const [src, count] of Object.entries(sources)) {
    log(`  ${src}: ${count}`);
  }

  log('========================================\n');
}


// ========================================================================
// MAIN
// ========================================================================
async function main() {
  const startTime = Date.now();
  log('=== Verified Paid Opportunities Directory Scraper ===');
  log(`Started at ${new Date().toISOString()}`);

  // Ensure directories exist
  for (const dir of [DATA_DIR, path.join(__dirname, 'site')]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(`Created directory: ${dir}`);
    }
  }

  // Clear log for fresh run
  try { fs.writeFileSync(LOG_FILE, ''); } catch (e) {}

  // Step 1: Build curated listings
  let allListings = buildCuratedListings();
  log(`Curated platforms: ${allListings.length}`);

  // Step 2: Scrape ClinicalTrials.gov API
  const clinicalListings = await scrapeClinicalTrials();
  allListings = allListings.concat(clinicalListings);
  log(`After ClinicalTrials.gov: ${allListings.length} total`);

  // Step 3: Validate URLs
  allListings = await validateUrls(allListings);

  // Step 3b: Remove inactive listings (dead links are useless)
  const beforeCount = allListings.length;
  allListings = allListings.filter(l => l.isActive);
  log(`Removed ${beforeCount - allListings.length} inactive listings (dead links)`);

  // Step 4: Sort
  allListings = sortListings(allListings);

  // Step 5: Build output
  const output = {
    meta: {
      title: 'Verified Paid Opportunities Directory',
      description: 'Curated directory of legitimate paid opportunities including surveys, user testing, focus groups, product testing, mystery shopping, and clinical studies.',
      generated: new Date().toISOString(),
      totalListings: allListings.length,
      activeListings: allListings.filter(l => l.isActive).length,
      categories: {
        surveys: allListings.filter(l => l.category === 'surveys').length,
        'user-testing': allListings.filter(l => l.category === 'user-testing').length,
        'focus-groups': allListings.filter(l => l.category === 'focus-groups').length,
        'product-testing': allListings.filter(l => l.category === 'product-testing').length,
        'mystery-shopping': allListings.filter(l => l.category === 'mystery-shopping').length,
        'medical-studies': allListings.filter(l => l.category === 'medical-studies').length,
      }
    },
    listings: allListings
  };

  // Step 6: Write output files
  const jsonStr = JSON.stringify(output, null, 2);

  fs.writeFileSync(RESULTS_FILE, jsonStr);
  log(`Wrote ${RESULTS_FILE}`);

  fs.writeFileSync(SITE_DATA_FILE, jsonStr);
  log(`Wrote ${SITE_DATA_FILE}`);

  // Step 7: Print stats
  printStats(allListings);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Scraper completed in ${elapsed}s`);
}

main().catch(e => {
  log(`FATAL ERROR: ${e.message}`);
  console.error(e);
  process.exit(1);
});
