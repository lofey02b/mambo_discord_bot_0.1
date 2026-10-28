require("dotenv").config();

const path = require("node:path");
const {
  Client,
  GatewayIntentBits,
  Partials,
} = require("discord.js");
const { GoogleGenAI } = require("@google/genai");
const { createUserCooldown } = require("./user-cooldown");
const { createConversationHistory } = require("./conversation-history");
const { createGeminiReply } = require("./gemini-reply");
const { createMessageHandler } = require("./message-handler");
const { createQuizSessions } = require("./quiz-mode");
const {
  createConversationCommandHandler,
  registerBotCommands,
} = require("./clear-context-command");

const discordToken = process.env.DISCORD_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;
const botName = (process.env.BOT_NAME || "Bondhu").trim();
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const userCooldownSeconds = Number(process.env.USER_COOLDOWN_SECONDS ?? "30");
const conversationHistoryFile =
  process.env.CONVERSATION_HISTORY_FILE ||
  path.join(__dirname, ".data", "conversation-history.json");

if (!Number.isFinite(userCooldownSeconds) || userCooldownSeconds < 0) {
  throw new Error("USER_COOLDOWN_SECONDS must be a number greater than or equal to 0.");
}

function isPlaceholder(value) {
  return !value || /^(your_|replace_with_)/i.test(value);
}

if (isPlaceholder(discordToken)) {
  throw new Error("Set DISCORD_TOKEN in Replit Secrets or your local .env file before starting the bot.");
}

if (isPlaceholder(geminiApiKey)) {
  throw new Error("Set GEMINI_API_KEY in Replit Secrets or your local .env file before starting the bot.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const ai = new GoogleGenAI({ apiKey: geminiApiKey });
const userCooldown = createUserCooldown(userCooldownSeconds * 1000);
const conversationHistory = createConversationHistory({
  storagePath: conversationHistoryFile,
});
const createReply = createGeminiReply({ ai, model: geminiModel });
const quizSessions = createQuizSessions();

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}. Listening for ${botName} or mentions.`);
  await registerBotCommands(client.application.commands);
});

client.on(
  "interactionCreate",
  createConversationCommandHandler({ conversationHistory, quizSessions }),
);

client.on(
  "messageCreate",
  createMessageHandler({
    client,
    botName,
    userCooldown,
    conversationHistory,
    quizSessions,
    createReply,
  }),
);

client.login(discordToken).catch((error) => {
  console.error("Discord login failed. Check DISCORD_TOKEN and bot settings.", error);
  process.exitCode = 1;
});
