export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const email = (body.email || '').trim().toLowerCase();

    if (!email || !email.includes('@') || !email.includes('.')) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid email' }), { status: 400, headers });
    }

    const apiKey = env.BREVO_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'Email service not configured' }), { status: 500, headers });
    }

    // Add contact to Brevo with list ID 2 (default contacts list)
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        email,
        listIds: [2],
        updateEnabled: true,
        attributes: {
          SIGNUP_SOURCE: 'website',
          SIGNUP_DATE: new Date().toISOString().split('T')[0],
        },
      }),
    });

    if (res.ok || res.status === 204) {
      return new Response(JSON.stringify({ ok: true, message: "You're in! Daily alerts coming your way." }), { headers });
    }

    const errData = await res.json().catch(() => ({}));

    // Already exists = still a success
    if (errData.code === 'duplicate_parameter') {
      return new Response(JSON.stringify({ ok: true, message: "You're already subscribed!" }), { headers });
    }

    console.error('Brevo error:', JSON.stringify(errData));
    return new Response(JSON.stringify({ ok: false, error: 'Could not subscribe. Try again.' }), { status: 500, headers });
  } catch (e) {
    console.error('Subscribe error:', e.message);
    return new Response(JSON.stringify({ ok: false, error: 'Something went wrong' }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
