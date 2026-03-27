const https = require('https');
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  // === SWEEPSTAKES FANATICS ===
  const sf = await fetch('https://sweepstakesfanatics.com/feed/');
  const sfItems = sf.match(/<item>([\s\S]*?)<\/item>/g) || [];
  console.log('=== SWEEPSTAKES FANATICS ===');
  console.log('Items:', sfItems.length);

  if (sfItems[0]) {
    const item = sfItems[0];
    const title = (item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const content = (item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || 'NONE';
    const desc = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || 'NONE';
    console.log('Title:', title);
    console.log('Content length:', content.length);
    console.log('Content:', content.substring(0, 800));
    console.log('\nDescription length:', desc.length);
    console.log('Description:', desc.substring(0, 800));

    // Find URLs in both
    const allText = content + ' ' + desc;
    const links = [];
    const re = /href="(https?:\/\/[^"]+)"/g;
    let m;
    while ((m = re.exec(allText)) !== null) {
      if (!m[1].includes('sweepstakesfanatics.com')) {
        links.push(m[1]);
      }
    }
    console.log('\nExternal URLs found:', links);
  }

  // === HIP2SAVE ===
  console.log('\n\n=== HIP2SAVE ===');
  const h2s = await fetch('https://hip2save.com/freebies/feed/');
  const h2sItems = h2s.match(/<item>([\s\S]*?)<\/item>/g) || [];
  console.log('Items:', h2sItems.length);

  for (let i = 0; i < Math.min(3, h2sItems.length); i++) {
    const item = h2sItems[i];
    const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const content = (item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || 'NONE';
    const desc = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || 'NONE';
    console.log(`\n--- Item ${i+1}: ${title} ---`);
    console.log('Content length:', content.length);
    console.log('Description length:', desc.length);

    if (content !== 'NONE') {
      console.log('Content preview:', content.substring(0, 500));
    }
    if (desc !== 'NONE') {
      console.log('Description preview:', desc.substring(0, 500));
    }

    const allText = (content !== 'NONE' ? content : '') + ' ' + (desc !== 'NONE' ? desc : '');
    const links = [];
    const re = /href="(https?:\/\/[^"]+)"/g;
    let m;
    while ((m = re.exec(allText)) !== null) {
      const url = m[1].toLowerCase();
      if (!url.includes('hip2save.com') && !url.includes('facebook.com') &&
          !url.includes('twitter.com') && !url.includes('pinterest.com') &&
          !url.includes('instagram.com') && !url.includes('google.com') &&
          !url.includes('wp-content') && !url.includes('gravatar.com') &&
          !url.includes('.png') && !url.includes('.jpg') &&
          !url.includes('gmpg.org') && !url.includes('attn.tv') &&
          !url.includes('shophermedia') && !url.includes('magik.ly')) {
        links.push(m[1]);
      }
    }
    console.log('External deal URLs:', links.slice(0, 5));
  }
})();
