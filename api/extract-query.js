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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { description, year, make, model, partNum } = body;

    const vehicle = [year, make, model].filter(Boolean).join(' ');

    const prompt = `You are an expert automotive parts researcher. Extract the optimal eBay search query from this part description.

RULES:
- Return ONLY the search keywords, nothing else — no explanation, no punctuation, no quotes
- Maximum 6 words
- Include year, make, model if provided
- Focus on the specific part name — be precise, not generic
- Ignore condition words like "used", "like new", "good", "clean"
- Ignore history words like "removed", "mock-up", "came off", "rebuild"
- If a part number is provided, include it instead of the part name
- Never include shipping, price, or seller info

VEHICLE: ${vehicle || 'not specified'}
PART NUMBER: ${partNum || 'none'}
DESCRIPTION: "${description}"

Return only the search keywords:`;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }]
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });

    const query = data.content?.[0]?.text?.trim() || description.split(' ').slice(0, 5).join(' ');

    return res.status(200).json({ query });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
