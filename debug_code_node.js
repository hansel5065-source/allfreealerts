// DEBUG VERSION - paste this into the Code node temporarily
// It tries one URL and shows the actual error

try {
  const html = await this.helpers.httpRequest({
    method: 'GET',
    url: 'https://www.freeflys.com/',
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  return [{ json: { success: true, type: typeof html, length: String(html).length, preview: String(html).substring(0, 200) } }];
} catch (e) {
  return [{ json: { success: false, error: e.message, name: e.name, stack: String(e.stack).substring(0, 500) } }];
}
