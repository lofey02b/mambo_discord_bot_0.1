const test = require("node:test");
const assert = require("node:assert/strict");
const { createConversationHistory } = require("./conversation-history");
const { createGeminiReply } = require("./gemini-reply");
const {
  createMessageHandler,
  extractHashtagTopics,
  formatConversationMessage,
} = require("./message-handler");
const { createQuizSessions } = require("./quiz-mode");
const { createUserCooldown } = require("./user-cooldown");

test("ignores bot-authored messages that mention Bondhu", async () => {
  const client = {
    user: { id: "bot-1", username: "Bondhu", globalName: null },
  };
  const replies = [];
  const geminiCalls = [];
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(0),
    conversationHistory: createConversationHistory(),
    createReply: async (...args) => {
      geminiCalls.push(args);
      return "A reply";
    },
  });

  await handler({
    author: { id: "other-bot", bot: true },
    content: "<@bot-1> hello",
    channelId: "channel-1",
    mentions: { has: (user) => user.id === client.user.id },
    channel: { sendTyping: async () => {} },
    reply: async (payload) => replies.push(payload),
  });

  assert.deepEqual(replies, []);
  assert.deepEqual(geminiCalls, []);
});

test("blocked addressed messages get a cooldown reply without calling Gemini", async () => {
  const client = {
    user: { id: "bot-1", username: "Bondhu", globalName: null },
  };
  const conversationHistory = createConversationHistory();
  const geminiCalls = [];
  const replies = [];
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(30_000),
    conversationHistory,
    createReply: async (...args) => {
      geminiCalls.push(args);
      return "Areh, bhalo achi!";
    },
  });

  function addressedMessage() {
    return {
      author: { id: "member-1", bot: false },
      content: "<@bot-1> kemon acho?",
      channelId: "channel-1",
      mentions: { has: (user) => user.id === client.user.id },
      channel: { sendTyping: async () => {} },
      reply: async (payload) => {
        replies.push(payload);
      },
    };
  }

  await handler(addressedMessage());
  await handler(addressedMessage());

  assert.equal(geminiCalls.length, 1);
  assert.match(replies[0].content, /Areh, bhalo achi!/);
  assert.match(replies[1].content, /^Ektu wait kor na, bondhu 😅 \d+ sec por abar dakish!$/);
  assert.deepEqual(replies[1].allowedMentions, { repliedUser: false });
});

test("blocks an addressed duplicate while the first Gemini reply is in flight", async () => {
  const client = {
    user: { id: "bot-1", username: "Bondhu", globalName: null },
  };
  const replies = [];
  let generatorStarted;
  let finishGenerator;
  let generatorCalls = 0;
  const started = new Promise((resolve) => {
    generatorStarted = resolve;
  });
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(30_000),
    conversationHistory: createConversationHistory(),
    createReply: async () => {
      generatorCalls += 1;
      if (generatorCalls === 1) {
        generatorStarted();
        return new Promise((resolve) => {
          finishGenerator = resolve;
        });
      }
      return "Unexpected second request";
    },
  });

  function addressedMessage(content) {
    return {
      author: { id: "member-1", bot: false },
      content,
      channelId: "channel-1",
      mentions: { has: (user) => user.id === client.user.id },
      channel: { sendTyping: async () => {} },
      reply: async (payload) => replies.push(payload),
    };
  }

  const firstRequest = handler(addressedMessage("<@bot-1> first"));
  await started;

  await handler(addressedMessage("<@bot-1> second"));

  assert.equal(generatorCalls, 1);
  assert.equal(replies.length, 1);
  assert.match(
    replies[0].content,
    /^Ektu wait kor na, bondhu 😅 \d+ sec por abar dakish!$/,
  );
  assert.deepEqual(replies[0].allowedMentions, { repliedUser: false });

  finishGenerator("First request reply");
  await firstRequest;

  assert.equal(replies.length, 2);
  assert.equal(replies[1].content, "First request reply");
});

test("only sends the addressed channel's history to Gemini", async () => {
  const client = {
    user: { id: "123456", username: "Bondhu", globalName: null },
  };
  const conversationHistory = createConversationHistory();
  conversationHistory.recordTurn("channel-1", "Channel one question", "Channel one answer");
  conversationHistory.recordTurn("channel-2", "Private unrelated question", "Private unrelated answer");

  const requests = [];
  const createReply = createGeminiReply({
    ai: {
      models: {
        generateContent: async (request) => {
          requests.push(request);
          return { text: "A channel-specific reply" };
        },
      },
    },
    model: "test-model",
  });
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(0),
    conversationHistory,
    createReply,
  });

  await handler({
    author: { id: "member-1", bot: false },
    content: "<@123456> continue",
    channelId: "channel-1",
    mentions: { has: (user) => user.id === client.user.id },
    channel: { sendTyping: async () => {} },
    reply: async () => {},
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].contents, [
    { role: "user", parts: [{ text: "Channel one question" }] },
    { role: "model", parts: [{ text: "Channel one answer" }] },
    { role: "user", parts: [{ text: "A Discord friend said: continue" }] },
  ]);
  assert.doesNotMatch(
    JSON.stringify(requests[0].contents),
    /Private unrelated question|Private unrelated answer/,
  );
});

test("a Gemini error sends the existing fallback without recording the request", async () => {
  const client = {
    user: { id: "bot-1", username: "Bondhu", globalName: null },
  };
  const conversationHistory = createConversationHistory();
  const replies = [];
  const loggedErrors = [];
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(0),
    conversationHistory,
    createReply: async () => {
      throw new Error("Gemini is unavailable");
    },
    logger: {
      error: (...args) => loggedErrors.push(args),
    },
  });

  await handler({
    author: { id: "member-1", bot: false },
    content: "<@bot-1> hello",
    channelId: "channel-1",
    mentions: { has: (user) => user.id === client.user.id },
    channel: { sendTyping: async () => {} },
    reply: async (payload) => replies.push(payload),
  });

  assert.equal(replies.length, 1);
  assert.equal(
    replies[0].content,
    "Ektu technical jhamela hocche, bondhu 😅 kichukhon por abar dakish!",
  );
  assert.deepEqual(replies[0].allowedMentions, { repliedUser: false });
  assert.deepEqual(conversationHistory.get("channel-1"), []);
  assert.equal(loggedErrors.length, 1);
  assert.match(loggedErrors[0][0], /Could not generate or send a reply/);
});

test("a failed Discord reply sends the existing fallback without recording the answer", async () => {
  const client = {
    user: { id: "bot-1", username: "Bondhu", globalName: null },
  };
  const conversationHistory = createConversationHistory();
  const replies = [];
  const loggedErrors = [];
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(0),
    conversationHistory,
    createReply: async () => "This answer could not be delivered",
    logger: {
      error: (...args) => loggedErrors.push(args),
    },
  });

  await handler({
    author: { id: "member-1", bot: false },
    content: "<@bot-1> hello",
    channelId: "channel-1",
    mentions: { has: (user) => user.id === client.user.id },
    channel: { sendTyping: async () => {} },
    reply: async (payload) => {
      replies.push(payload);
      if (replies.length === 1) throw new Error("Discord is unavailable");
    },
  });

  assert.equal(replies.length, 2);
  assert.equal(replies[0].content, "This answer could not be delivered");
  assert.equal(
    replies[1].content,
    "Ektu technical jhamela hocche, bondhu 😅 kichukhon por abar dakish!",
  );
  assert.deepEqual(replies[1].allowedMentions, { repliedUser: false });
  assert.deepEqual(conversationHistory.get("channel-1"), []);
  assert.equal(loggedErrors.length, 1);
  assert.match(loggedErrors[0][0], /Could not generate or send a reply/);
});

test("turns hashtag topics into a text-only image concept request", () => {
  const topics = extractHashtagTopics("#anime_meme #genshin_impact #news #anime_meme");
  const context = formatConversationMessage({
    content: "<@bot-1> #anime_meme #genshin_impact",
  });

  assert.deepEqual(topics, ["anime meme", "genshin impact", "news"]);
  assert.match(context, /anime meme, genshin impact/);
  assert.match(context, /No image-generation tool is connected/);
  assert.match(context, /Do not claim to generate or attach an actual image/);
});

test("quiz requests ask a question and evaluate the same member's unmentioned answer", async () => {
  const client = {
    user: { id: "bot-1", username: "Bondhu", globalName: null },
  };
  const quiz = {
    category: "general knowledge",
    question: "Bangladesh-er capital konta?",
    answer: "Dhaka",
    acceptedAnswers: ["Dhaka"],
  };
  const quizSessions = createQuizSessions();
  const replies = [];
  const geminiCalls = [];
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(30_000),
    conversationHistory: createConversationHistory(),
    quizSessions,
    selectQuizQuestion: () => quiz,
    createReply: async (...args) => {
      geminiCalls.push(args);
      return "Eta normal chat reply";
    },
  });

  function message({ userId = "member-1", content, addressed = false }) {
    return {
      author: { id: userId, bot: false },
      content,
      channelId: "channel-1",
      mentions: { has: (user) => addressed && user.id === client.user.id },
      channel: { sendTyping: async () => {} },
      reply: async (payload) => replies.push(payload),
    };
  }

  await handler(message({ content: "<@bot-1> ask me any question", addressed: true }));
  assert.match(replies[0].content, /Quiz mode on/);
  assert.match(replies[0].content, /Bangladesh-er capital konta/);
  assert.deepEqual(quizSessions.get("channel-1", "member-1"), quiz);

  await handler(message({ content: "Dhaka" }));
  assert.match(replies[1].content, /correct/i);
  assert.match(replies[1].content, /Dhaka/);
  assert.equal(quizSessions.get("channel-1", "member-1"), null);
  assert.equal(geminiCalls.length, 0);
});

test("another member cannot answer someone else's pending quiz", async () => {
  const client = {
    user: { id: "bot-1", username: "Bondhu", globalName: null },
  };
  const quiz = {
    category: "gaming",
    question: "Mario-r bhai-er naam ki?",
    answer: "Luigi",
    acceptedAnswers: ["Luigi"],
  };
  const quizSessions = createQuizSessions();
  const replies = [];
  const handler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(0),
    conversationHistory: createConversationHistory(),
    quizSessions,
    selectQuizQuestion: () => quiz,
    createReply: async () => "A normal reply",
  });
  const baseMessage = {
    channelId: "channel-1",
    mentions: { has: () => true },
    channel: { sendTyping: async () => {} },
    reply: async (payload) => replies.push(payload),
  };

  await handler({
    ...baseMessage,
    author: { id: "member-1", bot: false },
    content: "<@bot-1> quiz me",
  });
  await handler({
    ...baseMessage,
    author: { id: "member-2", bot: false },
    content: "Luigi",
    mentions: { has: () => false },
  });

  assert.equal(replies.length, 1);
  assert.deepEqual(quizSessions.get("channel-1", "member-1"), quiz);
});
