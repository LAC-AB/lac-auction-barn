export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'No query provided' });

  const appId = process.env.EBAY_APP_ID;

  try {
    // eBay Finding API — findCompletedItems with SoldItemsOnly=true
    const url =
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

    const searchResponse = await fetch(url);
    const searchData = await searchResponse.json();

    const rawItems =
      searchData?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

    if (rawItems.length === 0) {
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [] });
    }

    const prices = rawItems
      .map(item => parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__))
      .filter(p => !isNaN(p) && p >= 10)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      return res.status(200).json({ median: null, low: null, high: null, count: 0, items: [] });
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
      items: rawItems.slice(0, 8).map(item => ({
        title:     item?.title?.[0] || '',
        price:     parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__),
        url:       item?.viewItemURL?.[0] || '',
        image:     item?.galleryURL?.[0] || '',
        condition: item?.condition?.[0]?.conditionDisplayName?.[0] || ''
      }))
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
