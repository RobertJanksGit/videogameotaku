import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DRAFT_PREFIX = "commentDraft";

const buildDraftKey = (postId, parentCommentId = null) => {
  if (!postId) {
    return null;
  }

  if (parentCommentId) {
    return `${DRAFT_PREFIX}:${postId}:reply:${parentCommentId}`;
  }

  return `${DRAFT_PREFIX}:${postId}`;
};

const readDraftFromStorage = (key) => {
  if (typeof window === "undefined" || !key) {
    return "";
  }

  try {
    return window.localStorage.getItem(key) ?? "";
  } catch (error) {
    console.warn("Unable to read comment draft from storage", error);
    return "";
  }
};

const writeDraftToStorage = (key, value) => {
  if (typeof window === "undefined" || !key) {
    return;
  }

  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn("Unable to persist comment draft", error);
  }
};

/**
 * Manages a single comment draft scoped by post and optional parent comment.
 *
 * @param {string} postId - The ID of the post the comment belongs to.
 * @param {string|null} parentCommentId - Optional parent comment ID for replies.
 */
export default function useCommentDraft(postId, parentCommentId = null) {
  const storageKey = useMemo(
    () => buildDraftKey(postId, parentCommentId),
    [postId, parentCommentId]
  );

  const [draft, setDraft] = useState(() => readDraftFromStorage(storageKey));
  const [hasRestored, setHasRestored] = useState(Boolean(draft));
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    const storedDraft = readDraftFromStorage(storageKey);
    setDraft(storedDraft);
    setHasRestored(Boolean(storedDraft));
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      writeDraftToStorage(storageKey, draft);
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [draft, storageKey]);

  const updateDraft = useCallback((nextValue) => {
    setDraft(nextValue);
  }, []);

  const clearDraft = useCallback(() => {
    setDraft("");
    writeDraftToStorage(storageKey, "");
    setHasRestored(false);
  }, [storageKey]);

  const replaceDraft = useCallback(
    (nextValue) => {
      setDraft(nextValue);
      writeDraftToStorage(storageKey, nextValue);
      setHasRestored(Boolean(nextValue));
    },
    [storageKey]
  );

  return {
    draft,
    setDraft: updateDraft,
    clearDraft,
    replaceDraft,
    hasRestored,
    storageKey,
  };
}

export { buildDraftKey };




















