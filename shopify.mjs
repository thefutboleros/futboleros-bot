const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

async function gql(query) {
  const r = await fetch(`https://${SHOP}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await r.json();
  if (json.errors) console.error('Shopify GQL errors:', json.errors);
  return json.data;
}

// Arabic labels for statuses
const FINANCIAL_AR = {
  PAID: 'تم الدفع ✅',
  PENDING: 'في انتظار الدفع ⏳',
  VOIDED: 'ملغي ❌',
  REFUNDED: 'مسترجع 💸',
  PARTIALLY_REFUNDED: 'مسترجع جزئياً',
};
const FULFILLMENT_AR = {
  FULFILLED:    'تم الشحن 📦',
  UNFULFILLED:  'لم يُشحن بعد 🕐',
  IN_PROGRESS:  'جاري التجهيز 🔄',
  PARTIAL:      'شحن جزئي',
  ON_HOLD:      'موقوف مؤقتاً',
  OPEN:         'جديد',
};
const DELIVERY_AR = {
  DELIVERED:          'تم التسليم ✅',
  ATTEMPTED_DELIVERY: 'جرت محاولة التسليم ⚠️',
  IN_TRANSIT:         'في الطريق 🚚',
  OUT_FOR_DELIVERY:   'خرج للتسليم 🏃',
  FAILURE:            'فشل التسليم ❌',
  RETURNED:           'مرتجع 🔙',
  NOT_DELIVERED:      'لم يُسلَّم ❌',
  FULFILLED:          'تم الشحن 📦',
};

function normalizeOrderNumber(input) {
  if (!input) return null;
  const s = input.trim().replace(/^#+/, '').toUpperCase().replace(/\s/g, '');
  // Handle "FTB1234" or just "1234"
  if (/^\d+$/.test(s)) return `#FTB${s}`;
  if (/^FTB\d+$/i.test(s)) return `#${s.toUpperCase()}`;
  return `#${s}`;
}

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('0') && !p.startsWith('00')) p = '+2' + p; // Egypt local
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

export async function lookupOrder({ order_number, phone }) {
  let searchQuery;

  if (order_number) {
    const name = normalizeOrderNumber(order_number);
    searchQuery = `name:${name}`;
  } else if (phone) {
    const p = normalizePhone(phone);
    searchQuery = `phone:${p} OR shipping_address_phone:${p}`;
  } else {
    return { error: 'من فضلك أرسل رقم الأوردر أو رقم التليفون' };
  }

  const data = await gql(`{
    orders(first: 5, query: "${searchQuery} AND NOT financial_status:voided") {
      edges { node {
        name createdAt tags
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        fulfillments {
          displayStatus
          trackingInfo { number url }
        }
        lineItems(first: 10) {
          edges { node { title variantTitle quantity } }
        }
        shippingAddress { firstName lastName city }
      }}
    }
  }`);

  const orders = data?.orders?.edges?.map(e => e.node) || [];
  if (orders.length === 0) {
    return {
      found: false,
      message: 'مش لاقي أوردر بالبيانات دي. تأكد من رقم الأوردر أو رقم التليفون.',
    };
  }

  return orders.map(o => {
    const fulfillment = o.fulfillments?.[0];
    const tracking    = fulfillment?.trackingInfo?.[0]?.number;
    const delivStatus = fulfillment?.displayStatus;
    const isConfirmed = o.tags?.includes('تم تأكيد الطلب');

    return {
      found: true,
      order:          o.name,
      date:           new Date(o.createdAt).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }),
      total:          `${parseFloat(o.totalPriceSet.shopMoney.amount).toFixed(0)} جنيه`,
      confirmed:      isConfirmed ? 'تم تأكيده ✅' : 'لم يتم تأكيده بعد ⏳',
      paymentStatus:  FINANCIAL_AR[o.displayFinancialStatus] || o.displayFinancialStatus,
      fulfillStatus:  FULFILLMENT_AR[o.displayFulfillmentStatus] || o.displayFulfillmentStatus,
      deliveryStatus: delivStatus ? (DELIVERY_AR[delivStatus] || delivStatus) : null,
      trackingNumber: tracking || null,
      city:           o.shippingAddress?.city || null,
      customer:       o.shippingAddress ? `${o.shippingAddress.firstName} ${o.shippingAddress.lastName}`.trim() : null,
      items:          o.lineItems.edges.map(e =>
        `• ${e.node.title}${e.node.variantTitle ? ' - ' + e.node.variantTitle : ''} (${e.node.quantity} قطعة)`
      ),
    };
  });
}

export async function searchProducts({ query }) {
  const data = await gql(`{
    products(first: 8, query: "${query.replace(/"/g, '')}") {
      edges { node {
        title status
        variants(first: 30) {
          edges { node { title availableForSale price } }
        }
      }}
    }
  }`);

  const products = data?.products?.edges?.map(e => e.node) || [];
  if (products.length === 0) return { found: false, message: 'مش لاقي منتجات بالبحث ده' };

  return products
    .filter(p => p.status === 'ACTIVE')
    .map(p => {
      const available = p.variants.edges.filter(v => v.node.availableForSale).map(v => v.node.title);
      const prices    = [...new Set(p.variants.edges.map(v => parseFloat(v.node.price)))].sort((a,b)=>a-b);
      const priceStr  = prices.length === 1
        ? `${prices[0]} جنيه`
        : `${prices[0]}–${prices[prices.length-1]} جنيه`;
      return {
        name:      p.title,
        available: available.length > 0,
        sizes:     available.length > 0 ? available.join(', ') : 'نفذ من المخزون',
        price:     priceStr,
      };
    });
}
