export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const appId = process.env.EBAY_APP_ID;
  if (!appId) return res.status(500).json({ error: 'No App ID found in environment' });

  try {
    const searchUrl = `https://svcs.ebay.com/services/search/FindingService/v1?` +
      `OPERATION-NAME=findCompletedItems&` +
      `SERVICE-VERSION=1.0.0&` +
      `SECURITY-APPNAME=${encodeURIComponent(appId)}&` +
      `RESPONSE-DATA-FORMAT=JSON&` +
      `keywords=${encodeURIComponent(query)}&` +
      `itemFilter(0).name=SoldItemsOnly&` +
      `itemFilter(0).value=true&` +
      `sortOrder=EndTimeSoonest&` +
      `paginationInput.entriesPerPage=20`;

    const response = await fetch(searchUrl);
    const data = await response.json();

    const ackValue = data?.findCompletedItemsResponse?.[0]?.ack?.[0];
    const errorMessage = data?.findCompletedItemsResponse?.[0]?.errorMessage?.[0];
    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

    if (items.length === 0) {
      return res.status(200).json({
        median: null, low: null, high: null, count: 0,
        debug: { ack: ackValue, error: errorMessage, appIdUsed: appId.substring(0, 10) + '...' }
      });
    }

    const prices = items
      .map(item => parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__))
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
        title: item?.title?.[0],
        price: parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__),
        url: item?.viewItemURL?.[0]
      }))
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
