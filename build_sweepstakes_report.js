#!/usr/bin/env node
/**
 * Generates /sweepstakes-tracker.html — original data-driven page (Track A).
 *
 * Unique "information gain": ranks the biggest active sweepstakes prizes across
 * everything we aggregate — no other single page does this. Built only from data
 * we can verify (parsed prize values); deliberately omits a "closing soon"
 * section because only ~8 of 717 sweeps carry a parseable deadline (claiming
 * otherwise would be inaccurate). Regenerated daily.
 *
 * Run after cleanup, before deploy:  node build_sweepstakes_report.js
 */
const fs = require('fs');
const path = require('path');

const RESULTS = path.join(__dirname, 'data', 'results.json');
const OUT = path.join(__dirname, 'site', 'sweepstakes-tracker.html');
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const now = new Date(TODAY + 'T00:00:00');

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(d){ return d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }
function maxPrize(i){
  const txt = `${i.prize_summary||''} ${i.payout||''} ${i.title||''}`;
  const nums = txt.match(/\$\s?([\d,]+(?:\.\d+)?)/g) || [];
  return nums.map(n => +n.replace(/[^\d.]/g, '')).reduce((a, b) => Math.max(a, b), 0);
}
function prizeType(i){
  const t = `${i.title||''} ${i.prize_summary||''}`.toLowerCase();
  if (/\bcash\b|\$[\d,]/.test(t)) return 'Cash';
  if (/\bcar\b|vehicle|truck|suv|jeep|nissan|ford|toyota/.test(t)) return 'Vehicle';
  if (/trip|vacation|getaway|cruise|flight|travel|resort/.test(t)) return 'Trip';
  if (/gift card|giftcard|e-gift|visa card/.test(t)) return 'Gift card';
  return 'Prize';
}

const items = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
const W = items.filter(i => i.category === 'Sweepstakes' && i.link);
const withPrize = W.map(i => ({ i, v: maxPrize(i) })).filter(x => x.v > 0);
const ranked = withPrize.sort((a, b) => b.v - a.v).slice(0, 20);
const topPrize = ranked.length ? ranked[0].v : 0;
const cashCount = W.filter(i => /\bcash\b|\$[\d,]/.test(`${i.title||''} ${i.prize_summary||''}`.toLowerCase())).length;
const newest = [...W].sort((a, b) => String(b.date_found||'').localeCompare(String(a.date_found||''))).slice(0, 12);

const rankRows = ranked.map(({ i, v }) => `<tr>
        <td><a href="${esc(i.link)}" target="_blank" rel="nofollow noopener">${esc(i.title)}</a></td>
        <td class="pay">$${v.toLocaleString()}</td>
        <td>${prizeType(i)}</td>
      </tr>`).join('\n      ');

const newRows = newest.map(i =>
  `<li><a href="${esc(i.link)}" target="_blank" rel="nofollow noopener">${esc(i.title)}</a></li>`).join('\n        ');

const updated = fmtDate(now);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Biggest Sweepstakes &amp; Giveaways You Can Enter Right Now (${now.getFullYear()}) | AllFreeAlerts</title>
  <meta name="description" content="A live ranking of the biggest active sweepstakes you can enter free right now — top prize $${topPrize.toLocaleString()}. ${W.length} legitimate giveaways tracked, every one free to enter, no purchase necessary. Updated ${updated}.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://allfreealerts.com/sweepstakes-tracker">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3295178838066537" crossorigin="anonymous"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Article","headline":"Biggest Sweepstakes & Giveaways You Can Enter Right Now","datePublished":"2026-04-10","dateModified":"${TODAY}","author":{"@type":"Person","name":"Hansel M."},"publisher":{"@type":"Organization","name":"AllFreeAlerts","url":"https://allfreealerts.com"},"description":"Live ranking of the biggest active sweepstakes prizes you can enter free."}
  </script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--teal:#0ABAB5;--teal-dark:#089E9A;--orange:#FF6F3C;--gold:#F5A623;--gold-dark:#D97706;--green:#10B981;--bg:#F5F7FA;--white:#fff;--text:#1A1D21;--text-mid:#636E72;--border:#E5E7EB;--radius:16px;--shadow:0 1px 3px rgba(0,0,0,.06)}
    body{font-family:'Inter',-apple-system,system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;-webkit-font-smoothing:antialiased}
    a{color:var(--teal);text-decoration:none}a:hover{text-decoration:underline}
    .nav{background:var(--white);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
    .nav-inner{max-width:1100px;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;height:60px;gap:1rem}
    .nav-logo{font-size:1.35rem;font-weight:900;color:var(--teal);letter-spacing:-.03em}.nav-logo span{color:var(--text)}
    .nav-back{margin-left:auto;font-size:.88rem;font-weight:600;color:var(--text-mid)}
    .hero{background:linear-gradient(180deg,#FFF8EB 0%,var(--bg) 100%);padding:2.5rem 1.5rem 1.5rem;text-align:center}
    .hero h1{font-size:2rem;font-weight:800;letter-spacing:-.03em;line-height:1.25;max-width:760px;margin:0 auto}
    .hero h1 b{color:var(--gold-dark)}
    .hero p{margin-top:.6rem;color:var(--text-mid);max-width:620px;margin-left:auto;margin-right:auto}
    .updated{display:inline-block;margin-top:.8rem;font-size:.78rem;font-weight:600;color:var(--text-mid);background:var(--white);border:1px solid var(--border);padding:.3rem .8rem;border-radius:100px}
    .wrap{max-width:900px;margin:0 auto;padding:1.5rem}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin:1.5rem 0}
    .stat{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem 1rem;text-align:center;box-shadow:var(--shadow)}
    .stat .num{font-size:1.8rem;font-weight:800;color:var(--gold-dark);letter-spacing:-.02em}
    .stat .lbl{font-size:.78rem;color:var(--text-mid);font-weight:600;margin-top:.2rem}
    .card{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:2rem;margin:1.5rem 0;box-shadow:var(--shadow)}
    .card h2{font-size:1.35rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.75rem}
    .card h3{font-size:1.05rem;font-weight:700;margin:1.25rem 0 .4rem}
    .card p{color:var(--text-mid);margin-bottom:.8rem}
    table{width:100%;border-collapse:collapse;font-size:.88rem;margin-top:.5rem}
    th,td{text-align:left;padding:.6rem .5rem;border-bottom:1px solid var(--border);vertical-align:top}
    th{font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-mid);font-weight:700}
    td.pay{font-weight:700;color:var(--gold-dark);white-space:nowrap}
    ul.np{list-style:none;margin-top:.5rem}ul.np li{padding:.4rem 0;border-bottom:1px solid var(--border)}
    .byline{font-size:.85rem;color:var(--text-mid);margin-bottom:1rem}
    .cta{background:#FFF8EB;border:1px solid #F5D78E;border-radius:var(--radius);padding:1.5rem;text-align:center;margin:1.5rem 0}
    .cta a{font-weight:700}
    .footer{background:var(--white);border-top:1px solid var(--border);text-align:center;padding:2rem 1.5rem;color:var(--text-mid);font-size:.8rem;margin-top:2rem}
    @media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}.hero h1{font-size:1.5rem}}
  </style>
</head>
<body>
  <nav class="nav"><div class="nav-inner">
    <a class="nav-logo" href="/">All<span>Free</span>Alerts</a>
    <a class="nav-back" href="/sweepstakes">Browse all sweepstakes →</a>
  </div></nav>

  <section class="hero">
    <h1>The <b>Biggest Sweepstakes</b> You Can Enter Free Right Now</h1>
    <p>A live ranking of the largest active giveaway prizes we track — every one free to enter, no purchase ever necessary.</p>
    <div class="updated">Last updated ${updated} · ${W.length} active sweepstakes tracked</div>
  </section>

  <div class="wrap">
    <div class="stats">
      <div class="stat"><div class="num">${W.length}</div><div class="lbl">Active sweepstakes</div></div>
      <div class="stat"><div class="num">$${topPrize.toLocaleString()}</div><div class="lbl">Biggest prize</div></div>
      <div class="stat"><div class="num">${cashCount}</div><div class="lbl">With cash prizes</div></div>
      <div class="stat"><div class="num">100%</div><div class="lbl">Free to enter</div></div>
    </div>

    <div class="card">
      <p class="byline">By <a href="/about">Hansel M.</a>, Founder · Updated ${updated}</p>
      <h2>Every sweepstakes here is free to enter — here are the biggest prizes on the board.</h2>
      <p>A sweepstakes is a giveaway where winners are picked at random, and U.S. law is clear on one point: a legitimate sweepstakes can never require a purchase or payment to enter. That means every one of the <strong>${W.length} active sweepstakes</strong> we track is genuinely free — if something asks for a "processing fee" or a credit card, it isn't a real sweepstakes, it's a scam. We verify each entry link and strip out middlemen so the link below goes straight to the official entry page.</p>
      <p>The ranking below pulls the largest prizes from every giveaway where the sponsor publicly states a prize value — currently topping out at <strong>$${topPrize.toLocaleString()}</strong>. A quick reality check on odds: the giant national sweepstakes draw the most entries, so your realistic best strategy is to enter many smaller ones consistently and to look for daily-entry promotions where you get a fresh chance every day. Either way it costs nothing but a few minutes.</p>
      <h3>How to read this ranking</h3>
      <p>Prizes are ranked by the highest dollar amount the sponsor advertises. Where a giveaway's prize is a product, trip, or vehicle without a stated cash value, it won't appear in this dollar ranking even though it may be well worth entering — <a href="/sweepstakes">browse the full sweepstakes list</a> to see all ${W.length}. Always read each sweepstakes' official rules for eligibility, entry limits, and the drawing date before you enter.</p>
    </div>

    <div class="card">
      <h2>Biggest sweepstakes prizes open right now</h2>
      <p>Ranked by the highest advertised prize value among sweepstakes that publicly state one. Each links to the official entry page.</p>
      <table>
        <thead><tr><th>Sweepstakes</th><th>Top prize</th><th>Type</th></tr></thead>
        <tbody>
      ${rankRows}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Recently added sweepstakes</h2>
      <p>The newest giveaways we've verified and added — <a href="/sweepstakes">see all ${W.length} on the full sweepstakes page</a>.</p>
      <ul class="np">
        ${newRows}
      </ul>
    </div>

    <div class="cta">
      <p>Want the biggest new sweepstakes in your inbox every morning?</p>
      <a href="/#subscribe">Get free daily sweepstakes alerts →</a>
    </div>

    <div class="card">
      <h3>Related reading</h3>
      <p>
        <a href="/blog/how-to-spot-fake-sweepstakes">How to spot fake sweepstakes: 8 red flags</a> ·
        <a href="/blog/how-to-enter-sweepstakes-safely">How to enter sweepstakes safely</a>
      </p>
      <p style="font-size:.8rem;margin-top:.5rem">AllFreeAlerts is an independent aggregator. Prize values shown are the maximum amounts advertised by each sponsor and are not guaranteed; actual odds depend on the number of entries. No purchase is necessary to enter any sweepstakes — and never pay to claim a prize.</p>
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
console.log(`[sweepstakes-tracker] ${W.length} sweeps | ${withPrize.length} with stated prize value | top $${topPrize.toLocaleString()} | ${cashCount} cash | ${newest.length} newest`);
console.log(`  Wrote ${OUT}`);
