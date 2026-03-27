export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const email = (body.email || '').trim().toLowerCase();

    // Validate email
    if (!email || !email.includes('@') || !email.includes('.')) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid email' }), { status: 400, headers });
    }

    // Check if already subscribed
    const existing = await env.SUBSCRIBERS.get(email);
    if (existing) {
      return new Response(JSON.stringify({ ok: true, message: 'Already subscribed!' }), { headers });
    }

    // Store in KV: key=email, value=metadata
    await env.SUBSCRIBERS.put(email, JSON.stringify({
      email,
      subscribed_at: new Date().toISOString(),
      source: 'website',
    }));

    return new Response(JSON.stringify({ ok: true, message: "You're in! We'll send you daily alerts." }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Something went wrong' }), { status: 500, headers });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
