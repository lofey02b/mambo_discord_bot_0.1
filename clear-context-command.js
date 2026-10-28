const CLEAR_CONTEXT_COMMAND = {
  name: "clear-context",
  description: "Ei channel ba thread-er chat context bhule notun kore shuru.",
};

const HELP_COMMAND = {
  name: "help",
  description: "Bondhu-r sathe chat shuru kora ebong context reset korar niyom.",
};

const BOT_COMMANDS = [HELP_COMMAND, CLEAR_CONTEXT_COMMAND];

async function registerBotCommands(commands, { logger = console } = {}) {
  try {
    const registeredCommands = await commands.fetch();

    for (const commandDefinition of BOT_COMMANDS) {
      const registeredCommand = registeredCommands.find(
        (command) => command.name === commandDefinition.name,
      );

      if (!registeredCommand) {
        await commands.create(commandDefinition);
      } else if (registeredCommand.description !== commandDefinition.description) {
        await registeredCommand.edit({
          description: commandDefinition.description,
        });
      }
    }

    return true;
  } catch (error) {
    logger.error("Could not register the bot commands:", error);
    return false;
  }
}

function createConversationCommandHandler({
  conversationHistory,
  quizSessions,
  logger = console,
}) {
  return async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === HELP_COMMAND.name) {
      await interaction
        .reply({
          content:
            "Amake mention kore message pathale chat shuru hobe.\n" +
            "Ei channel/thread-er chat notun kore shuru korte `/clear-context` use koro; " +
            "eta shudhu ei channel/thread-er context clear kore.",
          ephemeral: true,
        })
        .catch((error) => logger.error("Could not send the /help reply:", error));
      return;
    }

    if (interaction.commandName === CLEAR_CONTEXT_COMMAND.name) {
      conversationHistory.clear(interaction.channelId);
      quizSessions?.clearChannel(interaction.channelId);
      await interaction
        .reply({
          content: "Done dost, ei channel-er purono context bhule gesi. Ekhon fresh start!",
          ephemeral: true,
        })
        .catch((error) => logger.error("Could not confirm cleared context:", error));
    }
  };
}

module.exports = {
  CLEAR_CONTEXT_COMMAND,
  HELP_COMMAND,
  createConversationCommandHandler,
  registerBotCommands,
};
