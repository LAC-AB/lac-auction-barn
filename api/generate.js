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
    // Parse body — handles both string and object (ES module compatibility)
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { max_tokens = 1400, system, compItems, facts } = parsed;

    const f = facts || {};

    const compContext = (compItems && compItems.length > 0)
      ? compItems.slice(0, 5).map((item, i) =>
          `${i + 1}. "${item.title}" — $${item.price}`
        ).join('\n')
      : null;

    const powerPrompt = `You are a professional eBay listing writer for LAC Speed Shop, a speed shop in Los Angeles. You do NOT repeat back what the seller says — you translate their raw notes into polished listing copy that reads like it was written by the most trusted seller on eBay Motors.

COMP LISTINGS — top sold listings for this part. Study their title structure, keyword choices, spec callouts, and condition language. This is the primary source for how to write the listing:
${compContext || 'No comp data available'}

SELLER RAW NOTES — interpret and rewrite, do not copy:
Vehicle: ${[f.year, f.make, f.model].filter(Boolean).join(' ') || 'Not specified'}
What the seller said: "${f.description || ''}"
Part number: ${f.partNum || 'not visible'}
Shipping: ${f.isLocal ? 'local pickup only' : 'ships USPS, buyer pays'}
Price data: median $${f.median}, range $${f.low}–$${f.high} from ${f.comps} recent sales

WRITE THE LISTING:

TITLE (max 80 chars): Mirror the keyword structure of the comp titles. Year + Make/Model + exact part name + key spec + condition word. Use condition words from the comps ("OEM Works", "Great Shape", "Tested", "120 MPH"). No punctuation at end.

DESCRIPTION — 4 paragraphs, plain text, no bullets, no markdown:
P1: One sentence. Where this came from — what shop, what upgrade, what vehicle.
P2: Condition. Rewrite the seller's notes the way a trusted experienced seller would. Specific about what works, what was tested, any flaws in context. Never copy the seller's words verbatim.
P3: Fitment. What years/makes/models this fits. Use clues from the comp titles to expand beyond what the seller said.
P4: Shipping or pickup. "No returns accepted — all sales final." "Questions welcome — we know our parts." End with "— LAC Speed Shop, Los Angeles"

FACEBOOK: One casual paragraph for Marketplace. Friendly, local, no jargon.

Respond ONLY with valid JSON, no markdown:
{"title":"...","description":"...","price":${f.median || 0},"category":"...","facebook":"..."}`;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens,
        messages: [{ role: 'user', content: powerPrompt }]
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
