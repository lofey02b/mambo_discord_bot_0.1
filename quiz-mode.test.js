const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chooseQuizQuestion,
  createQuizSessions,
  formatQuizResult,
  isQuizRequest,
} = require("./quiz-mode");

test("recognizes common quiz and question requests", () => {
  assert.equal(isQuizRequest("ask me quiz"), true);
  assert.equal(isQuizRequest("ask me any question"), true);
  assert.equal(isQuizRequest("quiz me"), true);
  assert.equal(isQuizRequest("let's play a quiz"), true);
  assert.equal(isQuizRequest("what's the weather?"), false);
});

test("chooses a question from the supported quiz categories", () => {
  assert.equal(chooseQuizQuestion(() => 0).category, "anime");
  assert.equal(chooseQuizQuestion(() => 1).category, "pop culture");
  assert.throws(() => chooseQuizQuestion(() => 1.1), RangeError);
});

test("praises a correct answer and playfully roasts an incorrect one", () => {
  const quiz = {
    question: "Luffy-r goal ki?",
    answer: "Pirate King",
    acceptedAnswers: ["Pirate King", "King of the Pirates"],
  };

  assert.match(formatQuizResult(quiz, "king of the pirates"), /correct/i);
  assert.match(formatQuizResult(quiz, "Navy Admiral"), /thik uttor chilo Pirate King/i);
});

test("stores quiz sessions per member and channel and clears a channel", () => {
  const sessions = createQuizSessions();
  const quiz = {
    category: "general knowledge",
    question: "Bangladesh-er capital konta?",
    answer: "Dhaka",
    acceptedAnswers: ["Dhaka"],
  };

  sessions.start("channel-1", "member-1", quiz);
  sessions.start("channel-1", "member-2", quiz);
  sessions.start("thread-1", "member-1", quiz);

  assert.equal(sessions.clearChannel("channel-1"), 2);
  assert.equal(sessions.get("channel-1", "member-1"), null);
  assert.deepEqual(sessions.get("thread-1", "member-1"), quiz);
});

test("expires quiz sessions after the inactivity window", () => {
  let currentTime = 1_000;
  const sessions = createQuizSessions({ ttlMs: 50, now: () => currentTime });
  const quiz = {
    category: "gaming",
    question: "Mario-r bhai ke?",
    answer: "Luigi",
    acceptedAnswers: ["Luigi"],
  };

  sessions.start("channel-1", "member-1", quiz);
  currentTime += 50;

  assert.equal(sessions.take("channel-1", "member-1"), null);
});
