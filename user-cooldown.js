function createUserCooldown(cooldownMs) {
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new RangeError("cooldownMs must be a number greater than or equal to 0.");
  }

  const nextAllowedAtByUser = new Map();

  return {
    check(userId, now = Date.now()) {
      if (cooldownMs === 0) {
        return { allowed: true, remainingMs: 0 };
      }

      const nextAllowedAt = nextAllowedAtByUser.get(userId) ?? 0;
      if (nextAllowedAt > now) {
        return { allowed: false, remainingMs: nextAllowedAt - now };
      }

      // Record synchronously before the caller starts any async work.
      nextAllowedAtByUser.set(userId, now + cooldownMs);
      return { allowed: true, remainingMs: 0 };
    },
  };
}

module.exports = { createUserCooldown };
