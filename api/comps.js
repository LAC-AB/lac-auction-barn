export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  try {
    const tokenResponse = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${appId}:${certId}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      return res.status(500).json({ error: 'Failed to get token', detail: tokenData });
    }

    // Search with Motors category filter (category 6000 = eBay Motors Parts)
    const searchResponse = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&category_ids=6000&filter=buyingOptions:{FIXED_PRICE}&limit=20&sort=price`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
        }
      }
    );

    const searchData = await searchResponse.json();
    const items = searchData?.itemSummaries || [];

    if (items.length === 0) {
      return res.status(200).json({ median: null, low: null, high: null, count: 0 });
    }

    // Filter out items that are way too cheap (likely unrelated)
    const prices = items
      .map(item => parseFloat(item?.price?.value))
      .filter(p => !isNaN(p) && p > 5)
      .sort((a, b) => a - b);

    // Remove outliers — drop bottom 10% and top 10%
    const trimStart = Math.floor(prices.length * 0.1);
    const trimEnd = Math.ceil(prices.length * 0.9);
    const trimmed = prices.slice(trimStart, trimEnd);

    const count = trimmed.length;
    if (count === 0) return res.status(200).json({ median: null, low: null, high: null, count: 0 });

    const low = trimmed[0];
    const high = trimmed[count - 1];
    const mid = Math.floor(count / 2);
    const median = count % 2 !== 0 ? trimmed[mid] : (trimmed[mid - 1] + trimmed[mid]) / 2;

    return res.status(200).json({
      median: Math.round(median * 100) / 100,
      low: Math.round(low * 100) / 100,
      high: Math.round(high * 100) / 100,
      count: prices.length,
      items: items.slice(0, 5).map(item => ({
        title: item?.title,
        price: parseFloat(item?.price?.value),
        url: item?.itemWebUrl
      }))
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
