export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  try {
    // Vercel parses application/json automatically into an object
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { max_tokens = 1400, compItems = [], facts = {} } = body;

    const compContext = (compItems && compItems.length > 0)
      ? compItems.slice(0, 5).map((item, i) =>
          `${i + 1}. "${item.title}" — $${item.price}`
        ).join('\n')
      : 'No comp data available';

    const powerPrompt = `You are a professional eBay listing writer for LAC Speed Shop in Los Angeles. You do NOT repeat back what the seller says — you synthesize their rough notes into polished listing copy.

COMP LISTINGS (Study their titles, keywords, and specs):
${compContext}

PART DETAILS & SELLER RAW NOTES:
- Vehicle: ${[facts.year, facts.make, facts.model].filter(Boolean).join(' ') || 'Not specified'}
- Part number: ${facts.partNum || 'not visible'}
- Shipping: ${facts.isLocal ? 'local pickup only' : 'ships USPS, buyer pays'}
- Price data: median $${facts.median}, range $${facts.low}–$${facts.high}
- Seller's Raw Notes: "${facts.description || 'No description provided.'}"

TASK:
Do NOT just repeat the seller's raw notes. Write a professional, high-converting eBay listing. Expand on fitment and condition.

Output ONLY a JSON object with these exact keys (no markdown formatting, no code blocks):
{
  "title": "SEO optimized title mimicking the style of the comp titles (max 80 chars)",
  "description": "Paragraph 1: What this is and what it came off of.\\n\\nParagraph 2: Detailed condition report (rewrite the seller notes professionally).\\n\\nParagraph 3: Fitment details.\\n\\nParagraph 4: Shipping and trusted seller sign-off (LAC Speed Shop, Los Angeles).",
  "price": ${facts.median || 0},
  "category": "eBay Category name based on part",
  "facebook": "A short, friendly, local Facebook Marketplace post."
}`;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // The CORRECT model name
        max_tokens,
        messages: [{ role: 'user', content: powerPrompt }]
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });
    
    return res.status(200).json(data);

  } catch (err) {
    console.error("Generate API Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
