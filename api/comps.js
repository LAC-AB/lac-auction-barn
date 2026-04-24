export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const appId  = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  let findingDebug = null;

  // ── 1. Try Finding API for SOLD listings ──────────────────────────────────
  try {
    const findingUrl =
      'https://svcs.ebay.com/services/search/FindingService/v1' +
      '?OPERATION-NAME=findCompletedItems' +
      '&SERVICE-VERSION=1.0.0' +
      '&SECURITY-APPNAME=' + encodeURIComponent(appId) +
      '&RESPONSE-DATA-FORMAT=JSON' +
      '&REST-PAYLOAD' +
      '&keywords=' + encodeURIComponent(query) +
      '&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true' +
      '&sortOrder=BestMatch' +
      '&paginationInput.entriesPerPage=50';

    const findingRes  = await fetch(findingUrl);
    const findingData = await findingRes.json();

    // Capture raw response for debug
    const ack      = findingData?.findCompletedItemsResponse?.[0]?.ack?.[0];
    const errMsg   = findingData?.findCompletedItemsResponse?.[0]?.errorMessage || null;
    const count    = findingData?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.['@count'] || '0';
    const soldItems = findingData?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

    findingDebug = { ack, errMsg, count, itemsReturned: soldItems.length };

    if (soldItems.length > 0) {
      const prices = soldItems
        .map(item => parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__))
        .filter(p => !isNaN(p) && p >= 10)
        .sort((a, b) => a - b);

      if (prices.length > 0) {
        const count  = prices.length;
        const low    = prices[0];
        const high   = prices[count - 1];
        const mid    = Math.floor(count / 2);
        const median = count % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

        return res.status(200).json({
          median:      Math.round(median * 100) / 100,
          low:         Math.round(low    * 100) / 100,
          high:        Math.round(high   * 100) / 100,
          count,
          soldData:    true,
          findingDebug,
          items: soldItems.slice(0, 8).map(item => ({
            title:     item?.title?.[0] || '',
            price:     parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__),
            url:       item?.viewItemURL?.[0] || '',
            image:     item?.galleryURL?.[0] || '',
            condition: item?.condition?.[0]?.conditionDisplayName?.[0] || ''
          }))
        });
      }
    }
  } catch (e) {
    findingDebug = { error: e.message };
  }

  // ── 2. Fall back to Browse API for ACTIVE listings ────────────────────────
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
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [], findingDebug });
    }

    const browseRes = await fetch(
`      https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=soldItems:true&limit=50&sort=relevance`,      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
        }
      }
    );

    const browseData = await browseRes.json();
    const items = browseData?.itemSummaries || [];

    if (items.length === 0) {
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [], findingDebug });
    }

    const prices = items
      .map(item => parseFloat(item?.price?.value))
      .filter(p => !isNaN(p) && p >= 10)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [], findingDebug });
    }

    const count  = prices.length;
    const low    = prices[0];
    const high   = prices[count - 1];
    const mid    = Math.floor(count / 2);
    const median = count % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

    return res.status(200).json({
      median:      Math.round(median * 100) / 100,
      low:         Math.round(low    * 100) / 100,
      high:        Math.round(high   * 100) / 100,
      count,
      soldData:    false,
      findingDebug,
      items: items.slice(0, 8).map(item => ({
        title:     item?.title,
        price:     parseFloat(item?.price?.value),
        url:       item?.itemWebUrl,
        image:     item?.image?.imageUrl || '',
        condition: item?.condition || ''
      }))
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, findingDebug });
  }
}
