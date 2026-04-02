/**
 * YouTube OAuth2 Authorization — One-time setup
 *
 * Usage:
 *   1. Set environment variables: YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET
 *   2. Run: node youtube_auth.js
 *   3. Open the URL in your browser
 *   4. Authorize with your Google account
 *   5. Copy the refresh token and add it as YOUTUBE_REFRESH_TOKEN GitHub secret
 */

const http = require('http');
const https = require('https');
const url = require('url');

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CLIENT_ID or CLIENT_SECRET');
  process.exit(1);
}

// Build authorization URL
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n=== YouTube OAuth2 Setup ===\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback...\n');

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/oauth2callback' && parsed.query.code) {
    const code = parsed.query.code;
    console.log('Authorization code received. Exchanging for tokens...\n');

    // Exchange code for tokens
    const body = new URLSearchParams({
      code: code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    }).toString();

    const tokenReq = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (tokenRes) => {
      let data = '';
      tokenRes.on('data', chunk => data += chunk);
      tokenRes.on('end', () => {
        try {
          const tokens = JSON.parse(data);
          if (tokens.refresh_token) {
            console.log('=== SUCCESS ===\n');
            console.log('Refresh Token (add as YOUTUBE_REFRESH_TOKEN GitHub secret):');
            console.log(tokens.refresh_token);
            console.log('\nAccess Token (temporary, not needed as a secret):');
            console.log(tokens.access_token?.substring(0, 30) + '...');
            console.log('\nDone! Add the refresh token as a GitHub secret, then delete this script.');
          } else {
            console.error('No refresh token received:', data);
          }
        } catch (e) {
          console.error('Token exchange error:', data);
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization complete!</h1><p>You can close this tab and go back to the terminal.</p>');

        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1000);
      });
    });

    tokenReq.on('error', e => console.error('Token request error:', e.message));
    tokenReq.write(body);
    tokenReq.end();
  } else {
    res.writeHead(200);
    res.end('Waiting for OAuth callback...');
  }
});

server.listen(3000, () => {
  console.log('Local server running on http://localhost:3000');
});
