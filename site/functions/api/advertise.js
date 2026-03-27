export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const data = await request.json();
    const { name, company, email, category, url, listing_type, description } = data;

    if (!name || !email || !company || !url) {
      return new Response(JSON.stringify({ ok: false, error: 'Please fill in all required fields.' }), { status: 400, headers });
    }

    const apiKey = env.BREVO_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: true, message: "Submitted! We'll review and get back to you within 24 hours." }), { headers });
    }

    // Send notification email to contact@allfreealerts.com via Brevo
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'AllFreeAlerts', email: 'contact@allfreealerts.com' },
        to: [{ email: 'contact@allfreealerts.com', name: 'AllFreeAlerts' }],
        replyTo: { email, name },
        subject: `New Listing Submission: ${company} (${listing_type || 'standard'})`,
        htmlContent: `
          <h2>New Listing Submission</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Name</td><td style="padding:8px;border-bottom:1px solid #eee">${name}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Company</td><td style="padding:8px;border-bottom:1px solid #eee">${company}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Email</td><td style="padding:8px;border-bottom:1px solid #eee"><a href="mailto:${email}">${email}</a></td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Category</td><td style="padding:8px;border-bottom:1px solid #eee">${category || '-'}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">URL</td><td style="padding:8px;border-bottom:1px solid #eee"><a href="${url}">${url}</a></td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Listing Type</td><td style="padding:8px;border-bottom:1px solid #eee">${listing_type || 'standard'}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee">Description</td><td style="padding:8px;border-bottom:1px solid #eee">${description || '-'}</td></tr>
          </table>
        `,
      }),
    });

    // Also add them as a Brevo contact for follow-up
    await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        listIds: [3],
        updateEnabled: true,
        attributes: {
          FIRSTNAME: name,
          COMPANY: company,
          LISTING_TYPE: listing_type || 'standard',
        },
      }),
    });

    return new Response(JSON.stringify({ ok: true, message: "Submitted! We'll review and get back to you within 24 hours." }), { headers });
  } catch (e) {
    console.error('Advertise error:', e.message);
    return new Response(JSON.stringify({ ok: true, message: "Submitted! We'll be in touch soon." }), { headers });
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
