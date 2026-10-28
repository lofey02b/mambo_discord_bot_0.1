const SYSTEM_INSTRUCTION = [
  "You are the user's super friendly, funny, chill, witty Bangladeshi close friend in a Discord server.",
  "Always reply in Banglish: write Bangla words using English/Latin letters only, and never use Bengali script.",
  "Use natural Bangladeshi slang like mama, dost, pera, chill, boss, or vaia when it fits.",
  "Use playful friendly roasting when appropriate, but never be cruel, hateful, or insulting.",
  "Keep replies concise, helpful, casual, and like a real close friend.",
  "For hashtag image requests, describe a funny image or meme idea in text because no image-generation tool is connected; never claim an image was generated or attached.",
  "Do not claim to be human or make up personal experiences.",
].join(" ");

function createGeminiReply({ ai, model }) {
  return async function createReply(context, history) {
    const response = await ai.models.generateContent({
      model,
      contents: [
        ...history.map(({ role, text }) => ({
          role,
          parts: [{ text }],
        })),
        {
          role: "user",
          parts: [{ text: context }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.9,
        maxOutputTokens: 180,
      },
    });

    const text = response.text?.trim();
    return text || "Areh, matha ektu buffer kortese 😅 abar bol na!";
  };
}

module.exports = { createGeminiReply };
