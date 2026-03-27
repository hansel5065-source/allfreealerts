// PASTE INTO A NEW CODE NODE (Run Once for All Items) - DIAGNOSTIC ONLY
// This tests what n8n sees when it tries to fetch Contestgirl
const self = this;

const results = [];

// Test 1: Can we reach contestgirl at all?
try {
  const html = await self.helpers.httpRequest({
    method: 'GET',
    url: 'https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=s&s=_&sort=p',
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    returnFullResponse: false,
    timeout: 15000,
  });

  const htmlType = typeof html;
  const htmlLength = html ? html.length : 0;
  const hasCloudflare = html && html.includes("Just a moment");
  const has500 = html && html.includes("500 Server Error");
  const hasPadded = html && html.includes('class="padded"');
  const hasCountHits = html && html.includes('countHits.pl');
  const first500 = html ? html.substring(0, 500) : 'NULL';

  results.push({ json: {
    test: "FETCH_RESULT",
    type: htmlType,
    length: htmlLength,
    cloudflare_blocked: hasCloudflare,
    server_error: has500,
    has_padded_class: hasPadded,
    has_countHits: hasCountHits,
    first_500_chars: first500,
  }});
} catch (e) {
  results.push({ json: {
    test: "FETCH_ERROR",
    error: e.message,
    code: e.code || '',
    status: e.statusCode || '',
  }});
}

// Test 2: What does returnFullResponse give us?
try {
  const resp = await self.helpers.httpRequest({
    method: 'GET',
    url: 'https://www.contestgirl.com/contests/contests.pl?ar=na&b=nb&c=us&f=s&s=_&sort=p',
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    returnFullResponse: true,
    timeout: 15000,
  });

  results.push({ json: {
    test: "FULL_RESPONSE",
    statusCode: resp.statusCode,
    headers_type: typeof resp.headers,
    content_type: resp.headers ? (resp.headers['content-type'] || '') : '',
    body_type: typeof resp.body,
    body_length: resp.body ? resp.body.length : 0,
  }});
} catch (e) {
  results.push({ json: {
    test: "FULL_RESPONSE_ERROR",
    error: e.message,
  }});
}

// Test 3: Try a simple known-good URL for comparison
try {
  const html = await self.helpers.httpRequest({
    method: 'GET',
    url: 'https://www.classaction.org/settlements',
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    returnFullResponse: false,
    timeout: 15000,
  });
  results.push({ json: {
    test: "CLASSACTION_COMPARISON",
    type: typeof html,
    length: html ? html.length : 0,
    has_settlement_card: html && html.includes('settlement-card'),
  }});
} catch (e) {
  results.push({ json: {
    test: "CLASSACTION_ERROR",
    error: e.message,
  }});
}

return results;
