const fs = require('fs');

// Read the escaped code
const escapedCode = fs.readFileSync('C:/Projects/n8n _free for all/escaped_code.txt', 'utf8').trim();
const jsCode = JSON.parse(escapedCode);

// Read existing workflow
const wf = JSON.parse(fs.readFileSync('C:/Projects/n8n _free for all/sweepstakes finder.json', 'utf8'));

// Update Scrape and Deduplicate node jsCode
const scrapeNode = wf.nodes.find(n => n.name === 'Scrape and Deduplicate');
scrapeNode.parameters.jsCode = jsCode;

// Update Build Summary with settlement details
const summaryNode = wf.nodes.find(n => n.name === 'Build Summary');
summaryNode.parameters.jsCode = `// Build a single Telegram summary message from all new items
const items = $input.all();
if (items.length === 0) return [{ json: { message: 'Free-for-All: No new entries found today.' } }];

// Count by category
const counts = {};
for (const item of items) {
  const cat = item.json.category || 'Other';
  counts[cat] = (counts[cat] || 0) + 1;
}

// Build summary lines
const lines = [
  \`\\ud83c\\udf81 Free-for-All: \${items.length} new entries found!\`,
  '',
];

for (const [cat, count] of Object.entries(counts)) {
  const emoji = cat === 'Sweepstakes' ? '\\ud83c\\udfb0' : cat === 'Settlements' ? '\\u2696\\ufe0f' : '\\ud83c\\udf81';
  lines.push(\`\${emoji} \${cat}: \${count}\`);
}

lines.push('');

// Show top settlements with details
const settlements = items.filter(i => i.json.source === 'classaction').slice(0, 5);
if (settlements.length > 0) {
  lines.push('\\u2696\\ufe0f Top Settlements:');
  for (const s of settlements) {
    const details = [];
    if (s.json.payout) details.push(s.json.payout);
    if (s.json.deadline) details.push('by ' + s.json.deadline);
    if (s.json.proof_required) details.push('Proof: ' + s.json.proof_required);
    lines.push(\`\\u2022 \${s.json.title}\`);
    if (details.length > 0) lines.push(\`  \${details.join(' | ')}\`);
  }
  lines.push('');
}

// Show top sweepstakes/freebies
const other = items.filter(i => i.json.source !== 'classaction').slice(0, 10);
if (other.length > 0) {
  lines.push('\\ud83c\\udfb0 Top Deals:');
  for (const item of other) {
    lines.push(\`\\u2022 \${item.json.title}\`);
  }
}

const remaining = items.length - settlements.length - other.length;
if (remaining > 0) {
  lines.push(\`... and \${remaining} more\`);
}

lines.push('');
lines.push('\\ud83d\\udcca Check the sheet for full details.');

return [{ json: { message: lines.join('\\n') } }];
`;

// Update Add New To Sheet - add settlement columns
const sheetNode = wf.nodes.find(n => n.name === 'Add New To Sheet');
sheetNode.parameters.columns.value = {
  'title': '={{$json.title}}',
  'link': '={{$json.link}}',
  'date_found': '={{$now}}',
  'source': '={{$json.source}}',
  'Type': '={{$json.category}}',
  'End date': '={{$json.end_date}}',
  'price summary': '={{$json.prize_summary}}',
  'elegibility': '={{$json.eligibility}}',
  'deadline': '={{$json.deadline}}',
  'payout': '={{$json.payout}}',
  'proof_required': '={{$json.proof_required}}',
  'description': '={{$json.description}}',
};

// Add new column schemas
const newCols = [
  { id: 'deadline', displayName: 'deadline', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'payout', displayName: 'payout', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'proof_required', displayName: 'proof_required', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'description', displayName: 'description', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
];
sheetNode.parameters.columns.schema.push(...newCols);

// Update version
wf.versionId = '8a5b6c7d-direct-links-settlements-v6';

fs.writeFileSync('C:/Projects/n8n _free for all/sweepstakes finder.json', JSON.stringify(wf, null, 2));
console.log('Workflow updated successfully');
console.log('Scrape node code length:', scrapeNode.parameters.jsCode.length);
console.log('Sheet columns:', Object.keys(sheetNode.parameters.columns.value).join(', '));
