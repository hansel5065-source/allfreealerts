const https = require('https');
const fs = require('fs');

const req = https.get('https://www.classaction.org/settlements', {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html",
  }
}, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    fs.writeFileSync('C:\\Projects\\n8n _free for all\\classaction_raw.html', d);
    console.log(`Saved ${d.length} bytes`);

    // Print a sample settlement card for analysis
    // Look for settlement-card divs
    const cards = d.match(/<div[^>]*settlement-card[^>]*>[\s\S]*?<\/article>/g) ||
                  d.match(/<article[^>]*settlement-card[^>]*>[\s\S]*?<\/article>/g) ||
                  [];
    console.log(`Found ${cards.length} card-like blocks`);

    // Try another pattern
    const deadlineBlocks = d.match(/deadline="(\d+)"/g) || [];
    console.log(`Found ${deadlineBlocks.length} deadline attributes`);

    // Find the first card with surrounding context
    const firstDeadline = d.indexOf('deadline="');
    if (firstDeadline > -1) {
      // Print 3000 chars starting from 200 chars before first deadline
      const start = Math.max(0, firstDeadline - 200);
      const sample = d.substring(start, start + 3000);
      console.log('\n=== SAMPLE CARD HTML ===\n');
      console.log(sample);
    }

    // Also look for "Visit Official" links
    const officialLinks = d.match(/<a[^>]*>[^<]*Visit Official[^<]*<\/a>/g) || [];
    console.log(`\nFound ${officialLinks.length} "Visit Official" links`);
    if (officialLinks.length > 0) {
      console.log('Sample:', officialLinks[0]);
    }

    // Look for proof required
    const proofMatches = d.match(/proof[^<]{0,50}/gi) || [];
    console.log(`\nProof mentions: ${proofMatches.length}`);
    if (proofMatches.length > 0) {
      proofMatches.slice(0, 3).forEach(m => console.log('  ', m));
    }
  });
});
req.on('error', e => console.error(e));
