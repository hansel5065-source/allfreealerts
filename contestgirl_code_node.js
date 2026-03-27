// Contestgirl Scraper - n8n Code Node (Run Once for All Items mode)
// Paste this into an n8n Code node connected after Schedule Trigger

const feeds = [
  { source: "contestgirl_single", category: "Sweepstakes", url: "https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=s&s=_&sort=p" },
  { source: "contestgirl_daily", category: "Sweepstakes", url: "https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=d&s=_&sort=p" },
  { source: "contestgirl_weekly", category: "Sweepstakes", url: "https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=w&s=_&sort=p" },
  { source: "contestgirl_odd", category: "Sweepstakes", url: "https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=o&s=_&sort=p" },
  { source: "contestgirl_blog", category: "Sweepstakes", url: "https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=g&s=_&sort=p" },
  { source: "contestgirl_freesamples", category: "Freebies", url: "https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=f&s=_&sort=p" },
];

const results = [];

for (const feed of feeds) {
  try {
    const response = await fetch(feed.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) continue;
    const html = await response.text();
    if (html.includes("500 Server Error") || html.includes("Just a moment")) continue;

    // Each listing is in a <td class="padded"> cell
    const listingRegex = /<td class="padded"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
    let match;

    while ((match = listingRegex.exec(html)) !== null) {
      const block = match[1];

      // Title: text inside the second <a> tag within <b> (the visible one, not the comment)
      const titleMatch = block.match(/<b>.*?<a[^>]*href="\/sweepstakes\/countHits\.pl\?[^"]*"[^>]*>([^<]+)<\/a><\/b>/);
      if (!titleMatch) continue;
      const title = titleMatch[1].replace(/--/g, " - ").trim();

      // Entry link (the countHits redirect URL contains the real destination)
      const linkMatch = block.match(/href="(\/sweepstakes\/countHits\.pl\?[^"]*)"/);
      const link = linkMatch ? "https://www.contestgirl.com" + linkMatch[1] : "";

      // Detail page link
      const detailMatch = block.match(/href="(\/contests\/sweepstakesDetail\.pl\?index=\d+)"/);
      const detail_url = detailMatch ? "https://www.contestgirl.com" + detailMatch[1] : "";

      // End date
      const endDateMatch = block.match(/<b>End Date:<\/b>\s*([^<]+)/);
      const end_date = endDateMatch ? endDateMatch[1].trim() : "";

      // Prize description
      const prizeMatch = block.match(/<div style="margin-top:6px;margin-bottom:4px;font-size:15px;">([^<]+)<\/div>/);
      const prize_summary = prizeMatch ? prizeMatch[1].trim() : "";

      // Restrictions / eligibility
      const restrictMatch = block.match(/<b>Restrictions:&nbsp;<\/b><\/td><td[^>]*>\s*([^<]+)/);
      const eligibility = restrictMatch ? restrictMatch[1].trim() : "";

      // Posted date
      const postedMatch = block.match(/posted on ([^<]+)/);
      const posted_date = postedMatch ? postedMatch[1].trim() : "";

      results.push({
        json: {
          title,
          link,
          detail_url,
          source: feed.source,
          category: feed.category,
          end_date,
          prize_summary,
          eligibility,
          posted_date,
        },
      });
    }
  } catch (e) {
    // Skip failed feeds silently
  }
}

return results;
