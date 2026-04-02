/**
 * TikTok OAuth2 Authorization — One-time setup
 *
 * Usage:
 *   1. Run: node tiktok_auth.js
 *   2. Open the URL in your browser
 *   3. Authorize with your TikTok account
 *   4. Copy the refresh token and add it as TIKTOK_REFRESH_TOKEN GitHub secret
 */

const http = require('http');
const https = require('https');
const url = require('url');

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || 'YOUR_CLIENT_KEY';
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'https://allfreealerts.com/tiktok/callback/';
const SCOPES = 'user.info.basic,video.publish,video.upload';

// Build authorization URL
const authUrl = `https://www.tiktok.com/v2/auth/authorize/?` +
  `client_key=${CLIENT_KEY}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}`;

console.log('\n=== TikTok OAuth2 Setup ===\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback...\n');

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost:3000');

  if (parsed.pathname === '/tiktok/callback' && parsed.searchParams.get('code')) {
    const code = parsed.searchParams.get('code');
    console.log('Authorization code received. Exchanging for tokens...\n');

    // Exchange code for tokens
    const body = JSON.stringify({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI
    });

    const tokenReq = https.request({
      hostname: 'open.tiktokapis.com',
      path: '/v2/oauth/token/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (tokenRes) => {
      let data = '';
      tokenRes.on('data', chunk => data += chunk);
      tokenRes.on('end', () => {
        try {
          const tokens = JSON.parse(data);
          if (tokens.access_token || tokens.data?.access_token) {
            const t = tokens.data || tokens;
            console.log('=== SUCCESS ===\n');
            console.log('Access Token (temporary):');
            console.log(t.access_token?.substring(0, 30) + '...');
            console.log('\nRefresh Token (add as TIKTOK_REFRESH_TOKEN GitHub secret):');
            console.log(t.refresh_token);
            console.log('\nOpen ID (add as TIKTOK_OPEN_ID GitHub secret):');
            console.log(t.open_id);
            console.log('\nScopes granted:', t.scope);
            console.log('\nExpires in:', t.expires_in, 'seconds');
            console.log('Refresh token expires in:', t.refresh_expires_in, 'seconds');
            console.log('\nDone! Add the refresh token and open_id as GitHub secrets.');
          } else {
            console.error('Token exchange failed:', data);
          }
        } catch (e) {
          console.error('Token parse error:', data);
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>TikTok Authorization Complete!</h1><p>You can close this tab and go back to the terminal.</p>');

        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1000);
      });
    });

    tokenReq.on('error', e => console.error('Token request error:', e.message));
    tokenReq.write(body);
    tokenReq.end();

  } else if (parsed.pathname === '/tiktok/callback' && parsed.searchParams.get('error')) {
    console.error('Auth error:', parsed.searchParams.get('error'), parsed.searchParams.get('error_description'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Authorization Failed</h1><p>' + parsed.searchParams.get('error_description') + '</p>');
  } else {
    res.writeHead(200);
    res.end('Waiting for TikTok OAuth callback...');
  }
});

server.listen(3000, () => {
  console.log('Local server running on http://localhost:3000');
});
