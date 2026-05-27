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
  if (/^FTB\d+$/i.test(s)) return `#${s.toUpperCase()}`; // #FTB1234
  if (/^\d+$/.test(s)) return `#${s}`;                   // #3121008 as-is
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

// Shared GraphQL fields for an order node
const ORDER_NODE_FIELDS = `
  name createdAt tags phone
  displayFinancialStatus displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  fulfillments {
    displayStatus
    trackingInfo { number url }
  }
  lineItems(first: 10) {
    edges { node { title variantTitle quantity } }
  }
  shippingAddress { firstName lastName city phone }
  customer { phone }
`;

function formatOrderNode(o) {
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
}

export async function lookupOrder({ order_number, phone }) {

  // ── Order-number lookup ──────────────────────────────────────────────────────
  if (order_number) {
    const name = normalizeOrderNumber(order_number);
    const data = await gql(`{
      orders(first: 5, query: "name:${name}") {
        edges { node { ${ORDER_NODE_FIELDS} } }
      }
    }`);
    let orders = (data?.orders?.edges || []).map(e => e.node)
      .filter(o => o.displayFinancialStatus !== 'VOIDED');
    if (orders.length === 0) return { found: false, message: 'مش لاقي أوردر بالرقم ده. تأكد من رقم الأوردر.' };
    return orders.map(formatOrderNode);
  }

  // ── Phone lookup ─────────────────────────────────────────────────────────────
  if (!phone) return { error: 'من فضلك أرسل رقم الأوردر أو رقم التليفون' };

  const p     = normalizePhone(phone);
  // Egyptian local format: +201091233838 → 01091233838
  const local = p.startsWith('+20') ? '0' + p.slice(3) : null;
  // Without + prefix: +201091233838 → 201091233838
  const noPlus = p.startsWith('+') ? p.slice(1) : p;

  console.log('📞 Phone lookup — intl:', p, '| local:', local);

  // Build all the phone variants for Shopify search
  const variants = [p, noPlus, ...(local ? [local] : [])];
  const phoneTerms = variants.flatMap(v => [`phone:${v}`, `shipping_address_phone:${v}`]);
  const phoneQ = phoneTerms.join(' OR ');

  // Two parallel searches:
  // 1. Direct order search (covers guest checkouts with phone on the order)
  // 2. Customer search by phone → their orders (covers registered customers)
  const [ordersData, customersData] = await Promise.all([
    gql(`{
      orders(first: 10, query: "(${phoneQ})") {
        edges { node { ${ORDER_NODE_FIELDS} } }
      }
    }`),
    gql(`{
      customers(first: 5, query: "phone:${p}${local ? ' OR phone:' + local : ''}") {
        edges { node {
          orders(first: 10, sortKey: CREATED_AT, reverse: true) {
            edges { node { ${ORDER_NODE_FIELDS} } }
          }
        }}
      }
    }`),
  ]);

  const fromOrders    = (ordersData?.orders?.edges || []).map(e => e.node);
  const fromCustomers = (customersData?.customers?.edges || [])
    .flatMap(c => (c.node.orders?.edges || []).map(o => o.node));

  console.log('📦 From order search:', fromOrders.map(o => o.name));
  console.log('👤 From customer search:', fromCustomers.map(o => o.name));

  // Merge, deduplicate by order name, filter voided
  const seen = new Set();
  let orders = [...fromOrders, ...fromCustomers].filter(o => {
    if (seen.has(o.name) || o.displayFinancialStatus === 'VOIDED') return false;
    seen.add(o.name);
    return true;
  });

  // Client-side phone filter — last-10-digits comparison
  const digits10 = p.replace(/\D/g, '').slice(-10);
  orders = orders.filter(o => {
    const phones = [o.phone, o.shippingAddress?.phone, o.customer?.phone].filter(Boolean);
    console.log('📋 Order', o.name, 'phones:', phones);
    return phones.some(x => x.replace(/\D/g, '').slice(-10) === digits10);
  });

  if (orders.length === 0) {
    return {
      found: false,
      message: 'مش لاقي أوردر بالبيانات دي. تأكد من رقم الأوردر أو رقم التليفون.',
    };
  }

  return orders.map(formatOrderNode);
}

export async function searchProducts({ query }) {
  console.log('🔍 Searching Shopify for:', query);
  const data = await gql(`{
    products(first: 20, query: "${query.replace(/"/g, '')}") {
      edges { node {
        title status
        featuredImage { url }
        variants(first: 30) {
          edges { node { title availableForSale price } }
        }
      }}
    }
  }`);

  const products = data?.products?.edges?.map(e => e.node) || [];
  console.log('📦 Shopify returned', products.length, 'products:', products.map(p => p.title));
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
        imageUrl:  p.featuredImage?.url || null,
      };
    });
}
