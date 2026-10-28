const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 500;

const QUIZ_QUESTIONS = [
  {
    category: "anime",
    question: "One Piece-e Luffy-r main goal ki?",
    answer: "Pirate King",
    acceptedAnswers: ["Pirate King", "King of the Pirates"],
  },
  {
    category: "anime",
    question: "Naruto-r Uchiha clan-er iconic eye power-er naam ki?",
    answer: "Sharingan",
    acceptedAnswers: ["Sharingan"],
  },
  {
    category: "gaming",
    question: "Minecraft-er default player character-er naam ki?",
    answer: "Steve",
    acceptedAnswers: ["Steve"],
  },
  {
    category: "gaming",
    question: "Mario-r plumber bhai-er naam ki?",
    answer: "Luigi",
    acceptedAnswers: ["Luigi"],
  },
  {
    category: "general knowledge",
    question: "Bangladesh-er capital konta?",
    answer: "Dhaka",
    acceptedAnswers: ["Dhaka"],
  },
  {
    category: "pop culture",
    question: "Harry Potter je magic school-e pore, shetar naam ki?",
    answer: "Hogwarts",
    acceptedAnswers: ["Hogwarts", "Hogwarts School"],
  },
];

function cloneQuiz(quiz) {
  return {
    category: quiz.category,
    question: quiz.question,
    answer: quiz.answer,
    acceptedAnswers: [...quiz.acceptedAnswers],
  };
}

function isQuizRequest(content) {
  return /\b(?:ask\s+me\s+(?:(?:a|any)\s+)?(?:quiz|questions?|something)|(?:quiz|test)\s+me|give\s+me\s+(?:(?:a|any)\s+)?(?:quiz|trivia|questions?)|start\s+(?:a\s+)?quiz|quiz\s+time|let'?s\s+(?:do|play)\s+(?:a\s+)?quiz)\b/i.test(
    content,
  );
}

function chooseQuizQuestion(random = Math.random) {
  const randomValue = random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new RangeError("random must return a number between 0 and 1.");
  }
  const index = Math.min(
    QUIZ_QUESTIONS.length - 1,
    Math.floor(randomValue * QUIZ_QUESTIONS.length),
  );
  return cloneQuiz(QUIZ_QUESTIONS[index]);
}

function normalizeAnswer(answer) {
  return answer
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isCorrectQuizAnswer(quiz, answer) {
  const normalizedAnswer = normalizeAnswer(answer);
  return quiz.acceptedAnswers.some(
    (acceptedAnswer) => normalizeAnswer(acceptedAnswer) === normalizedAnswer,
  );
}

function formatQuizPrompt(quiz) {
  return `Quiz mode on, dost! Proshno: ${quiz.question}\nAnswer diye dekhi, brain cell ghumacche naki overtime kore 😏`;
}

function formatQuizResult(quiz, userAnswer) {
  if (isCorrectQuizAnswer(quiz, userAnswer)) {
    return `Ayyyy, correct! ${quiz.answer} eita! Brain cell ajke overtime koreche mone hocche 😎 Aro quiz chaile abar dakish!`;
  }
  return `Areh na re dost, thik uttor chilo ${quiz.answer}. Confidence full marks, answer ta abar chhuti te gesilo 😂 Aro quiz chaile abar dakish!`;
}

function createQuizSessions({
  ttlMs = DEFAULT_TTL_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  now = Date.now,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a number greater than 0.");
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new RangeError("maxSessions must be an integer greater than or equal to 1.");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function.");
  }

  const sessionsByChannel = new Map();

  function validateIds(channelId, userId) {
    if (typeof channelId !== "string" || channelId.length === 0) {
      throw new TypeError("channelId must be a non-empty string.");
    }
    if (typeof userId !== "string" || userId.length === 0) {
      throw new TypeError("userId must be a non-empty string.");
    }
  }

  function sessionCount() {
    let count = 0;
    for (const users of sessionsByChannel.values()) count += users.size;
    return count;
  }

  function removeExpired(currentTime) {
    for (const [channelId, users] of sessionsByChannel) {
      for (const [userId, session] of users) {
        if (currentTime - session.updatedAt >= ttlMs) users.delete(userId);
      }
      if (users.size === 0) sessionsByChannel.delete(channelId);
    }
  }

  function evictOldest() {
    let oldestChannelId;
    let oldestUserId;
    let oldestUpdatedAt = Infinity;

    for (const [channelId, users] of sessionsByChannel) {
      for (const [userId, session] of users) {
        if (session.updatedAt < oldestUpdatedAt) {
          oldestChannelId = channelId;
          oldestUserId = userId;
          oldestUpdatedAt = session.updatedAt;
        }
      }
    }

    const users = sessionsByChannel.get(oldestChannelId);
    users?.delete(oldestUserId);
    if (users?.size === 0) sessionsByChannel.delete(oldestChannelId);
  }

  return {
    get(channelId, userId) {
      validateIds(channelId, userId);
      removeExpired(now());
      const session = sessionsByChannel.get(channelId)?.get(userId);
      return session ? cloneQuiz(session.quiz) : null;
    },

    start(channelId, userId, quiz) {
      validateIds(channelId, userId);
      if (
        !quiz ||
        typeof quiz.question !== "string" ||
        typeof quiz.answer !== "string" ||
        !Array.isArray(quiz.acceptedAnswers)
      ) {
        throw new TypeError("quiz must include a question, answer, and acceptedAnswers.");
      }

      const currentTime = now();
      removeExpired(currentTime);
      let users = sessionsByChannel.get(channelId);
      if (!users) {
        users = new Map();
        sessionsByChannel.set(channelId, users);
      }
      if (!users.has(userId) && sessionCount() >= maxSessions) evictOldest();
      users = sessionsByChannel.get(channelId) || new Map();
      sessionsByChannel.set(channelId, users);
      users.set(userId, { quiz: cloneQuiz(quiz), updatedAt: currentTime });
    },

    take(channelId, userId) {
      const quiz = this.get(channelId, userId);
      if (quiz) this.clear(channelId, userId);
      return quiz;
    },

    clear(channelId, userId) {
      validateIds(channelId, userId);
      const users = sessionsByChannel.get(channelId);
      if (!users) return false;
      const deleted = users.delete(userId);
      if (users.size === 0) sessionsByChannel.delete(channelId);
      return deleted;
    },

    clearChannel(channelId) {
      if (typeof channelId !== "string" || channelId.length === 0) {
        throw new TypeError("channelId must be a non-empty string.");
      }
      const users = sessionsByChannel.get(channelId);
      if (!users) return 0;
      const count = users.size;
      sessionsByChannel.delete(channelId);
      return count;
    },
  };
}

module.exports = {
  chooseQuizQuestion,
  createQuizSessions,
  formatQuizPrompt,
  formatQuizResult,
  isQuizRequest,
};
