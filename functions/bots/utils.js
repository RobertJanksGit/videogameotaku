/** General-purpose bot utilities. */

export const clamp01 = (value) => Math.max(0, Math.min(1, value));

export const randomFloat = (min = 0, max = 1) => Math.random() * (max - min) + min;

export const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export const minutesToMs = (minutes) => minutes * 60 * 1000;

/**
 * Pick a random delay between configured bounds in minutes, returning ms.
 */
export const getDelayFromRange = ({ min, max }) => {
  if (typeof min !== "number" || typeof max !== "number") {
    return minutesToMs(5);
  }
  if (max < min) {
    return minutesToMs(min);
  }
  const delayMinutes = randomFloat(min, max);
  return Math.round(minutesToMs(delayMinutes));
};

/**
 * Fisher-Yates shuffle copy.
 */
export const shuffle = (items) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const pickRandomSubset = (items, maxCount) => {
  if (!Array.isArray(items) || maxCount <= 0) return [];
  if (items.length <= maxCount) return [...items];
  return shuffle(items).slice(0, maxCount);
};

/**
 * Weighted random choice where weights is an object mapping keys to numbers.
 */
export const weightedChoice = (weights) => {
  if (!weights || typeof weights !== "object") {
    return null;
  }

  const entries = Object.entries(weights).filter(([, weight]) =>
    Number.isFinite(weight) && weight > 0
  );

  if (entries.length === 0) {
    return null;
  }

  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const target = Math.random() * total;
  let cumulative = 0;

  for (const [key, weight] of entries) {
    cumulative += weight;
    if (target <= cumulative) {
      return key;
    }
  }

  return entries[entries.length - 1][0];
};

export const nowMs = () => Date.now();

export const msSince = (timestamp) => nowMs() - timestamp;

export const isWithinCooldown = (lastEngagedAt, cooldownMinutes) => {
  if (!Number.isFinite(lastEngagedAt)) return false;
  const cooldownMs = minutesToMs(cooldownMinutes);
  return nowMs() - lastEngagedAt < cooldownMs;
};
