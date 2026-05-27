// In-memory conversation store — resets on server restart (acceptable for chat sessions)
// To upgrade: replace with Redis or a DB

const store = new Map();
const MAX_MESSAGES = 20;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function loadHistory(senderId) {
  const entry = store.get(senderId);
  if (!entry) return [];
  // Expire old sessions
  if (Date.now() - entry.lastActive > SESSION_TTL_MS) {
    store.delete(senderId);
    return [];
  }
  return entry.messages;
}

export function saveHistory(senderId, messages) {
  store.set(senderId, {
    messages: messages.slice(-MAX_MESSAGES),
    lastActive: Date.now(),
  });
}

// Track processed message IDs to avoid double-processing
const processedIds = new Set();
export function markProcessed(id) {
  processedIds.add(id);
  // Keep set small — prune after 1000 entries
  if (processedIds.size > 1000) {
    const [first] = processedIds;
    processedIds.delete(first);
  }
}
export function isProcessed(id) {
  return processedIds.has(id);
}
