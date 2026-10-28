function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const {
  chooseQuizQuestion,
  createQuizSessions,
  formatQuizPrompt,
  formatQuizResult,
  isQuizRequest,
} = require("./quiz-mode");

function wasAddressed(message, client, botName) {
  if (message.mentions.has(client.user)) return true;

  const possibleNames = [
    botName,
    client.user.username,
    client.user.globalName,
  ].filter(Boolean);
  const content = message.content.toLocaleLowerCase();

  return possibleNames.some((name) => {
    const escapedName = escapeRegExp(name.trim().toLocaleLowerCase());
    if (!escapedName) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapedName}([^\\p{L}\\p{N}_]|$)`, "u").test(
      content,
    );
  });
}

function removeBotMentions(content) {
  return content.replace(/<@!?\d+>/g, "").trim();
}

function formatConversationMessage(message) {
  const userMessage = removeBotMentions(message.content);
  const conversation = `A Discord friend said: ${
    userMessage || "The user mentioned you but did not add a message."
  }`;
  const imageTopics = extractHashtagTopics(userMessage);

  if (imageTopics.length === 0) return conversation;

  return [
    conversation,
    `Image-request topics from hashtags: ${imageTopics.join(", ")}.`,
    "No image-generation tool is connected. Playfully acknowledge that you can only describe it in text, then describe a funny image or meme concept based on those topics in Banglish.",
    "Do not claim to generate or attach an actual image.",
  ].join("\n");
}

function extractHashtagTopics(content) {
  const topics = new Set();
  for (const match of content.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const topic = match[1].replaceAll("_", " ").replace(/\s+/g, " ").trim();
    if (topic) topics.add(topic);
  }
  return [...topics];
}

function removeLeadingBotName(content, client, botName) {
  let result = removeBotMentions(content);
  const possibleNames = [botName, client.user.username, client.user.globalName].filter(Boolean);

  for (const name of possibleNames) {
    const prefix = new RegExp(
      `^\\s*${escapeRegExp(name.trim())}(?:\\s*[,!:.-]\\s*|\\s+)`,
      "iu",
    );
    result = result.replace(prefix, "").trim();
  }
  return result;
}

function createMessageHandler({
  client,
  botName,
  userCooldown,
  conversationHistory,
  createReply,
  quizSessions = createQuizSessions(),
  selectQuizQuestion = chooseQuizQuestion,
  logger = console,
}) {
  return async function handleMessage(message) {
    if (message.author.bot) return;

    const addressed = wasAddressed(message, client, botName);
    const quizRequest = addressed && isQuizRequest(message.content);
    const pendingQuiz = quizSessions.get(message.channelId, message.author.id);

    if (!addressed && !pendingQuiz) return;

    if (quizRequest) {
      const cooldown = userCooldown.check(message.author.id);
      if (!cooldown.allowed) {
        const secondsRemaining = Math.ceil(cooldown.remainingMs / 1000);
        await message
          .reply({
            content: `Ektu wait kor na, bondhu 😅 ${secondsRemaining} sec por abar dakish!`,
            allowedMentions: { repliedUser: false },
          })
          .catch((error) => logger.error("Could not send cooldown reply:", error));
        return;
      }

      const quiz = selectQuizQuestion();
      quizSessions.start(message.channelId, message.author.id, quiz);
      await message
        .reply({
          content: formatQuizPrompt(quiz),
          allowedMentions: { repliedUser: false },
        })
        .catch((error) => logger.error("Could not send quiz question:", error));
      return;
    }

    if (pendingQuiz) {
      quizSessions.take(message.channelId, message.author.id);
      const answer = removeLeadingBotName(message.content, client, botName);
      await message
        .reply({
          content: formatQuizResult(pendingQuiz, answer),
          allowedMentions: { repliedUser: false },
        })
        .catch((error) => logger.error("Could not send quiz result:", error));
      return;
    }

    if (!addressed) return;

    const cooldown = userCooldown.check(message.author.id);
    if (!cooldown.allowed) {
      const secondsRemaining = Math.ceil(cooldown.remainingMs / 1000);
      await message
        .reply({
          content: `Ektu wait kor na, bondhu 😅 ${secondsRemaining} sec por abar dakish!`,
          allowedMentions: { repliedUser: false },
        })
        .catch((error) => logger.error("Could not send cooldown reply:", error));
      return;
    }

    try {
      await message.channel.sendTyping();
      const context = formatConversationMessage(message);
      const history = conversationHistory.get(message.channelId);
      const reply = await createReply(context, history);
      const sentReply = reply.slice(0, 2000);
      await message.reply({
        content: sentReply,
        allowedMentions: { repliedUser: false },
      });
      conversationHistory.recordTurn(message.channelId, context, sentReply);
    } catch (error) {
      logger.error("Could not generate or send a reply:", error);
      await message
        .reply({
          content: "Ektu technical jhamela hocche, bondhu 😅 kichukhon por abar dakish!",
          allowedMentions: { repliedUser: false },
        })
        .catch((sendError) =>
          logger.error("Could not send fallback reply:", sendError),
        );
    }
  };
}

module.exports = {
  createMessageHandler,
  extractHashtagTopics,
  formatConversationMessage,
  wasAddressed,
};
