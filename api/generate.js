export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  try {
    const { max_tokens = 1400, system, compItems, facts } = req.body;

    const f = facts || {};

    const compContext = (compItems && compItems.length > 0)
      ? compItems.slice(0, 5).map((item, i) =>
          `${i + 1}. "${item.title}" — $${item.price}`
        ).join('\n')
      : null;

    const sellerFacts = `Vehicle: ${[f.year, f.make, f.model].filter(Boolean).join(' ') || 'Not specified'}
Part description (seller's words): ${f.description || 'Not specified'}
Part number: ${f.partNum || 'Not visible'}
Condition: Used OEM, removed during professional upgrade at LAC Speed Shop
Shipping: ${f.isLocal ? 'Local pickup only' : 'Ships USPS, buyer pays calculated shipping'}
Returns: No returns accepted
eBay median sold price: $${f.median} from ${f.comps} live comps (range $${f.low}–$${f.high})`;

    const powerPrompt = `You are writing an eBay listing for LAC Speed Shop, a professional speed shop in Los Angeles established in 2020. Your listings are specific, credible, and honest — they convert because buyers trust them.

${compContext ? `STUDY THESE TOP-SELLING EBAY LISTINGS FOR THIS PART — note how they lead with year/make, use exact spec callouts (MPH rating, OHC, cylinder count), and use condition words that convert ("Great Shape", "OEM Works", "Tested"):

${compContext}

Apply that exact keyword structure and title pattern to this listing.

` : ''}SELLER FACTS:
${sellerFacts}

WRITE THE LISTING following these rules exactly:

TITLE (max 80 chars):
- Lead with Year + Make/Model + exact part name
- Include the most important spec (MPH rating, size, cylinder count, etc.)
- End with a condition word that matches the top comps ("OEM", "Works", "Great Shape", "Tested")
- Copy the exact keyword pattern of the top comps above
- No punctuation at the end

DESCRIPTION (4 paragraphs, plain text, no bullet points, no markdown):
Paragraph 1 — Provenance: One confident sentence. What shop removed it, what the upgrade was, what vehicle it came off. Be specific.
Paragraph 2 — Condition: Every detail the seller mentioned. If they said it works, say it works and how they know. If there's a flaw, state it plainly and put it in context. Never use vague phrases like "good condition" alone — expand on what that means for this specific part.
Paragraph 3 — Fitment: What years/makes/models this fits. Pull compatibility clues from the comp titles above.
Paragraph 4 — Close: Shipping or pickup. No returns accepted — state matter-of-factly. "Questions welcome — we know our parts." End with "— LAC Speed Shop"

Respond ONLY with valid JSON, no markdown, no explanation:
{"title":"...","description":"...","price":${f.median || 0},"category":"...","facebook":"..."}`;

    const body = {
      model: 'claude-sonnet-4-20250514',
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

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
