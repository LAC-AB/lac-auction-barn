// /api/ebay-webhook.js
// Receives eBay Platform Notifications when an item sells.
// Flow: parse notification → look up listing in Neon → create Shippo label → update DB → text label URL

import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {

  // ── eBay sends a GET challenge to verify the endpoint ─────────────────────
  // Must respond with the challengeResponse before any notifications are sent
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code;
    if (challengeCode) {
      const endpoint = 'https://lac-auction-barn.vercel.app/api/ebay-webhook';
      const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;
      const crypto = await import('crypto');
      const hash = crypto.default
        .createHash('sha256')
        .update(challengeCode + verificationToken + endpoint)
        .digest('hex');
      return res.status(200).json({ challengeResponse: hash });
    }
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    const body = req.body;

    // ── Parse eBay notification ─────────────────────────────────────────────
    // eBay sends different notification types — we only care about FIXED_PRICE_TRANSACTION
    const notificationType = body?.metadata?.topic || body?.notification?.data?.topic || '';
    const data = body?.notification?.data || body?.data || {};

    // Pull item ID and buyer info from the notification
    const ebayItemId   = data.itemId || data.item?.itemId || null;
    const salePrice    = parseFloat(data.totalAmount || data.amount || 0);
    const buyerName    = data.buyer?.username || data.buyerName || 'Buyer';
    const buyerEmail   = data.buyer?.email || data.buyerEmail || null;

    // Buyer shipping address
    const shipTo = data.shippingAddress || data.buyer?.shippingAddress || {};
    const toName    = shipTo.fullName    || shipTo.name    || buyerName;
    const toStreet1 = shipTo.addressLine1 || shipTo.street1 || '';
    const toStreet2 = shipTo.addressLine2 || shipTo.street2 || '';
    const toCity    = shipTo.city        || '';
    const toState   = shipTo.stateOrProvince || shipTo.state || '';
    const toZip     = shipTo.postalCode  || shipTo.zip     || '';
    const toCountry = shipTo.countryCode || 'US';

    if (!ebayItemId) {
      console.log('No item ID in webhook payload — skipping', JSON.stringify(body).substring(0, 300));
      return res.status(200).json({ received: true, skipped: 'no item id' });
    }

    // ── Look up listing in Neon DB ──────────────────────────────────────────
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT * FROM listings WHERE ebay_item_id = ${ebayItemId} LIMIT 1
    `;

    if (rows.length === 0) {
      console.log('No DB record found for eBay item:', ebayItemId);
      return res.status(200).json({ received: true, skipped: 'no db record' });
    }

    const listing = rows[0];

    // ── Generate Shippo label ───────────────────────────────────────────────
    let labelUrl   = null;
    let trackingNo = null;

    const shippoKey = process.env.SHIPPO_API_KEY;
    if (shippoKey && toStreet1 && toCity && toState && toZip) {
      try {
        // Create a single-call shipment + transaction (label purchase)
        const shippoRes = await fetch('https://api.goshippo.com/shipments/', {
          method: 'POST',
          headers: {
            'Authorization': 'ShippoToken ' + shippoKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address_from: {
              name:    'L.A. Classics Speed Shop',
              street1: process.env.SHOP_ADDRESS_STREET || '2222 Westwood Blvd',
              city:    process.env.SHOP_ADDRESS_CITY   || 'Los Angeles',
              state:   process.env.SHOP_ADDRESS_STATE  || 'CA',
              zip:     process.env.SHOP_ADDRESS_ZIP    || '90064',
              country: 'US',
              phone:   process.env.SHOP_PHONE          || '',
              email:   process.env.SHOP_EMAIL          || 'westlaclassics@gmail.com'
            },
            address_to: {
              name:    toName,
              street1: toStreet1,
              street2: toStreet2,
              city:    toCity,
              state:   toState,
              zip:     toZip,
              country: toCountry,
              email:   buyerEmail || ''
            },
            parcels: [{
              length:        String(listing.length_in  || 12),
              width:         String(listing.width_in   || 8),
              height:        String(listing.height_in  || 6),
              distance_unit: 'in',
              weight:        String(listing.weight_lbs || 2),
              mass_unit:     'lb'
            }],
            async: false
          })
        });

        const shipmentData = await shippoRes.json();
        const rates = shipmentData.rates || [];

        // Pick cheapest USPS rate
        const uspsRates = rates.filter(r => r.provider === 'USPS' && r.available);
        uspsRates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
        const bestRate = uspsRates[0];

        if (bestRate) {
          // Purchase the label
          const txRes = await fetch('https://api.goshippo.com/transactions/', {
            method: 'POST',
            headers: {
              'Authorization': 'ShippoToken ' + shippoKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              rate:           bestRate.object_id,
              label_file_type: 'PDF_4X6',
              async:           false
            })
          });

          const txData = await txRes.json();
          if (txData.status === 'SUCCESS') {
            labelUrl   = txData.label_url;
            trackingNo = txData.tracking_number;
          } else {
            console.error('Shippo label purchase failed:', txData.messages);
          }
        }
      } catch (shippoErr) {
        console.error('Shippo error (listing still marked sold):', shippoErr.message);
      }
    } else {
      console.log('Skipping Shippo — missing key or address data');
    }

    // ── Update DB row to Sold ───────────────────────────────────────────────
    await sql`
      UPDATE listings SET
        status      = 'sold',
        sale_price  = ${salePrice || null},
        sold_at     = NOW(),
        updated_at  = NOW()
      WHERE ebay_item_id = ${ebayItemId}
    `;

    // ── Send AT&T text with label URL ───────────────────────────────────────
    const attPhone = process.env.NOTIFY_FROM; // reuse existing env var
    if (attPhone && labelUrl) {
      const message = [
        '🎉 SOLD — Lot #' + (listing.lot_number || '?'),
        listing.title?.substring(0, 50),
        'Sale: $' + salePrice,
        'Tracking: ' + (trackingNo || 'pending'),
        'Label: ' + labelUrl
      ].join('\n');

      try {
        // Use the existing notify endpoint internally
        await fetch('https://lac-auction-barn.vercel.app/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone:      attPhone.replace('@txt.att.net', ''),
            itemTitle:  listing.title,
            salePrice:  salePrice,
            itemId:     ebayItemId,
            orderId:    trackingNo || '',
            customMsg:  message
          })
        });
      } catch (notifyErr) {
        console.error('Notify error:', notifyErr.message);
      }
    }

    return res.status(200).json({
      received:   true,
      itemId:     ebayItemId,
      lotNumber:  listing.lot_number,
      labelUrl:   labelUrl,
      trackingNo: trackingNo
    });

  } catch (err) {
    console.error('Webhook error:', err);
    // Always return 200 to eBay or they'll retry indefinitely
    return res.status(200).json({ received: true, error: err.message });
  }
}
