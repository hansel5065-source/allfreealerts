/**
 * Generate branded post image for AllFreeAlerts
 * Called by n8n workflow: node generate_post_image.js <json_data>
 * Outputs the PNG file path to stdout
 */

const fs = require('fs');
const path = require('path');

const COLORS = {
  teal: '#0ABAB5',
  orange: '#FF6F3C',
  gold: '#F5A623',
  dark: '#0e1628',
  red: '#ff3333'
};

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateImageHTML(item, category) {
  const title = (item.title || '').slice(0, 80);
  const summary = (item.prize_summary || '').slice(0, 100);

  if (category === 'Sweepstakes') {
    return `<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
      .card{width:1080px;height:1080px;background:linear-gradient(135deg,${COLORS.teal} 0%,#087f7b 50%,#065a57 100%);
        display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif}
      .card::before{content:'';position:absolute;top:-100px;right:-100px;width:400px;height:400px;border-radius:50%;background:rgba(255,111,60,0.15)}
      .emoji{font-size:80px;margin-bottom:30px;z-index:1}
      .badge{background:${COLORS.orange};color:white;padding:10px 30px;border-radius:50px;font-size:24px;font-weight:800;
        letter-spacing:2px;margin-bottom:30px;z-index:1}
      .title{font-size:48px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px;
        text-shadow:0 2px 10px rgba(0,0,0,0.2)}
      .sub{font-size:28px;color:rgba(255,255,255,0.85);text-align:center;z-index:1;line-height:1.4}
      .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
        background:rgba(0,0,0,0.3);padding:12px 30px;border-radius:50px;z-index:1}
      .brand span{color:${COLORS.orange}}
    </style></head><body><div class="card">
      <div class="emoji">🎉</div>
      <div class="badge">SWEEPSTAKES ALERT</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">${summary ? escapeHtml(summary) : 'Enter now for a chance to win!'}</div>
      <div class="brand">All<span>Free</span>Alerts.com</div>
    </div></body></html>`;
  }

  if (category === 'Freebies') {
    return `<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
      .card{width:1080px;height:1080px;background:linear-gradient(135deg,${COLORS.orange} 0%,#e85525 50%,#c44218 100%);
        display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif}
      .card::before{content:'';position:absolute;top:-80px;left:-80px;width:350px;height:350px;border-radius:50%;background:rgba(10,186,181,0.15)}
      .emoji{font-size:80px;margin-bottom:30px;z-index:1}
      .badge{background:white;color:${COLORS.orange};padding:10px 30px;border-radius:50px;font-size:24px;font-weight:800;
        letter-spacing:2px;margin-bottom:30px;z-index:1}
      .title{font-size:46px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px}
      .sub{font-size:28px;color:rgba(255,255,255,0.9);text-align:center;z-index:1}
      .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
        background:rgba(0,0,0,0.3);padding:12px 30px;border-radius:50px;z-index:1}
      .brand span{color:${COLORS.teal}}
    </style></head><body><div class="card">
      <div class="emoji">🎁</div>
      <div class="badge">FREE STUFF ALERT</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">No purchase necessary. No credit card.</div>
      <div class="brand">All<span>Free</span>Alerts.com</div>
    </div></body></html>`;
  }

  if (category === 'Settlements') {
    return `<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
      .card{width:1080px;height:1080px;background:linear-gradient(135deg,${COLORS.gold} 0%,#e8950f 50%,#c47e0a 100%);
        display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
        font-family:'Segoe UI',Arial,sans-serif}
      .card::before{content:'';position:absolute;top:-100px;right:-100px;width:400px;height:400px;border-radius:50%;background:rgba(255,255,255,0.1)}
      .badge{background:${COLORS.red};color:white;padding:10px 30px;border-radius:50px;font-size:24px;font-weight:800;
        letter-spacing:2px;margin-bottom:30px;z-index:1}
      .emoji{font-size:80px;margin-bottom:20px;z-index:1}
      .title{font-size:44px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px}
      .sub{font-size:28px;color:rgba(255,255,255,0.9);text-align:center;z-index:1;line-height:1.4}
      .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
        background:rgba(0,0,0,0.3);padding:12px 30px;border-radius:50px;z-index:1}
      .brand span{color:${COLORS.teal}}
    </style></head><body><div class="card">
      <div class="badge">⚠️ SETTLEMENT ALERT</div>
      <div class="emoji">💰</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">${summary ? escapeHtml(summary) : 'You may be owed money. Check if you qualify.'}</div>
      <div class="brand">All<span>Free</span>Alerts.com</div>
    </div></body></html>`;
  }

  // General fallback
  return `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1080px;height:1080px;display:flex;justify-content:center;align-items:center;background:${COLORS.dark}}
    .card{width:1080px;height:1080px;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);
      display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;position:relative;overflow:hidden;
      font-family:'Segoe UI',Arial,sans-serif}
    .title{font-size:48px;font-weight:800;color:white;text-align:center;line-height:1.3;z-index:1;margin-bottom:20px}
    .sub{font-size:28px;color:rgba(255,255,255,0.7);text-align:center;z-index:1}
    .brand{position:absolute;bottom:50px;font-size:28px;font-weight:700;color:white;
      background:rgba(10,186,181,0.3);padding:12px 30px;border-radius:50px;z-index:1}
    .brand span{color:${COLORS.orange}}
  </style></head><body><div class="card">
    <div class="title">${escapeHtml(title)}</div>
    <div class="sub">Updated daily. Completely free.</div>
    <div class="brand">All<span>Free</span>Alerts.com</div>
  </div></body></html>`;
}

async function main() {
  // Read JSON input from command line arg (can be JSON string or file path)
  const arg = process.argv[2];
  let input;
  if (arg.endsWith('.json') && fs.existsSync(arg)) {
    input = JSON.parse(fs.readFileSync(arg, 'utf8'));
  } else {
    input = JSON.parse(arg);
  }
  const items = Array.isArray(input) ? input : [input];

  const tmpDir = path.join(__dirname, 'tmp_images');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const html = generateImageHTML(item, item.category);
    const htmlPath = path.join(tmpDir, `post_${i}.html`);
    const pngPath = path.join(tmpDir, `post_${i}.png`);

    fs.writeFileSync(htmlPath, html);

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
    await page.screenshot({ path: pngPath, type: 'png' });
    await page.close();

    results.push({ ...item, imagePath: pngPath });
  }

  await browser.close();

  // Output results as JSON
  console.log(JSON.stringify(results));
}

main().catch(e => {
  console.error('Image generation failed:', e.message);
  process.exit(1);
});
