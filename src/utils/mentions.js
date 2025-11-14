import { doc, getDoc } from "firebase/firestore";

const HANDLE_REGEX = /@([A-Za-z0-9_-]{1,32})/g;
const handleCache = new Map();

export const normalizeHandle = (handle) =>
  (handle || "").trim().toLowerCase();

export const extractHandlesFromText = (text = "") => {
  if (!text) {
    return [];
  }
  const deduped = new Set();
  let match;
  while ((match = HANDLE_REGEX.exec(text))) {
    const token = normalizeHandle(match[1]);
    if (token) {
      deduped.add(token);
    }
  }
  return Array.from(deduped);
};

const fetchHandleDoc = async (db, handleLower) => {
  if (!db || !handleLower) {
    return null;
  }
  if (handleCache.has(handleLower)) {
    return handleCache.get(handleLower);
  }

  const ref = doc(db, "user_handles", handleLower);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() || {} : null;
  const payload = data
    ? {
      handle: data.handle || handleLower,
      handleLower,
      userId: data.userId || null,
      displayName: data.displayName || "",
      avatarUrl: data.avatarUrl || "",
    }
    : null;
  handleCache.set(handleLower, payload);
  return payload;
};

export const resolveHandlesToUsers = async (db, handles = []) => {
  if (!db || !Array.isArray(handles) || handles.length === 0) {
    return [];
  }
  const normalized = handles
    .map((handle) => normalizeHandle(handle))
    .filter(Boolean);
  if (normalized.length === 0) {
    return [];
  }
  const results = await Promise.all(
    normalized.map((handleLower) => fetchHandleDoc(db, handleLower))
  );
  return results.filter((entry) => entry?.userId);
};

export const buildMentionPayload = async (db, text = "", overrides = []) => {
  const handles = Array.isArray(overrides) && overrides.length
    ? overrides
    : extractHandlesFromText(text);

  if (!handles.length) {
    return {
      mentionUserIds: [],
      mentionMetadata: [],
    };
  }

  const resolved = await resolveHandlesToUsers(db, handles);
  const seen = new Set();
  const mentionUserIds = [];
  const mentionMetadata = [];

  resolved.forEach((entry) => {
    if (!entry?.userId || seen.has(entry.userId)) {
      return;
    }
    seen.add(entry.userId);
    mentionUserIds.push(entry.userId);
    mentionMetadata.push({
      handle: entry.handle,
      userId: entry.userId,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
    });
  });

  return { mentionUserIds, mentionMetadata };
};

export default {
  extractHandlesFromText,
  resolveHandlesToUsers,
  buildMentionPayload,
};
