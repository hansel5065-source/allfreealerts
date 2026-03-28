/**
 * AllFreeAlerts — Auto-Poster Logic (used by n8n workflow)
 *
 * Selection Priority:
 *   Sweepstakes/Freebies: NEW items first, then oldest recycled
 *   Settlements: No-proof-needed NEW → No-proof-needed recycled → Proof-needed NEW → Proof-needed recycled
 *
 * Usage: node n8n_autoposter_logic.js [--dry-run]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const HISTORY_PATH = path.join(__dirname, 'n8n_post_history.json');

// ── Fetch data ──
function fetchData() {
  return new Promise((resolve, reject) => {
    https.get('https://allfreealerts.com/data.json', (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
      res.on('error', reject);
    });
  });
}

// ── Load/save history ──
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch(e) { return []; }
}
function saveHistory(history) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

// ── Pick best item from a list (new first, then oldest posted) ──
function pickBest(candidates, postedTitles, history) {
  if (candidates.length === 0) return null;

  // Priority 1: Never posted
  const neverPosted = candidates.filter(i => !postedTitles.has(i.title));
  if (neverPosted.length > 0) {
    const pick = neverPosted[Math.floor(Math.random() * neverPosted.length)];
    pick._pickReason = 'NEW';
    return pick;
  }

  // Priority 2: Oldest posted
  const withDates = candidates.map(i => {
    const lastPost = history
      .filter(h => h.title === i.title)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return { item: i, lastPosted: lastPost ? new Date(lastPost.date) : new Date(0) };
  }).sort((a, b) => a.lastPosted - b.lastPosted);

  const pick = withDates[0].item;
  pick._pickReason = 'RECYCLED';
  return pick;
}

// ── Pick items with category-specific priority ──
function pickItems(items, history) {
  const postedTitles = new Set(history.map(h => h.title));
  const picks = [];

  // Sweepstakes: new first, then oldest
  const sweeps = items.filter(i => i.category === 'Sweepstakes');
  const sweepPick = pickBest(sweeps, postedTitles, history);
  if (sweepPick) picks.push(sweepPick);

  // Freebies: new first, then oldest
  const freebies = items.filter(i => i.category === 'Freebies');
  const freebiePick = pickBest(freebies, postedTitles, history);
  if (freebiePick) picks.push(freebiePick);

  // Settlements: NO PROOF first, then proof needed
  const settlements = items.filter(i => i.category === 'Settlements');
  const noProof = settlements.filter(i => i.proof_required === 'No' || i.proof_required === 'N/A');
  const proofNeeded = settlements.filter(i => i.proof_required === 'Yes');
  const unclear = settlements.filter(i => !i.proof_required || (i.proof_required !== 'No' && i.proof_required !== 'Yes' && i.proof_required !== 'N/A'));

  // Try no-proof first
  let settlePick = pickBest(noProof, postedTitles, history);
  if (settlePick) {
    settlePick._proofStatus = 'NO PROOF NEEDED';
  } else {
    // Then unclear
    settlePick = pickBest(unclear, postedTitles, history);
    if (settlePick) {
      settlePick._proofStatus = 'PROOF UNKNOWN';
    } else {
      // Last resort: proof needed
      settlePick = pickBest(proofNeeded, postedTitles, history);
      if (settlePick) settlePick._proofStatus = 'PROOF REQUIRED';
    }
  }
  if (settlePick) picks.push(settlePick);

  return picks;
}

// ── Instagram carousel caption ──
function buildCarouselCaption(posts) {
  let caption = "🔥 Today's FREE Finds — Swipe Through! 👉\n\n";

  for (const p of posts) {
    if (p.category === 'Sweepstakes') {
      caption += `🎉 SWEEPSTAKES: ${p.title}\n`;
      if (p.prize_summary) caption += `   ${p.prize_summary.slice(0, 80)}\n`;
      caption += '\n';
    } else if (p.category === 'Freebies') {
      caption += `🎁 FREE: ${p.title}\n`;
      caption += '   No purchase necessary!\n\n';
    } else if (p.category === 'Settlements') {
      caption += `💰 SETTLEMENT: ${p.title}\n`;
      if (p.payout) caption += `   Payout: ${p.payout}\n`;
      if (p.proofStatus === 'NO PROOF NEEDED') caption += '   ✅ No proof needed!\n';
      caption += '\n';
    }
  }

  caption += '👉 Link in bio — allfreealerts.com\n';
  caption += '📱 Follow @allfreealerts for daily finds!\n\n';
  caption += '#freestuff #sweepstakes #classaction #settlement #freebie #giveaway #freemoney #savemoney #freesample #allfreealerts';

  return caption;
}

// ── Tweet templates ──
const templates = {
  Sweepstakes: [
    (i) => `🎉 SWEEPSTAKES ALERT\n\n${i.title}\n\n${i.prize_summary ? i.prize_summary.slice(0,100)+'...' : 'Enter now for a chance to win!'}\n\n👉 allfreealerts.com\n\n#sweepstakes #giveaway #win #allfreealerts`,
    (i) => `Win something amazing today! 🏆\n\n${i.title}\n\nFind it on 👉 allfreealerts.com\n\n#entertowin #sweepstakes #contest #free`,
    (i) => `Don't miss this one 👀\n\n${i.title}\n\n${i.prize_summary ? i.prize_summary.slice(0,100) : 'Free to enter!'}\n\n👉 allfreealerts.com\n\n#giveaway #sweepstakes #win #allfreealerts`
  ],
  Freebies: [
    (i) => `🆓 FREE STUFF ALERT\n\n${i.title}\n\nNo purchase necessary. Get yours before it's gone!\n\n👉 allfreealerts.com\n\n#freestuff #freebie #freesample #allfreealerts`,
    (i) => `This is completely FREE 👇\n\n${i.title}\n\nNo credit card. No catch.\n\n👉 allfreealerts.com\n\n#free #freebie #freesample #freestuff`,
    (i) => `Today's freebie find 🎁\n\n${i.title}\n\nGrab it while supplies last 👉 allfreealerts.com\n\n#freebies #freestuff #savemoney #allfreealerts`
  ],
  Settlements: [
    (i) => `💰 CLASS ACTION ALERT\n\n${i.title}\n\n${i.payout ? '💵 Payout: ' + i.payout : 'You may be owed money!'}\n${i._proofStatus === 'NO PROOF NEEDED' ? '✅ No proof of purchase needed!\n' : ''}\nFile your claim 👉 allfreealerts.com\n\n#classaction #settlement #freemoney #allfreealerts`,
    (i) => `You might be owed money 💵\n\n${i.title}\n${i.payout ? '\n💰 ' + i.payout : ''}\n${i._proofStatus === 'NO PROOF NEEDED' ? '✅ No receipt needed!\n' : ''}\nCheck if you qualify 👉 allfreealerts.com\n\n#settlement #classaction #moneytok #allfreealerts`,
    (i) => `Don't leave money on the table!\n\n${i.title}\n${i.payout ? '\nPayout: ' + i.payout : ''}\n${i._proofStatus === 'NO PROOF NEEDED' ? '\n🙌 No proof needed — just file a claim!' : ''}\n\n👉 allfreealerts.com\n\n#classaction #freemoney #settlement`
  ]
};

// ── QA Check ──
function qaCheck(post) {
  const errors = [];
  if (post.tweetText.length > 280) errors.push(`Over 280 chars (${post.tweetText.length})`);
  if (!post.title || post.title.trim() === '') errors.push('Missing title');
  if (!post.tweetText.includes('allfreealerts.com')) errors.push('Missing link');
  if (!post.tweetText.includes('#')) errors.push('Missing hashtags');
  if (!['Sweepstakes', 'Freebies', 'Settlements'].includes(post.category)) errors.push('Bad category');
  if (post.tweetText.includes('undefined') || post.tweetText.includes('null')) errors.push('Broken text');
  return errors;
}

// ── Main ──
async function main() {
  console.log('========================================');
  console.log('  AllFreeAlerts Auto-Poster' + (DRY_RUN ? ' (DRY RUN)' : ''));
  console.log('========================================\n');

  // Step 1: Fetch data
  const items = await fetchData();
  console.log(`STEP 1: Fetched ${items.length} items from allfreealerts.com\n`);

  // Step 2: Pick items
  const history = loadHistory();
  const picks = pickItems(items, history);
  console.log('STEP 2: Picked items:');
  for (const p of picks) {
    const proof = p._proofStatus ? ` | ${p._proofStatus}` : '';
    console.log(`  [${p._pickReason}] ${p.category}: ${p.title}${proof}`);
  }

  // Step 3: Generate tweets
  console.log('\nSTEP 3: Generate tweets + QA:');
  const posts = [];
  for (const item of picks) {
    const catTemplates = templates[item.category] || templates.Freebies;
    const template = catTemplates[Math.floor(Math.random() * catTemplates.length)];
    let text = template(item);
    if (text.length > 280) text = text.slice(0, 277) + '...';
    const igCaption = text + '\n\n📱 Follow @allfreealerts for daily deals!';

    const post = {
      category: item.category,
      title: item.title,
      prize_summary: item.prize_summary || '',
      payout: item.payout || '',
      tweetText: text,
      igCaption,
      link: item.link || 'https://allfreealerts.com',
      pickReason: item._pickReason,
      proofStatus: item._proofStatus || ''
    };

    const qaErrors = qaCheck(post);
    const qaStatus = qaErrors.length === 0 ? '✅ PASSED' : '❌ FAILED: ' + qaErrors.join(', ');
    console.log(`  ${item.category}: ${qaStatus} (${text.length} chars)`);

    if (qaErrors.length === 0) posts.push(post);
  }

  // Step 4: Generate images
  console.log('\nSTEP 4: Generate images:');
  try {
    const { execSync } = require('child_process');
    const scriptPath = path.join(__dirname, 'generate_post_image.js');
    const tmpInput = path.join(__dirname, 'tmp_images', 'input.json');
    fs.writeFileSync(tmpInput, JSON.stringify(posts));
    const output = execSync(`node "${scriptPath}" "${tmpInput}"`, { timeout: 30000, encoding: 'utf8' });
    const imgResults = JSON.parse(output.trim());
    for (const r of imgResults) {
      console.log(`  🖼️  ${r.category}: ${path.basename(r.imagePath)}`);
    }
  } catch(e) {
    console.log(`  ⚠️ Image generation failed: ${e.message.split('\n')[0]}`);
  }

  // Step 5: Build Instagram carousel caption
  const igCarouselCaption = buildCarouselCaption(posts);
  console.log('\nSTEP 5: Instagram Carousel Caption:');
  console.log('---');
  console.log(igCarouselCaption);
  console.log(`--- (${igCarouselCaption.length} chars)`);

  // Step 6: Show X/Twitter posts
  console.log('\nSTEP 6: X/Twitter Posts' + (DRY_RUN ? ' (DRY RUN — not posting):' : ':'));
  for (const p of posts) {
    console.log(`\n--- ${p.category.toUpperCase()} [${p.pickReason}] ${p.proofStatus ? '| ' + p.proofStatus : ''} ---`);
    console.log(p.tweetText);
    console.log(`(${p.tweetText.length} chars)`);
  }

  // Save to history
  if (!DRY_RUN) {
    const now = new Date().toISOString().split('T')[0];
    for (const p of posts) {
      history.push({ title: p.title, category: p.category, date: now });
    }
    saveHistory(history);
    console.log('\n✅ Saved to post history');
  }

  console.log('\n========================================');
  console.log(`  COMPLETE — ${posts.length} posts ready`);
  console.log(`  X/Twitter: ${posts.length} individual tweets`);
  console.log(`  Instagram: 1 carousel with ${posts.length} slides`);
  console.log('========================================');

  // Output JSON for n8n
  if (!DRY_RUN) {
    const output = {
      tweets: posts,
      instagram: {
        type: 'carousel',
        caption: igCarouselCaption,
        images: posts.map((p, i) => path.join(__dirname, 'tmp_images', `post_${i}.png`)),
        slideCount: posts.length
      }
    };
    console.log('\n__JSON_OUTPUT__');
    console.log(JSON.stringify(output));
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
