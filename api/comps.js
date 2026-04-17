export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  try {
    // Get OAuth token first
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

    // Search for sold items using Browse API
    const searchResponse = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=buyingOptions:{FIXED_PRICE}&limit=20`,
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
      return res.status(200).json({
        median: null, low: null, high: null, count: 0,
        debug: { tokenOk: true, itemCount: 0, searchStatus: searchData?.warnings || 'no results' }
      });
    }

    const prices = items
      .map(item => parseFloat(item?.price?.value))
      .filter(p => !isNaN(p) && p > 0)
      .sort((a, b) => a - b);

    const count = prices.length;
    const low = prices[0];
    const high = prices[count - 1];
    const mid = Math.floor(count / 2);
    const median = count % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

    return res.status(200).json({
      median: Math.round(median * 100) / 100,
      low: Math.round(low * 100) / 100,
      high: Math.round(high * 100) / 100,
      count,
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
