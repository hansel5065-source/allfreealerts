#!/usr/bin/env node
/**
 * Generates /settlement-tracker.html — an original, data-driven page (Track A).
 *
 * "Information gain": no other single page aggregates + ranks every open
 * class-action settlement we track (payout rankings, no-proof counts, deadlines
 * closing this week). Combines hand-written original editorial (E-E-A-T) with
 * unique live statistics computed from our dataset. Regenerated daily.
 *
 * Run after cleanup, before deploy:  node build_settlement_report.js
 */
const fs = require('fs');
const path = require('path');

const RESULTS = path.join(__dirname, 'data', 'results.json');
const OUT = path.join(__dirname, 'site', 'settlement-tracker.html');
const MONTHS = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };

// today comes from an env var if provided (workflow passes it), else system date is avoided
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const now = new Date(TODAY + 'T00:00:00');

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function parseDate(s){ if(!s||s==='Unknown')return null; s=s.trim();
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(m){let y=+m[3];if(y<100)y+=2000;return new Date(y,+m[1]-1,+m[2]);}
  m=s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/); if(m&&MONTHS[m[1].toLowerCase()]!==undefined)return new Date(m[3]?+m[3]:now.getFullYear(),MONTHS[m[1].toLowerCase()],+m[2]);
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return new Date(+m[1],+m[2]-1,+m[3]); return null; }
function maxPay(p){ const nums=(p||'').match(/\$\s?([\d,]+)/g)||[]; return nums.map(n=>+n.replace(/[^\d]/g,'')).reduce((a,b)=>Math.max(a,b),0); }
function fmtDate(d){ return d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }

const items = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
const S = items.filter(i => i.category === 'Settlements' && i.link);
// Proof status is only asserted when the administrator actually specifies it.
// "No"/"N/A" = confirmed no proof; "Yes" = confirmed proof; missing = unknown.
const noProofKnown = S.filter(i => /^(no|n\/a)$/i.test((i.proof_required || '').trim()));
const proofKnown = S.filter(i => /^yes$/i.test((i.proof_required || '').trim()));
const nationwide = S.filter(i => i.scope === 'nationwide');   // scope is now backfilled for all
const stateSpecific = S.filter(i => i.scope === 'state-specific');
const withPayout = S.filter(i => /\$\s?[\d,]/.test(i.payout || ''));
function proofLabel(i){ const p=(i.proof_required||'').trim();
  if(/^yes$/i.test(p)) return 'Proof required';
  if(/^(no|n\/a)$/i.test(p)) return 'No proof';
  return 'Check claim form'; }

const closing = S.map(i => ({ i, d: parseDate(i.deadline || i.end_date) }))
  .filter(x => x.d && (x.d - now) / 864e5 >= 0 && (x.d - now) / 864e5 <= 10)
  .sort((a, b) => a.d - b.d).slice(0, 12);

const ranked = withPayout.map(i => ({ i, v: maxPay(i.payout) }))
  .sort((a, b) => b.v - a.v).slice(0, 15);

const noProofNation = noProofKnown.filter(i => i.scope === 'nationwide').slice(0, 12);

const payoutRows = ranked.map(({ i }) => `<tr>
        <td><a href="${esc(i.link)}" target="_blank" rel="nofollow noopener">${esc(i.title)}</a></td>
        <td class="pay">${esc(i.payout)}</td>
        <td>${proofLabel(i)}</td>
      </tr>`).join('\n      ');

const closingRows = closing.map(({ i, d }) => `<tr>
        <td><a href="${esc(i.link)}" target="_blank" rel="nofollow noopener">${esc(i.title)}</a></td>
        <td>${fmtDate(d)}</td>
        <td>${esc(i.payout || '—')}</td>
      </tr>`).join('\n      ');

const noProofList = noProofNation.map(i =>
  `<li><a href="${esc(i.link)}" target="_blank" rel="nofollow noopener">${esc(i.title)}</a>${i.payout ? ` &mdash; <span class="np">${esc(i.payout)}</span>` : ''}</li>`).join('\n        ');

const updated = fmtDate(now);
const topPay = ranked.length ? ranked[0].v.toLocaleString() : '0';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Open Class-Action Settlements You Can Claim — Live Tracker (${now.getFullYear()}) | AllFreeAlerts</title>
  <meta name="description" content="A live tracker of ${S.length} open class-action settlements you can claim right now — ${nationwide.length} open nationwide, ranked by payout, with claim deadlines closing this week. Updated ${updated}.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://allfreealerts.com/settlement-tracker">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3295178838066537" crossorigin="anonymous"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Article","headline":"Open Class-Action Settlements You Can Claim — Live Tracker","datePublished":"2026-04-10","dateModified":"${TODAY}","author":{"@type":"Person","name":"Hansel M."},"publisher":{"@type":"Organization","name":"AllFreeAlerts","url":"https://allfreealerts.com"},"description":"Live tracker of open class-action settlements you can claim, ranked by payout."}
  </script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--teal:#0ABAB5;--teal-dark:#089E9A;--orange:#FF6F3C;--gold:#F5A623;--blue:#3B82F6;--green:#10B981;--coral:#FF6B6B;--bg:#F5F7FA;--white:#fff;--text:#1A1D21;--text-mid:#636E72;--border:#E5E7EB;--radius:16px;--shadow:0 1px 3px rgba(0,0,0,.06)}
    body{font-family:'Inter',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;-webkit-font-smoothing:antialiased}
    a{color:var(--teal);text-decoration:none}a:hover{text-decoration:underline}
    .nav{background:var(--white);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
    .nav-inner{max-width:1100px;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;height:60px;gap:1rem}
    .nav-logo{font-size:1.35rem;font-weight:900;color:var(--teal);letter-spacing:-.03em}.nav-logo span{color:var(--text)}
    .nav-back{margin-left:auto;font-size:.88rem;font-weight:600;color:var(--text-mid)}
    .hero{background:linear-gradient(180deg,#EFF6FF 0%,var(--bg) 100%);padding:2.5rem 1.5rem 1.5rem;text-align:center}
    .hero h1{font-size:2rem;font-weight:800;letter-spacing:-.03em;line-height:1.25;max-width:760px;margin:0 auto}
    .hero h1 b{color:var(--blue)}
    .hero p{margin-top:.6rem;color:var(--text-mid);max-width:620px;margin-left:auto;margin-right:auto}
    .updated{display:inline-block;margin-top:.8rem;font-size:.78rem;font-weight:600;color:var(--text-mid);background:var(--white);border:1px solid var(--border);padding:.3rem .8rem;border-radius:100px}
    .wrap{max-width:900px;margin:0 auto;padding:1.5rem}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin:1.5rem 0}
    .stat{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem 1rem;text-align:center;box-shadow:var(--shadow)}
    .stat .num{font-size:1.8rem;font-weight:800;color:var(--blue);letter-spacing:-.02em}
    .stat .lbl{font-size:.78rem;color:var(--text-mid);font-weight:600;margin-top:.2rem}
    .card{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:2rem;margin:1.5rem 0;box-shadow:var(--shadow)}
    .card h2{font-size:1.35rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.75rem}
    .card h3{font-size:1.05rem;font-weight:700;margin:1.25rem 0 .4rem}
    .card p{color:var(--text-mid);margin-bottom:.8rem}
    table{width:100%;border-collapse:collapse;font-size:.88rem;margin-top:.5rem}
    th,td{text-align:left;padding:.6rem .5rem;border-bottom:1px solid var(--border);vertical-align:top}
    th{font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-mid);font-weight:700}
    td.pay{font-weight:700;color:var(--green);white-space:nowrap}
    ul.np{list-style:none;margin-top:.5rem}ul.np li{padding:.4rem 0;border-bottom:1px solid var(--border)}
    .np{color:var(--green);font-weight:600}
    .byline{font-size:.85rem;color:var(--text-mid);margin-bottom:1rem}
    .cta{background:#EFF6FF;border:1px solid #BFDBFE;border-radius:var(--radius);padding:1.5rem;text-align:center;margin:1.5rem 0}
    .cta a{font-weight:700}
    .footer{background:var(--white);border-top:1px solid var(--border);text-align:center;padding:2rem 1.5rem;color:var(--text-mid);font-size:.8rem;margin-top:2rem}
    @media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}.hero h1{font-size:1.5rem}}
  </style>
</head>
<body>
  <nav class="nav"><div class="nav-inner">
    <a class="nav-logo" href="/">All<span>Free</span>Alerts</a>
    <a class="nav-back" href="/settlements">Browse all settlements →</a>
  </div></nav>

  <section class="hero">
    <h1>Open <b>Class-Action Settlements</b> You Can Claim Right Now</h1>
    <p>A live, independently maintained tracker of every open settlement we follow — ranked by payout, flagged for proof requirements, and sorted by deadline.</p>
    <div class="updated">Last updated ${updated} · ${S.length} open settlements tracked</div>
  </section>

  <div class="wrap">
    <div class="stats">
      <div class="stat"><div class="num">${S.length}</div><div class="lbl">Open settlements</div></div>
      <div class="stat"><div class="num">${nationwide.length}</div><div class="lbl">Open nationwide</div></div>
      <div class="stat"><div class="num">${closing.length}</div><div class="lbl">Closing within 10 days</div></div>
      <div class="stat"><div class="num">$${topPay}</div><div class="lbl">Top payout</div></div>
    </div>

    <div class="card">
      <p class="byline">By <a href="/about">Hansel M.</a>, Founder · Updated ${updated}</p>
      <h2>Billions in settlement money goes unclaimed every year. Here's what's open today.</h2>
      <p>Every year, U.S. companies settle class-action lawsuits by paying into funds meant to compensate ordinary consumers — and most of that money is never claimed, simply because people don't know the settlements exist or assume the process is complicated. It usually isn't. Right now we're tracking <strong>${S.length} open settlements</strong>, <strong>${nationwide.length} of them open to consumers nationwide</strong>. Many require no proof of purchase at all — you confirm you qualify, submit a short form, and wait for a check or deposit.</p>
      <p>This page is different from a typical settlement blog. Instead of writing up one settlement at a time, we aggregate every open claim we can verify and rank them by what actually matters to you: how much they pay, whether documentation is required, and how soon the deadline hits. The tables below are regenerated automatically as settlements open and close, so what you see is current as of ${updated}. Every link goes to the official claim administrator — never a middleman. Where a settlement's documentation rules aren't specified by the administrator, we say "check the claim form" rather than guess.</p>
      <h3>How to read this tracker</h3>
      <p><strong>No-proof claims</strong> are the easiest money: you attest that you bought the product or used the service during the covered period and receive a flat payment, usually $5–$50. <strong>Proof-required claims</strong> ask for receipts or statements but tend to pay far more because fewer people file. <strong>Nationwide</strong> settlements are open to anyone in the U.S.; <strong>state-specific</strong> ones are limited to certain states. When in doubt, file the no-proof claims first — they take two minutes and there's no downside.</p>
    </div>

    <div class="card">
      <h2>Highest-paying settlements open right now</h2>
      <p>Ranked by maximum stated payout. Larger awards (especially data-breach settlements) usually require documentation of your losses, but several pay four figures with minimal proof.</p>
      <table>
        <thead><tr><th>Settlement</th><th>Payout</th><th>Proof</th></tr></thead>
        <tbody>
      ${payoutRows}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Claim deadlines closing within 10 days</h2>
      <p>These windows close soon — if you qualify, file before the date shown. After the deadline the claim form is permanently disabled.</p>
      ${closing.length ? `<table>
        <thead><tr><th>Settlement</th><th>Deadline</th><th>Payout</th></tr></thead>
        <tbody>
      ${closingRows}
        </tbody>
      </table>` : '<p>No settlements are closing in the next 10 days. Check back — new deadlines appear constantly.</p>'}
    </div>

    <div class="card">
      <h2>Confirmed no-proof settlements, open nationwide</h2>
      <p>These are claims the administrator has confirmed need <strong>no receipts or documentation</strong> — the most accessible money on the board. ${noProofNation.length ? 'A sample of what\'s open' : 'Check back as new ones open'} — <a href="/settlements">see all ${S.length} on the full settlements page</a>.</p>
      ${noProofNation.length ? `<ul class="np">
        ${noProofList}
      </ul>` : ''}
    </div>

    <div class="cta">
      <p>Want these in your inbox the morning they open?</p>
      <a href="/#subscribe">Get free daily settlement alerts →</a>
    </div>

    <div class="card">
      <h3>Related reading</h3>
      <p>
        <a href="/blog/how-to-file-class-action-settlement-claims">How to file a class-action settlement claim</a> ·
        <a href="/blog/what-are-class-action-settlements">What are class-action settlements?</a> ·
        <a href="/blog/understanding-settlement-payouts">Understanding settlement payouts</a>
      </p>
      <p style="font-size:.8rem;margin-top:.5rem">AllFreeAlerts is an independent aggregator. We are not a settlement administrator or law firm and we don't process claims — we point you to the official claim forms. Payout amounts are the maximums stated by each settlement and are not guaranteed.</p>
    </div>
  </div>

  <footer class="footer">
    &copy; ${now.getFullYear()} AllFreeAlerts.com — We look for them so you don't have to.<br>
    <a href="mailto:contact@allfreealerts.com">contact@allfreealerts.com</a>
  </footer>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log(`[settlement-tracker] ${S.length} settlements | ${noProofKnown.length} confirmed-no-proof (${proofKnown.length} proof, ${S.length-noProofKnown.length-proofKnown.length} unspecified) | ${nationwide.length} nationwide / ${stateSpecific.length} state | ${closing.length} closing<=10d | top $${topPay}`);
console.log(`  Wrote ${OUT}`);
