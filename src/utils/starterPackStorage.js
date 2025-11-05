const STORAGE_PREFIX = "vgo_starterPack_";
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

export const DEFAULT_STARTER_PACK_STATE = {
  hasPostedFirst: false,
  hasCommented: false,
  upvoteCount: 0,
  dismissed: false,
};

const isBrowser = () => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const { localStorage } = window;
    return Boolean(localStorage);
  } catch (error) {
    if (isDev) {
      console.warn("StarterPack: localStorage unavailable", error);
    }
    return false;
  }
};

const getStorageKey = (userId) => `${STORAGE_PREFIX}${userId}`;

const normalizeState = (state = {}) => {
  const normalized = {
    ...DEFAULT_STARTER_PACK_STATE,
    ...(typeof state === "object" && state !== null ? state : {}),
  };

  normalized.hasPostedFirst = Boolean(normalized.hasPostedFirst);
  normalized.hasCommented = Boolean(normalized.hasCommented);
  normalized.dismissed = Boolean(normalized.dismissed);
  const parsedCount = Number.parseInt(normalized.upvoteCount, 10);
  normalized.upvoteCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 0;

  return normalized;
};

const dispatchUpdateEvent = (userId, state) => {
  if (!isBrowser()) return;
  try {
    const event = new CustomEvent("starterpack:update", {
      detail: { userId, state },
    });
    window.dispatchEvent(event);
  } catch (error) {
    // Ignore errors from CustomEvent in unsupported environments
    if (isDev) {
      console.warn("StarterPack: Unable to dispatch update event", error);
    }
  }
};

export const loadStarterPackState = (userId) => {
  if (!userId || !isBrowser()) {
    return { ...DEFAULT_STARTER_PACK_STATE };
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) {
      return { ...DEFAULT_STARTER_PACK_STATE };
    }

    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    if (isDev) {
      console.warn("StarterPack: Failed to load state", error);
    }
    return { ...DEFAULT_STARTER_PACK_STATE };
  }
};

export const saveStarterPackState = (userId, state) => {
  if (!userId || !isBrowser()) return null;

  try {
    const normalized = normalizeState(state);
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(normalized));
    dispatchUpdateEvent(userId, normalized);
    return normalized;
  } catch (error) {
    if (isDev) {
      console.warn("StarterPack: Failed to save state", error);
    }
    return null;
  }
};

export const updateStarterPackState = (userId, partialState = {}) => {
  if (!userId || !isBrowser()) return null;

  const currentState = loadStarterPackState(userId);
  const nextState = normalizeState({ ...currentState, ...partialState });
  return saveStarterPackState(userId, nextState);
};

export const markStarterPackPosted = (userId) => {
  if (!userId) return null;
  return updateStarterPackState(userId, { hasPostedFirst: true });
};

export const markStarterPackCommented = (userId) => {
  if (!userId) return null;
  return updateStarterPackState(userId, { hasCommented: true });
};

export const incrementStarterPackUpvotes = (userId, incrementBy = 1) => {
  if (!userId || incrementBy <= 0) return null;

  const currentState = loadStarterPackState(userId);
  const currentCount = currentState.upvoteCount || 0;
  const nextCount = Math.max(0, currentCount + Math.floor(incrementBy));
  return updateStarterPackState(userId, { upvoteCount: nextCount });
};

export const dismissStarterPack = (userId) => {
  if (!userId) return null;
  return updateStarterPackState(userId, { dismissed: true });
};

export const hasCompletedStarterPack = (state = DEFAULT_STARTER_PACK_STATE) => {
  const normalized = normalizeState(state);
  return (
    normalized.hasPostedFirst &&
    normalized.hasCommented &&
    normalized.upvoteCount >= 3
  );
};

export const shouldShowStarterPack = (userId, state = DEFAULT_STARTER_PACK_STATE) => {
  if (!userId) return false;
  const normalized = normalizeState(state);
  if (normalized.dismissed) return false;
  return !hasCompletedStarterPack(normalized);
};


