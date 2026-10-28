const test = require("node:test");
const assert = require("node:assert/strict");
const { createConversationHistory } = require("./conversation-history");
const {
  CLEAR_CONTEXT_COMMAND,
  HELP_COMMAND,
  createConversationCommandHandler,
  registerBotCommands,
} = require("./clear-context-command");
const { createMessageHandler } = require("./message-handler");
const { createQuizSessions } = require("./quiz-mode");
const { createUserCooldown } = require("./user-cooldown");

test("startup fetches registered commands before creating missing bot commands", async () => {
  const registeredCommands = [];
  const calls = [];
  const commands = {
    async fetch() {
      calls.push("fetch");
      return registeredCommands;
    },
    async create(command) {
      calls.push("create");
      registeredCommands.push(command);
    },
  };

  assert.equal(await registerBotCommands(commands), true);
  assert.deepEqual(calls, ["fetch", "create", "create"]);
  assert.deepEqual(registeredCommands, [HELP_COMMAND, CLEAR_CONTEXT_COMMAND]);
});

test("startup does not create duplicate bot commands on later runs", async () => {
  const registeredCommands = [];
  let createCalls = 0;
  const commands = {
    async fetch() {
      return registeredCommands;
    },
    async create(command) {
      createCalls += 1;
      registeredCommands.push(command);
    },
  };

  assert.equal(await registerBotCommands(commands), true);
  assert.equal(await registerBotCommands(commands), true);

  assert.equal(createCalls, 2);
  assert.equal(registeredCommands.length, 2);
});

test("startup reports command lookup and creation failures", async (t) => {
  for (const failureStage of ["fetch", "create"]) {
    await t.test(`${failureStage} failure`, async () => {
      const error = new Error(`${failureStage} failed`);
      const loggedErrors = [];
      const logger = {
        error: (...args) => loggedErrors.push(args),
      };
      const commands = {
        async fetch() {
          if (failureStage === "fetch") throw error;
          return [];
        },
        async create() {
          throw error;
        },
      };

      assert.equal(
        await registerBotCommands(commands, { logger }),
        false,
      );
      assert.equal(loggedErrors.length, 1);
      assert.ok(
        loggedErrors[0][0].includes(
          "Could not register the bot commands",
        ),
      );
      assert.equal(loggedErrors[0][1], error);
    });
  }
});

test("startup updates the description of an existing command", async () => {
  let editPayload;
  let createCalls = 0;
  const commands = {
    async fetch() {
      return [
        {
          name: HELP_COMMAND.name,
          description: HELP_COMMAND.description,
        },
        {
          name: CLEAR_CONTEXT_COMMAND.name,
          description: "Old description",
          async edit(payload) {
            editPayload = payload;
          },
        },
      ];
    },
    async create() {
      createCalls += 1;
    },
  };

  assert.equal(await registerBotCommands(commands), true);
  assert.deepEqual(editPayload, {
    description: CLEAR_CONTEXT_COMMAND.description,
  });
  assert.equal(createCalls, 0);
});

test("the clear-context command clears only the interaction's channel or thread", async () => {
  const conversationHistory = createConversationHistory();
  conversationHistory.recordTurn("channel-1", "Hi", "Hello!");
  conversationHistory.recordTurn("thread-1", "Different chat", "Different reply");
  const quizSessions = createQuizSessions();
  const quiz = {
    category: "gaming",
    question: "Mario-r bhai ke?",
    answer: "Luigi",
    acceptedAnswers: ["Luigi"],
  };
  quizSessions.start("channel-1", "member-1", quiz);
  quizSessions.start("thread-1", "member-1", quiz);
  const replies = [];
  const handler = createConversationCommandHandler({ conversationHistory, quizSessions });

  await handler({
    isChatInputCommand: () => true,
    commandName: CLEAR_CONTEXT_COMMAND.name,
    channelId: "channel-1",
    reply: async (payload) => replies.push(payload),
  });

  assert.deepEqual(conversationHistory.get("channel-1"), []);
  assert.deepEqual(conversationHistory.get("thread-1"), [
    { role: "user", text: "Different chat" },
    { role: "model", text: "Different reply" },
  ]);
  assert.equal(quizSessions.get("channel-1", "member-1"), null);
  assert.deepEqual(quizSessions.get("thread-1", "member-1"), quiz);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ephemeral, true);
  assert.match(replies[0].content, /fresh start/i);

  let historySentToGemini;
  const client = { user: { id: "bot-1", username: "Bondhu", globalName: null } };
  const messageHandler = createMessageHandler({
    client,
    botName: "Bondhu",
    userCooldown: createUserCooldown(0),
    conversationHistory,
    createReply: async (_context, history) => {
      historySentToGemini = history;
      return "Fresh reply";
    },
  });
  await messageHandler({
    author: { id: "member-1", bot: false },
    content: "<@bot-1> new topic",
    channelId: "channel-1",
    mentions: { has: (user) => user.id === client.user.id },
    channel: { sendTyping: async () => {} },
    reply: async () => {},
  });

  assert.deepEqual(historySentToGemini, []);
});

test("/help privately explains how to chat and reset this channel or thread", async () => {
  const replies = [];
  let clearCalls = 0;
  const handler = createConversationCommandHandler({
    conversationHistory: {
      clear() {
        clearCalls += 1;
      },
    },
  });

  await handler({
    isChatInputCommand: () => true,
    commandName: HELP_COMMAND.name,
    reply: async (payload) => replies.push(payload),
  });

  assert.equal(replies.length, 1);
  assert.equal(replies[0].ephemeral, true);
  assert.match(replies[0].content, /mention/i);
  assert.match(replies[0].content, /\/clear-context/);
  assert.match(replies[0].content, /channel\/thread/i);
  assert.equal(clearCalls, 0);
});

test("the conversation command handler ignores other interactions", async () => {
  let clearCalls = 0;
  const handler = createConversationCommandHandler({
    conversationHistory: {
      clear() {
        clearCalls += 1;
      },
    },
  });

  await handler({
    isChatInputCommand: () => false,
    commandName: CLEAR_CONTEXT_COMMAND.name,
    channelId: "channel-1",
  });
  await handler({
    isChatInputCommand: () => true,
    commandName: "another-command",
    channelId: "channel-1",
  });

  assert.equal(clearCalls, 0);
});
