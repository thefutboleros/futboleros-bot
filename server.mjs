import 'dotenv/config';
import express from 'express';
import { parseWebhook, sendWhatsApp, sendWhatsAppImage, sendMessenger } from './meta.mjs';
import { runAgent }                                   from './agent.mjs';
import { loadHistory, saveHistory, isProcessed, markProcessed } from './memory.mjs';

const app    = express();
const PORT   = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'futboleros_verify';

app.use(express.json());

// ── Webhook verification (GET) ────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified ✅');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Incoming messages (POST) ──────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Acknowledge immediately — Meta requires a fast 200
  res.sendStatus(200);

  const messages = parseWebhook(req.body);

  for (const { channel, senderId, text, messageId } of messages) {
    // De-duplicate (Meta sometimes delivers the same message twice)
    if (isProcessed(messageId)) continue;
    markProcessed(messageId);

    console.log(`[${channel}] ${senderId}: ${text}`);

    try {
      const history = loadHistory(senderId);
      const { reply, images } = await runAgent(history, text);

      // Persist updated history (user + assistant turns)
      saveHistory(senderId, [
        ...history,
        { role: 'user',      content: text  },
        { role: 'assistant', content: reply },
      ]);

      // Send reply back on the right channel
      if (channel === 'whatsapp') {
        await sendWhatsApp(senderId, reply);
        // Send product images one by one
        for (const { url, caption } of images) {
          await sendWhatsAppImage(senderId, url, caption);
        }
      } else {
        await sendMessenger(senderId, reply);
      }
    } catch (err) {
      console.error(`Error handling message from ${senderId}:`, err);
      // Best-effort error reply
      const errMsg = 'معلش، حصل خطأ. حاول تاني بعد شوية 🙏';
      try {
        if (channel === 'whatsapp') await sendWhatsApp(senderId, errMsg);
        else                         await sendMessenger(senderId, errMsg);
      } catch (_) { /* ignore send failure */ }
    }
  }
});

// ── Shopify OAuth callback (temporary — to capture access token) ──────────────
app.get('/shopify/callback', async (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.send('Missing code or shop');

  const clientId     = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const data = await r.json();
  console.log('🔑 SHOPIFY ACCESS TOKEN:', data.access_token);
  res.send(`Token logged in Railway. access_token: ${data.access_token}`);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`Bot listening on port ${PORT} 🚀`));
