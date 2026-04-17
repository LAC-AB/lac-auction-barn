// /api/notify.js
// Sends a sale alert SMS via AT&T email-to-text using Resend
// Requires in Vercel env vars:
//   RESEND_API_KEY   — from resend.com (free tier covers this easily)
//   NOTIFY_FROM      — a verified sender address in Resend e.g. "alerts@yourdomain.com"
//                      OR use Resend's shared domain: "onboarding@resend.dev" (free, no domain needed)
//
// AT&T gateway: {10digitnumber}@txt.att.net — delivers as SMS, 160 char limit per segment

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromAddr  = process.env.NOTIFY_FROM || 'onboarding@resend.dev';

  if (!resendKey) {
    return res.status(500).json({
      error: 'RESEND_API_KEY not set in Vercel environment variables.',
      fix: 'Sign up at resend.com → API Keys → Create Key → add as RESEND_API_KEY in Vercel'
    });
  }

  const {
    phone,       // 10-digit AT&T number, digits only e.g. "3105551234"
    itemTitle,
    salePrice,
    buyerName,
    orderId,
    itemId,      // eBay item ID
  } = req.body;

  if (!phone || !/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Invalid phone number. Provide 10 digits, AT&T only.' });
  }

  const digits = phone.replace(/\D/g, '');
  const toGateway = `${digits}@txt.att.net`;

  // Keep the message short — AT&T SMS segments are 160 chars
  // This fits comfortably in one segment
  const subject = 'LAC SOLD';
  const body = `SOLD $${salePrice} — ${itemTitle.substring(0, 60)}${itemTitle.length > 60 ? '…' : ''}. Order ${orderId || itemId || '—'}. Check eBay.`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [toGateway],
        subject,
        text: body,
      }),
    });

    const data = await resendRes.json();

    if (!resendRes.ok) {
      return res.status(resendRes.status).json({ success: false, error: data });
    }

    return res.status(200).json({ success: true, sent_to: toGateway, message: body });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

