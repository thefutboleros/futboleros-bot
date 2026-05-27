const WA_TOKEN    = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FB_TOKEN    = process.env.FB_PAGE_ACCESS_TOKEN;

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────

export async function sendWhatsApp(to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error('WhatsApp send error:', err);
  }
}

export async function sendWhatsAppImage(to, imageUrl, caption = '') {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: imageUrl, caption },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error('WhatsApp image send error:', err);
  }
}

// ── Facebook Messenger & Instagram DM (same Graph endpoint) ──────────────────

export async function sendMessenger(recipientId, text, token = FB_TOKEN) {
  const res = await fetch(
    'https://graph.facebook.com/v19.0/me/messages',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message:   { text },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error('Messenger send error:', err);
  }
}

// ── Parse incoming webhook payloads ──────────────────────────────────────────

/**
 * Returns an array of { channel, senderId, text, messageId } objects.
 * channel: 'whatsapp' | 'messenger' | 'instagram'
 */
export function parseWebhook(body) {
  const messages = [];

  for (const entry of body.entry || []) {
    // ── WhatsApp Cloud API ──────────────────────────────────────────────────
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      for (const msg of change.value?.messages || []) {
        if (msg.type !== 'text') continue;          // ignore media for now
        messages.push({
          channel:   'whatsapp',
          senderId:  msg.from,
          text:      msg.text?.body || '',
          messageId: msg.id,
        });
      }
    }

    // ── Facebook Messenger & Instagram DMs ─────────────────────────────────
    for (const event of entry.messaging || []) {
      if (!event.message?.text) continue;           // ignore non-text
      if (event.message.is_echo) continue;          // ignore our own echoes

      const isInstagram = entry.id && body.object === 'instagram';
      messages.push({
        channel:   isInstagram ? 'instagram' : 'messenger',
        senderId:  event.sender.id,
        text:      event.message.text,
        messageId: event.message.mid,
      });
    }
  }

  return messages;
}
