export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  try {
    const { messages, max_tokens = 1400, system, compItems } = req.body;

    // Build comp titles context from the items array
    const compContext = (compItems && compItems.length > 0)
      ? compItems.slice(0, 5).map((item, i) =>
          `${i + 1}. "${item.title}" — $${item.price}`
        ).join('\n')
      : null;

    // Extract the original prompt content from the frontend
    const { messages, max_tokens = 1400, system, compItems, facts } = req.body;

    // Build a powerful replacement prompt
    const powerPrompt = `You are writing an eBay listing for LAC Speed Shop, a professional speed shop in Los Angeles. Your listings are known for being specific, credible, and honest — they convert because buyers trust them.

${compContext ? `STUDY THESE TOP-SELLING LISTINGS FOR THIS PART — note their title structure, how they lead with year/make, use exact spec callouts (MPH rating, OHC, cylinder count), and condition words that actually convert ("Great Shape", "OEM Works", "Tested"):

${compContext}

Apply that exact keyword and title structure to this listing.` : ''}

NOW HERE IS THE SELLER'S INFORMATION:
${originalContent}

WRITE THE LISTING following these rules exactly:

TITLE (max 80 chars):
- Lead with Year + Make/Model + exact part name
- Include the most important spec (MPH rating, size, cylinder count, etc.)
- End with a condition word that matches the top comps ("OEM", "Works", "Great Shape", "Tested")
- Copy the exact keyword pattern of the top comps above
- No punctuation at the end

DESCRIPTION (4 paragraphs, plain text, no bullet points, no markdown):
Paragraph 1 — Provenance: Where this part came from. Be specific — what shop removed it, what the upgrade was, what vehicle it came off. One confident sentence.
Paragraph 2 — Condition: Every detail the seller mentioned. Specific. If they said it works, say it works and how they know. If there's a flaw, state it plainly and put it in context. Do NOT use vague words like "good condition" alone.
Paragraph 3 — Fitment: What years/makes/models this fits. Any compatibility notes visible from the comp titles. Keep it factual.
Paragraph 4 — Close: Shipping or pickup info. No returns accepted — state this matter-of-factly. "Questions welcome — we know our parts." End with "— LAC Speed Shop"

PRICE: Use the eBay median from the seller's data.
CATEGORY: Most specific eBay Motors category for this part.
FACEBOOK: One casual paragraph for Facebook Marketplace — friendly, local, no jargon.

Respond ONLY with valid JSON, no markdown, no explanation:
{"title":"...","description":"...","price":000.00,"category":"...","facebook":"..."}`;

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
