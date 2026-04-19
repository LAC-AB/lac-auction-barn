export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  console.log('METHOD:', req.method);
  console.log('BODY KEYS:', Object.keys(req.body || {}));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  try {
    const { max_tokens = 1400, system, compItems, facts } = req.body;

    console.log('FACTS:', JSON.stringify(facts));
    console.log('COMP ITEMS COUNT:', compItems?.length);

    const f = facts || {};

    const compContext = (compItems && compItems.length > 0)
      ? compItems.slice(0, 5).map((item, i) =>
          `${i + 1}. "${item.title}" — $${item.price}`
        ).join('\n')
      : null;

    const powerPrompt = `You are a professional eBay listing writer for LAC Speed Shop, a speed shop in Los Angeles. You have years of experience writing listings that convert. You do NOT repeat back what the seller says — you translate their raw notes into polished, credible listing copy that reads like it was written by the most trusted seller on eBay Motors.

COMP LISTINGS — these are the top sold listings for this part. Study their title structure, keyword choices, and spec callouts:
${compContext || 'No comp data available'}

SELLER'S RAW NOTES (do not copy these words — interpret and rewrite them professionally):
Vehicle: ${[f.year, f.make, f.model].filter(Boolean).join(' ') || 'Not specified'}
What the seller said: "${f.description || ''}"
Part number: ${f.partNum || 'not visible'}
Shipping: ${f.isLocal ? 'local pickup only' : 'ships USPS, buyer pays'}
Price data: median $${f.median}, range $${f.low}–$${f.high} from ${f.comps} recent sales

YOUR JOB — write a listing that sounds like this came from an expert who handles these parts every day:

TITLE (max 80 chars):
- Mirror the keyword structure of the top comp titles above
- Year + Make/Model + exact part name + key spec + condition word
- Use the same condition words the top comps use ("OEM Works", "Great Shape", "Tested", "120 MPH")
- Do NOT use the seller's raw words if better options exist in the comps

DESCRIPTION — 4 paragraphs, plain text only, no bullets, no markdown:

Paragraph 1 — ONE sentence. Where this came from. "Pulled from a [year] [make/model] during a [type of upgrade] at LAC Speed Shop in Los Angeles." Specific and confident.

Paragraph 2 — Condition. Take the seller's raw condition notes and rewrite them the way a trusted, experienced seller would. Be specific about what works, what was tested, and any flaws in context. Do NOT just repeat the seller's words.

Paragraph 3 — Fitment. What years/makes/models this fits. Pull fitment clues from the comp titles.

Paragraph 4 — Close. Shipping or pickup. "No returns accepted — all sales final." Then: "Questions welcome — we know our parts." End with "— LAC Speed Shop, Los Angeles"

Respond ONLY with valid JSON, no markdown, no explanation:
{"title":"...","description":"...","price":${f.median || 0},"category":"...","facebook":"..."}`;

    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens,
      messages: [{ role: 'user', content: powerPrompt }]
    };
    if (system) body.system = system;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    console.log('CLAUDE RESPONSE STATUS:', upstream.status);
    const data = await upstream.json();
    console.log('CLAUDE CONTENT TYPE:', data.content?.[0]?.type);

    if (!upstream.ok) return res.status(upstream.status).json({ error: data });
    return res.status(200).json(data);

  } catch (err) {
    console.log('ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
