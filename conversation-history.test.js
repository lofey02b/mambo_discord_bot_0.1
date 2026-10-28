const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createConversationHistory } = require("./conversation-history");

test("keeps recent turns separately for each channel or thread", () => {
  let currentTime = 1_000;
  const history = createConversationHistory({ now: () => currentTime });

  history.recordTurn("channel-1", "Hi", "Hello!");
  history.recordTurn("thread-1", "Different chat", "Different reply");

  assert.deepEqual(history.get("channel-1"), [
    { role: "user", text: "Hi" },
    { role: "model", text: "Hello!" },
  ]);
  assert.deepEqual(history.get("thread-1"), [
    { role: "user", text: "Different chat" },
    { role: "model", text: "Different reply" },
  ]);

  currentTime += 1;
  history.recordTurn("channel-1", "Follow-up", "Follow-up reply");
  assert.equal(history.get("channel-1").length, 4);
});

test("clears only the requested channel or thread history", () => {
  const history = createConversationHistory();
  history.recordTurn("channel-1", "Hi", "Hello!");
  history.recordTurn("thread-1", "Different chat", "Different reply");

  assert.equal(history.clear("channel-1"), true);
  assert.deepEqual(history.get("channel-1"), []);
  assert.deepEqual(history.get("thread-1"), [
    { role: "user", text: "Different chat" },
    { role: "model", text: "Different reply" },
  ]);
  assert.equal(history.clear("channel-1"), false);
});

test("expires history after the inactivity window", () => {
  let currentTime = 1_000;
  const history = createConversationHistory({
    ttlMs: 10,
    now: () => currentTime,
  });

  history.recordTurn("channel-1", "Hi", "Hello!");
  currentTime += 9;
  assert.equal(history.get("channel-1").length, 2);

  currentTime += 1;
  assert.deepEqual(history.get("channel-1"), []);
});

test("caps stored history at the configured number of complete turns", () => {
  const history = createConversationHistory({ maxMessages: 4 });

  history.recordTurn("channel-1", "First", "First reply");
  history.recordTurn("channel-1", "Second", "Second reply");
  history.recordTurn("channel-1", "Third", "Third reply");

  assert.deepEqual(history.get("channel-1"), [
    { role: "user", text: "Second" },
    { role: "model", text: "Second reply" },
    { role: "user", text: "Third" },
    { role: "model", text: "Third reply" },
  ]);
});

test("bounds the number of channel histories and evicts the least recently used", () => {
  let currentTime = 1_000;
  const history = createConversationHistory({
    maxConversations: 2,
    now: () => currentTime,
  });

  history.recordTurn("channel-1", "One", "One reply");
  currentTime += 1;
  history.recordTurn("channel-2", "Two", "Two reply");
  currentTime += 1;
  history.recordTurn("channel-1", "One again", "One reply again");
  currentTime += 1;
  history.recordTurn("channel-3", "Three", "Three reply");

  assert.equal(history.get("channel-1").length, 4);
  assert.deepEqual(history.get("channel-2"), []);
  assert.equal(history.get("channel-3").length, 2);
});

test("returns copies so callers cannot modify stored history", () => {
  const history = createConversationHistory();
  history.recordTurn("channel-1", "Hi", "Hello!");

  const messages = history.get("channel-1");
  messages[0].text = "Changed";
  messages.push({ role: "user", text: "Injected" });

  assert.deepEqual(history.get("channel-1"), [
    { role: "user", text: "Hi" },
    { role: "model", text: "Hello!" },
  ]);
});

test("restores recent turns after creating a new history instance", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-history-"));
  const storagePath = path.join(directory, "history.json");

  try {
    const firstRun = createConversationHistory({
      now: () => 1_000,
      storagePath,
    });
    firstRun.recordTurn("channel-1", "Hi", "Hello!");

    const restarted = createConversationHistory({
      now: () => 1_001,
      storagePath,
    });
    assert.deepEqual(restarted.get("channel-1"), [
      { role: "user", text: "Hi" },
      { role: "model", text: "Hello!" },
    ]);
    assert.equal(fs.statSync(storagePath).mode & 0o777, 0o600);

    restarted.clear("channel-1");
    const afterClear = createConversationHistory({
      now: () => 1_002,
      storagePath,
    });
    assert.deepEqual(afterClear.get("channel-1"), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("removes expired persisted history when starting after its inactivity window", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-history-"));
  const storagePath = path.join(directory, "history.json");

  try {
    createConversationHistory({
      now: () => 1_000,
      storagePath,
    }).recordTurn("channel-1", "Hi", "Hello!");

    const restarted = createConversationHistory({
      ttlMs: 10,
      now: () => 1_010,
      storagePath,
    });

    assert.deepEqual(restarted.get("channel-1"), []);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(storagePath, "utf8")).conversations,
      [],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects history limits that could split turns or leave histories unbounded", () => {
  assert.throws(() => createConversationHistory({ ttlMs: 0 }), RangeError);
  assert.throws(() => createConversationHistory({ maxMessages: 3 }), RangeError);
  assert.throws(() => createConversationHistory({ maxConversations: 0 }), RangeError);
  assert.throws(() => createConversationHistory({ storagePath: "" }), TypeError);
});
