# Session Notes - March 15, 2026

## What Was Done

### New Sources Added (4)
1. **Sweeties Sweeps** - WP REST API (`/wp-json/wp/v2/posts?per_page=50`) - direct entry links in article content
2. **Sweepstakes Advantage** - HTML scrape of 4 category pages (daily, one-entry, instant-win, cash) - direct entry links with `target="_blank" rel="nofollow"`
3. **Top Class Actions** - RSS feed (`/feed/`) - settlement articles filtered by title keywords
4. **FTC Refunds** - HTML scrape of `ftc.gov/enforcement/refunds` - 90 government refund case pages

### Existing Sources (6)
1. **Contestgirl** - Reworked to parse HTML from HTTP Request node (not Code node fetch). HTTP Request node also gets blocked (403 Cloudflare). Needs Apify or proxy.
2. **Sweepstakes Fanatics** - RSS feed, article follow blocked by Cloudflare (middleman links)
3. **Freebie Shark** - HTML scrape + article follow for direct links (working)
4. **FreeFlys** - Cloudflare blocks everything (dead source)
5. **Hip2Save** - RSS + article follow with `entry-content` div extraction + Hip2Save-specific domain filters (gmpg.org, attn.tv, shophermedia.net, magik.ly)
6. **ClassAction.org** - HTML scrape with deadline/payout/proof/description extraction (working great)

### Results
- **540 items** scraped in test run (up from 393)
- One source returned 500 error but code handled it gracefully
- Need to clear Google Sheet and rerun full pipeline tomorrow

### Issues to Debug Tomorrow
- Full pipeline run (Schedule Trigger → Get Existing → Merge → Scrape → Sheet + Telegram)
- User mentioned "issues" — need to check what failed
- Contestgirl still blocked from n8n cloud (HTTP Request node also gets 403)
- Sweepstakes Fanatics still middleman links (CF blocks article pages)

### Domain Name
- **FreeClaimSpot.com** — chosen domain name
- Available (DNS: non-existent domain, Google: zero results)
- `claimspot.com` exists but is insurance claims — different enough

### Workflow Architecture
```
Schedule Trigger → Get Existing Entries → Merge Sheet + CG → Scrape and Deduplicate → Build Summary → Send Telegram
                                                                                     → Add New To Sheet
Schedule Trigger → CG Feed URLs → Fetch Contestgirl (HTTP Request) → Merge Sheet + CG
```

### Key Files
- `paste_into_n8n.js` — SOURCE OF TRUTH for Code node (440 lines, 17175 chars)
- `sweepstakes finder.json` — Full n8n workflow JSON (version: 11-new-sources-v9)
- `escaped_code.txt` — JSON-escaped version for workflow embedding
- `test_new_sources.js` — Test script for all new sources
- `test_sweeties_sweeps.js` — Sweeties Sweeps RSS/API test
- `test_sweeps_advantage.js` — Sweepstakes Advantage detail page test
- `test_http_node.json` — n8n diagnostic workflow for HTTP Request node testing
- `debug_contestgirl.js` — Contestgirl diagnostic for n8n

### Research Findings
- **Reddit** (r/freebies, r/sweepstakes) — blocks all automated requests (403 on RSS and JSON API). n8n RSS Feed Trigger node might work differently — worth testing.
- **Brand sites** (P&G, Coca-Cola, PepsiCo, etc.) — all dead ends. Heavy JS, fragmented, no central listings.
- **Contest platforms** (Gleam.io, Woobox, Rafflecopter) — creation tools only, no public directories.
- **Prizes.org** — not sweepstakes, it's a challenge/innovation platform.
- **Online-Sweepstakes.com** — accessible but no direct entry links found in initial test.
- **I Love Giveaways** — returned 202 with empty body.
- **Hunt4Freebies, The Freebie Guy, SweepstakesBible** — discovered via Reddit research, not yet tested.

### Google Sheet Structure
- Doc ID: `1_CByYYq2-dfd8JC1X4D9ww8wdv-QQzOkqeDvz9wYm-A`
- Sheet: "entries"
- Columns: title, link, date_found, source, Type, End date, price summary, elegibility, deadline, payout, proof_required, description

### Telegram
- Chat ID: `674396484`

### Apify
- Free tier: $5/month compute (~1000-2000 page fetches)
- Could bypass Cloudflare for Contestgirl, SF article pages, Hip2Save articles
- Not yet implemented

### Next Steps
1. Debug full pipeline issues
2. Clear sheet and do fresh run
3. Consider Apify for Cloudflare-blocked sources
4. Test n8n RSS Feed Trigger node for Reddit
5. Test Hunt4Freebies, The Freebie Guy, SweepstakesBible as additional sources
6. Register FreeClaimSpot.com domain
7. Start planning the website/frontend
