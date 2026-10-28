const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_MESSAGES = 12;
const DEFAULT_MAX_CONVERSATIONS = 500;
const STORAGE_VERSION = 1;
const CLEANUP_INTERVAL_MS = 60 * 1000;

function createConversationHistory({
  ttlMs = DEFAULT_TTL_MS,
  maxMessages = DEFAULT_MAX_MESSAGES,
  maxConversations = DEFAULT_MAX_CONVERSATIONS,
  now = Date.now,
  storagePath,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a number greater than 0.");
  }
  if (!Number.isInteger(maxMessages) || maxMessages < 2 || maxMessages % 2 !== 0) {
    throw new RangeError("maxMessages must be an even integer greater than or equal to 2.");
  }
  if (!Number.isInteger(maxConversations) || maxConversations < 1) {
    throw new RangeError("maxConversations must be an integer greater than or equal to 1.");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function.");
  }
  if (
    storagePath !== undefined &&
    (typeof storagePath !== "string" || storagePath.length === 0)
  ) {
    throw new TypeError("storagePath must be a non-empty string when provided.");
  }

  const conversations = new Map();
  const resolvedStoragePath = storagePath ? path.resolve(storagePath) : null;
  const temporaryStoragePath = resolvedStoragePath ? `${resolvedStoragePath}.tmp` : null;

  function persist() {
    if (!resolvedStoragePath) return;

    const directory = path.dirname(resolvedStoragePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    const contents = JSON.stringify({
      version: STORAGE_VERSION,
      conversations: [...conversations.entries()],
    });

    try {
      fs.writeFileSync(temporaryStoragePath, contents, {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporaryStoragePath, resolvedStoragePath);
    } finally {
      if (fs.existsSync(temporaryStoragePath)) {
        fs.unlinkSync(temporaryStoragePath);
      }
    }
  }

  function removeExpired(currentTime) {
    let removed = false;
    for (const [conversationId, conversation] of conversations) {
      if (currentTime - conversation.updatedAt >= ttlMs) {
        conversations.delete(conversationId);
        removed = true;
      }
    }
    return removed;
  }

  function evictOldest() {
    let oldestId;
    let oldestUpdate = Infinity;

    for (const [conversationId, conversation] of conversations) {
      if (conversation.updatedAt < oldestUpdate) {
        oldestId = conversationId;
        oldestUpdate = conversation.updatedAt;
      }
    }

    if (oldestId !== undefined) conversations.delete(oldestId);
  }

  function load() {
    if (!resolvedStoragePath) return;

    if (fs.existsSync(temporaryStoragePath)) {
      fs.unlinkSync(temporaryStoragePath);
    }

    let contents;
    try {
      contents = fs.readFileSync(resolvedStoragePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw new Error("Could not read persisted conversation history.", { cause: error });
    }

    let stored;
    try {
      stored = JSON.parse(contents);
    } catch (error) {
      throw new Error("Persisted conversation history is not valid JSON.", { cause: error });
    }

    if (
      !stored ||
      stored.version !== STORAGE_VERSION ||
      !Array.isArray(stored.conversations)
    ) {
      throw new Error("Persisted conversation history has an unsupported format.");
    }

    let changed = false;
    for (const entry of stored.conversations) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error("Persisted conversation history contains an invalid entry.");
      }
      const [conversationId, conversation] = entry;
      validateConversationId(conversationId);
      if (
        !conversation ||
        !Array.isArray(conversation.messages) ||
        !Number.isFinite(conversation.updatedAt) ||
        conversations.has(conversationId)
      ) {
        throw new Error("Persisted conversation history contains an invalid conversation.");
      }
      if (
        conversation.messages.some(
          (message) =>
            !message ||
            !["user", "model"].includes(message.role) ||
            typeof message.text !== "string",
        ) ||
        conversation.messages.length % 2 !== 0
      ) {
        throw new Error("Persisted conversation history contains invalid messages.");
      }

      const trimmedMessages = conversation.messages.slice(-maxMessages);
      if (trimmedMessages.length !== conversation.messages.length) changed = true;
      const messages = trimmedMessages.map((message) => ({
        role: message.role,
        text: message.text,
      }));
      conversations.set(conversationId, {
        messages,
        updatedAt: conversation.updatedAt,
      });
    }

    changed = removeExpired(now()) || changed;
    while (conversations.size > maxConversations) {
      evictOldest();
      changed = true;
    }
    if (changed) persist();
  }

  function validateConversationId(conversationId) {
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      throw new TypeError("conversationId must be a non-empty string.");
    }
  }

  const history = {
    get(conversationId) {
      validateConversationId(conversationId);
      if (removeExpired(now())) persist();

      const conversation = conversations.get(conversationId);
      return conversation
        ? conversation.messages.map((message) => ({ ...message }))
        : [];
    },

    clear(conversationId) {
      validateConversationId(conversationId);
      const expiredRemoved = removeExpired(now());
      const removed = conversations.delete(conversationId);
      if (expiredRemoved || removed) persist();
      return removed;
    },

    recordTurn(conversationId, userText, assistantText) {
      validateConversationId(conversationId);
      if (typeof userText !== "string" || typeof assistantText !== "string") {
        throw new TypeError("Conversation messages must be strings.");
      }

      const currentTime = now();
      removeExpired(currentTime);

      let conversation = conversations.get(conversationId);
      if (!conversation) {
        if (conversations.size >= maxConversations) evictOldest();
        conversation = { messages: [], updatedAt: currentTime };
      }

      conversation.messages.push(
        { role: "user", text: userText },
        { role: "model", text: assistantText },
      );
      if (conversation.messages.length > maxMessages) {
        conversation.messages.splice(0, conversation.messages.length - maxMessages);
      }
      conversation.updatedAt = currentTime;
      conversations.set(conversationId, conversation);
      persist();
    },
  };

  load();

  if (resolvedStoragePath) {
    const cleanupTimer = setInterval(() => {
      if (removeExpired(now())) persist();
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref();
  }

  return history;
}

module.exports = { createConversationHistory };
