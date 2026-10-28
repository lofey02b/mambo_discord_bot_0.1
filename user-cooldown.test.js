const test = require("node:test");
const assert = require("node:assert/strict");
const { createUserCooldown } = require("./user-cooldown");

test("allows the first request and rejects another from the same user during cooldown", () => {
  const cooldown = createUserCooldown(30_000);

  assert.deepEqual(cooldown.check("user-1", 1_000), {
    allowed: true,
    remainingMs: 0,
  });
  assert.deepEqual(cooldown.check("user-1", 1_000), {
    allowed: false,
    remainingMs: 30_000,
  });
});

test("allows the same user again once the cooldown expires", () => {
  const cooldown = createUserCooldown(30_000);

  cooldown.check("user-1", 1_000);

  assert.deepEqual(cooldown.check("user-1", 31_000), {
    allowed: true,
    remainingMs: 0,
  });
});

test("applies cooldowns independently per user", () => {
  const cooldown = createUserCooldown(30_000);

  cooldown.check("user-1", 1_000);

  assert.deepEqual(cooldown.check("user-2", 1_000), {
    allowed: true,
    remainingMs: 0,
  });
});

test("disables cooldown when configured as zero", () => {
  const cooldown = createUserCooldown(0);

  assert.equal(cooldown.check("user-1", 1_000).allowed, true);
  assert.equal(cooldown.check("user-1", 1_000).allowed, true);
});

test("rejects invalid cooldown durations", () => {
  assert.throws(() => createUserCooldown(-1), RangeError);
  assert.throws(() => createUserCooldown(Number.NaN), RangeError);
});
