export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  try {
    let { messages, max_tokens = 1400, system, compItems } = req.body;

    if (compItems && Array.isArray(compItems) && compItems.length > 0) {
      const top3 = compItems.slice(0, 3);
      const descParts = [];

      for (let i = 0; i < top3.length; i++) {
        try {
          const item = top3[i];
          const match = item.url && item.url.match(/\/itm\/(\d+)/);
          if (!match) continue;

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);

          const r = await fetch(
            `https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&item=${match[1]}`,
            {
              headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
              signal: controller.signal
            }
          );
          clearTimeout(timer);

          if (!r.ok) continue;

          const html = await r.text();
          const text = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 800);

          if (text && text.length > 40) {
            descParts.push(`COMP ${i + 1}: "${item.title}" — $${item.price}\nDESCRIPTION: ${text}`);
          }
        } catch (e) {
          continue;
        }
      }

      if (descParts.length > 0 && messages && messages.length > 0) {
        const injection = `\nREAL LISTING DESCRIPTIONS FROM TOP SOLD COMPS — study these, this is how winning sellers actually write:\n\n${descParts.join('\n\n')}\n\nApply those exact patterns to the seller facts below.\n`;
        const updated = messages[0].content.includes('STEP 2')
          ? messages[0].content.replace('STEP 2', injection + '\nSTEP 2')
          : messages[0].content + injection;
        messages = [{ role: 'user', content: updated }];
      }
    }

    const body = { model: 'claude-sonnet-4-20250514', max_tokens, messages };
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
