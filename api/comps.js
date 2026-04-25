export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query, condition } = req.query;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const appId  = process.env.EBAY_APP_ID;
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
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [] });
    }

    // Build condition filter
    let conditionFilter = '';
    if (condition === 'used') conditionFilter = '&filter=conditions:{USED}';
    if (condition === 'new')  conditionFilter = '&filter=conditions:{NEW}';

    const browseUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&natural_language=true&filter=buyingOptions:{FIXED_PRICE}${conditionFilter}&limit=50&sort=relevance`;

    const browseRes = await fetch(browseUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      }
    });

    const browseData = await browseRes.json();
    let items = browseData?.itemSummaries || [];

    // If condition filter returned nothing, fall back to unfiltered
    let usedFallback = false;
    if (items.length === 0 && conditionFilter) {
      const fallbackRes = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&natural_language=true&filter=buyingOptions:{FIXED_PRICE}&limit=50&sort=relevance`,
        {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
          }
        }
      );
      const fallbackData = await fallbackRes.json();
      items = fallbackData?.itemSummaries || [];
      usedFallback = true;
    }

    if (items.length === 0) {
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [], conditionFallback: false });
    }

    const prices = items
      .map(item => parseFloat(item?.price?.value))
      .filter(p => !isNaN(p) && p >= 10 && p <= 5000)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [], conditionFallback: false });
    }

    const count  = prices.length;
    const low    = prices[0];
    const high   = prices[count - 1];
    const mid    = Math.floor(count / 2);
    const median = count % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

    return res.status(200).json({
      median: Math.round(median * 100) / 100,
      low:    Math.round(low    * 100) / 100,
      high:   Math.round(high   * 100) / 100,
      count,
      conditionFallback: usedFallback,
      items: items
        .filter(item => parseFloat(item?.price?.value) >= 10 && parseFloat(item?.price?.value) <= 5000)
        .slice(0, 8).map(item => ({
          title:     item?.title,
          price:     parseFloat(item?.price?.value),
          url:       item?.itemWebUrl,
          image:     item?.image?.imageUrl || '',
          condition: item?.condition || ''
        }))
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
