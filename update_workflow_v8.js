const fs = require('fs');

const wf = JSON.parse(fs.readFileSync('C:/Projects/n8n _free for all/sweepstakes finder.json', 'utf8'));

// === 1. Add "CG Feed URLs" Code node ===
const cgUrlsNode = {
  parameters: {
    mode: "runOnceForAllItems",
    jsCode: `// Generate Contestgirl feed URLs
const feeds = [
  { f: 's', category: 'Sweepstakes' },
  { f: 'd', category: 'Sweepstakes' },
  { f: 'w', category: 'Sweepstakes' },
  { f: 'o', category: 'Sweepstakes' },
  { f: 'g', category: 'Sweepstakes' },
  { f: 'f', category: 'Freebies' },
];
return feeds.map(feed => ({
  json: {
    url: \`https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=\${feed.f}&s=_&sort=p\`,
    cgCategory: feed.category,
    _isCgHtml: true,
  }
}));`
  },
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [-1200, -160],
  id: "cg-feed-urls-node",
  name: "CG Feed URLs"
};

// === 2. Add "Fetch Contestgirl" HTTP Request node ===
const fetchCgNode = {
  parameters: {
    method: "GET",
    url: "={{ $json.url }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "User-Agent", value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
        { name: "Accept", value: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        { name: "Accept-Language", value: "en-US,en;q=0.9" },
      ]
    },
    options: {
      response: {
        response: {
          responseFormat: "text"
        }
      },
      timeout: 15000,
    }
  },
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [-960, -160],
  id: "fetch-cg-http-node",
  name: "Fetch Contestgirl",
  alwaysOutputData: true,
  onError: "continueRegularOutput",
  retryOnFail: false,
};

// === 3. Add "Merge" node ===
const mergeNode = {
  parameters: {
    mode: "append"
  },
  type: "n8n-nodes-base.merge",
  typeVersion: 3,
  position: [-680, -280],
  id: "merge-sheet-cg-node",
  name: "Merge Sheet + CG"
};

// === 4. Move Scrape and Deduplicate to the right ===
const scrapeNode = wf.nodes.find(n => n.name === 'Scrape and Deduplicate');
scrapeNode.position = [-420, -280];

// Move downstream nodes too
const buildSummary = wf.nodes.find(n => n.name === 'Build Summary');
buildSummary.position = [-140, -400];

const sendTelegram = wf.nodes.find(n => n.name === 'Send Telegram Alert');
sendTelegram.position = [120, -400];

const addSheet = wf.nodes.find(n => n.name === 'Add New To Sheet');
addSheet.position = [-140, -160];

// Add new nodes
wf.nodes.push(cgUrlsNode, fetchCgNode, mergeNode);

// === 5. Update connections ===
wf.connections = {
  "Schedule Trigger": {
    main: [[
      { node: "Get Existing Entries", type: "main", index: 0 },
      { node: "CG Feed URLs", type: "main", index: 0 },
    ]]
  },
  "Get Existing Entries": {
    main: [[
      { node: "Merge Sheet + CG", type: "main", index: 0 }
    ]]
  },
  "CG Feed URLs": {
    main: [[
      { node: "Fetch Contestgirl", type: "main", index: 0 }
    ]]
  },
  "Fetch Contestgirl": {
    main: [[
      { node: "Merge Sheet + CG", type: "main", index: 1 }
    ]]
  },
  "Merge Sheet + CG": {
    main: [[
      { node: "Scrape and Deduplicate", type: "main", index: 0 }
    ]]
  },
  "Scrape and Deduplicate": {
    main: [[
      { node: "Build Summary", type: "main", index: 0 },
      { node: "Add New To Sheet", type: "main", index: 0 },
    ]]
  },
  "Build Summary": {
    main: [[
      { node: "Send Telegram Alert", type: "main", index: 0 }
    ]]
  }
};

// === 6. Fix duplicate schema entries ===
const sheetNode = wf.nodes.find(n => n.name === 'Add New To Sheet');
const seen = new Set();
sheetNode.parameters.columns.schema = sheetNode.parameters.columns.schema.filter(col => {
  if (seen.has(col.id)) return false;
  seen.add(col.id);
  return true;
});

wf.versionId = '10a-cg-http-request-v8';

fs.writeFileSync('C:/Projects/n8n _free for all/sweepstakes finder.json', JSON.stringify(wf, null, 2));
console.log('Workflow updated with CG HTTP Request approach');
console.log('Nodes:', wf.nodes.map(n => n.name).join(', '));
console.log('Schema columns:', sheetNode.parameters.columns.schema.map(c => c.id).join(', '));
