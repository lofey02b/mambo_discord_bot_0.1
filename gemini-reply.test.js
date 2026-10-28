const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeminiReply } = require("./gemini-reply");

test("sends prior user and bot turns before the newest user message", async () => {
  const requests = [];
  const createReply = createGeminiReply({
    ai: {
      models: {
        generateContent: async (request) => {
          requests.push(request);
          return { text: "  A follow-up answer.  " };
        },
      },
    },
    model: "test-model",
  });

  const reply = await createReply("Newest question", [
    { role: "user", text: "Earlier question" },
    { role: "model", text: "Earlier answer" },
    { role: "user", text: "Follow-up question" },
    { role: "model", text: "Follow-up answer" },
  ]);

  assert.equal(reply, "A follow-up answer.");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "test-model");
  assert.deepEqual(requests[0].contents, [
    { role: "user", parts: [{ text: "Earlier question" }] },
    { role: "model", parts: [{ text: "Earlier answer" }] },
    { role: "user", parts: [{ text: "Follow-up question" }] },
    { role: "model", parts: [{ text: "Follow-up answer" }] },
    { role: "user", parts: [{ text: "Newest question" }] },
  ]);
});
