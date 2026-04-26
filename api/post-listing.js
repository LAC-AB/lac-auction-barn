// /api/post-listing.js
// Posts a listing to eBay via the Trading API AddItem call
// Requires in Vercel env vars:
//   EBAY_APP_ID      (Client ID)
//   EBAY_CERT_ID     (Client Secret)
//   EBAY_DEV_ID      (Dev ID)
//   EBAY_USER_TOKEN  (User access token — generated in eBay Developer portal)

import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    title,
    description,
    price,
    category,        // eBay category ID string e.g. "33637"
    categoryName,    // Human-readable, used for fallback lookup
    shippingLocal,   // boolean — true = local pickup only
    images = [],     // array of base64 JPEG strings (up to 12)
    partNumber,
    year,
    make,
    model,
    length,
    width,
    height,
    weightLbs = 2,
    weightOz  = 0,,
  } = req.body;

  const token    = process.env.EBAY_USER_TOKEN;
  const devId    = process.env.EBAY_DEV_ID;
  const appId    = process.env.EBAY_APP_ID;
  const certId   = process.env.EBAY_CERT_ID;

  if (!token || !devId || !appId || !certId) {
    return res.status(500).json({
      error: 'eBay credentials missing from Vercel environment variables.',
      missing: {
        EBAY_USER_TOKEN: !token,
        EBAY_DEV_ID: !devId,
        EBAY_APP_ID: !appId,
        EBAY_CERT_ID: !certId,
      }
    });
  }

  // ── Resolve eBay category ID ───────────────────────────────────────────────
  // If the frontend passes a numeric string, use it directly.
  // Otherwise fall back to a safe default: 33637 = "Other" under eBay Motors Parts
  const categoryId = /^\d+$/.test(String(category || ''))
    ? String(category)
    : '33637';

  // ── Build picture URLs block ───────────────────────────────────────────────
  // eBay Trading API accepts URLs, not base64. For production you'd upload to
  // eBay EPS (eBay Picture Services) first. Here we support both paths:
  //   - If images are already https:// URLs, use them directly
  //   - If they are base64, upload to EPS first, then use returned URLs
  // For the MVP we skip base64→EPS and just omit pictures if none are URLs.
  const pictureUrls = images.filter(img => img.startsWith('https://'));
  const pictureXml = pictureUrls.length > 0
    ? `<PictureDetails>
        ${pictureUrls.map(u => `<PictureURL>${escXml(u)}</PictureURL>`).join('\n        ')}
       </PictureDetails>`
    : '';

  // ── Shipping details ───────────────────────────────────────────────────────
  const shippingXml = shippingLocal
    : `<ShippingDetails>
        <ShippingType>Calculated</ShippingType>
        <CalculatedShippingRate>
          <ShippingPackage>PackageThickEnvelope</ShippingPackage>
          <WeightMajor measurementSystem="English" unit="lbs">${Math.floor(weightLbs)}</WeightMajor>
          <WeightMinor measurementSystem="English" unit="oz">${Math.round(weightOz)}</WeightMinor>
          <PackagingHandlingCosts currencyID="USD">0.00</PackagingHandlingCosts>
          <MeasurementUnit>English</MeasurementUnit>
          <PackageLength measurementSystem="English" unit="in">${Math.round(length || 12)}</PackageLength>
          <PackageWidth measurementSystem="English" unit="in">${Math.round(width || 8)}</PackageWidth>
          <PackageDepth measurementSystem="English" unit="in">${Math.round(height || 6)}</PackageDepth>
        </CalculatedShippingRate>
        <ShippingServiceOptions>
          <ShippingServicePriority>1</ShippingServicePriority>
          <ShippingService>USPSPriority</ShippingService>
          <ShippingServiceAdditionalCost currencyID="USD">0.00</ShippingServiceAdditionalCost>
        </ShippingServiceOptions>
      </ShippingDetails>`;
        </CalculatedShippingRate>
        <ShippingServiceOptions>
          <ShippingServicePriority>1</ShippingServicePriority>
          <ShippingService>USPSPriorityMailPaddedFlatRateEnvelope</ShippingService>
          <ShippingServiceAdditionalCost currencyID="USD">0.00</ShippingServiceAdditionalCost>
        </ShippingServiceOptions>
      </ShippingDetails>`;

  // ── Build item specifics ───────────────────────────────────────────────────
  const specifics = [
    year  && `<NameValueList><Name>Year</Name><Value>${escXml(year)}</Value></NameValueList>`,
    make  && `<NameValueList><Name>Make</Name><Value>${escXml(make)}</Value></NameValueList>`,
    model && `<NameValueList><Name>Model</Name><Value>${escXml(model)}</Value></NameValueList>`,
    partNumber && `<NameValueList><Name>Manufacturer Part Number</Name><Value>${escXml(partNumber)}</Value></NameValueList>`,
    `<NameValueList><Name>Brand</Name><Value>OEM</Value></NameValueList>`,
    `<NameValueList><Name>Placement on Vehicle</Name><Value>Universal</Value></NameValueList>`,
  ].filter(Boolean).join('\n        ');

  // ── AddItem XML payload ────────────────────────────────────────────────────
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${escXml(title.substring(0, 80))}</Title>
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice currencyID="USD">${Number(price).toFixed(2)}</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <ConditionID>3000</ConditionID>
    <Country>US</Country>
    <Currency>USD</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Location>Santa Monica, CA</Location>
    <BestOfferDetails>
      <BestOfferEnabled>true</BestOfferEnabled>
    </BestOfferDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption>
    </ReturnPolicy>
    <ItemSpecifics>
      ${specifics}
    </ItemSpecifics>
    ${pictureXml}
    ${shippingXml}
    <Site>US</Site>
  </Item>
</AddItemRequest>`;

  // ── Call eBay Trading API ──────────────────────────────────────────────────
  // Use production endpoint. For sandbox swap to:
  //   https://api.sandbox.ebay.com/ws/api.dll
  const endpoint = 'https://api.ebay.com/ws/api.dll';

  try {
    const ebayRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-DEV-NAME': devId,
        'X-EBAY-API-APP-NAME': appId,
        'X-EBAY-API-CERT-NAME': certId,
        'X-EBAY-API-CALL-NAME': 'AddItem',
        'X-EBAY-API-SITEID': '0',
      },
      body: xml,
    });

    const responseText = await ebayRes.text();

    // Parse key fields from the XML response
    const itemId    = extractXml(responseText, 'ItemID');
    const ack       = extractXml(responseText, 'Ack');
    const errorMsg  = extractXml(responseText, 'LongMessage') || extractXml(responseText, 'ShortMessage');
    const fees      = extractXml(responseText, 'ListingFee');

    if (ack === 'Success' || ack === 'Warning') {
      let lotNumber = null;
      try {
        const sql = neon(process.env.DATABASE_URL);
        const rows = await sql`
          INSERT INTO listings
            (shop_id, ebay_item_id, title, asking_price, status, ebay_url,
             length_in, width_in, height_in, weight_lbs,
             year, make, model, part_number)
          VALUES
            ('lac-001', ${itemId}, ${title}, ${Number(price)}, 'active',
             ${'https://www.ebay.com/itm/' + itemId},
             ${length || null}, ${width || null}, ${height || null}, ${weightLbs || null},
             ${year || null}, ${make || null}, ${model || null}, ${partNumber || null})
          RETURNING lot_number
        `;
        lotNumber = rows[0]?.lot_number || null;
      } catch (dbErr) {
        console.error('DB insert failed (listing still posted):', dbErr.message);
      }

      return res.status(200).json({
        success: true,
        itemId,
        listingUrl: `https://www.ebay.com/itm/${itemId}`,
        lotNumber,
        ack,
        fees,
        warning: ack === 'Warning' ? errorMsg : null,
      });
    } else {
      return res.status(400).json({
        success: false,
        ack,
        error: errorMsg,
        raw: responseText.substring(0, 800), // truncated for debugging
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractXml(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
  return m ? m[1].trim() : null;
}

