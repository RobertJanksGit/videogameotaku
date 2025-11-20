import { useEffect, useState, useCallback } from "react";

const VISIT_COUNT_KEY = "vgo_visitCount";
const BANNER_DISMISSED_KEY = "vgo_joinBannerDismissed";

const getSafeStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
};

const parseIntOrZero = (value) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
};

/**
 * Tracks visit count and dismissal state for the "Join the community" banner.
 *
 * - Increments a visit counter on mount (per browser).
 * - Considers a visitor "returning" when visitCount >= 2.
 * - Persists dismissal so the banner will not reappear once dismissed.
 *
 * All localStorage access is guarded to avoid SSR/window issues.
 */
const useReturningVisitorBannerState = () => {
  const [visitCount, setVisitCount] = useState(null);
  const [hasDismissedBanner, setHasDismissedBanner] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const storage = getSafeStorage();
    if (!storage) {
      // Storage unavailable (SSR or disabled) – treat as first visit and never show banner.
      setVisitCount(1);
      setHasDismissedBanner(false);
      setIsReady(true);
      return;
    }

    try {
      const rawCount = storage.getItem(VISIT_COUNT_KEY);
      const currentCount = rawCount ? parseIntOrZero(rawCount) : 0;
      const nextCount = currentCount + 1;
      storage.setItem(VISIT_COUNT_KEY, String(nextCount));
      setVisitCount(nextCount);
    } catch {
      // If storage fails, still assume at least one visit this session.
      setVisitCount(1);
    }

    try {
      const dismissed = storage.getItem(BANNER_DISMISSED_KEY) === "true";
      setHasDismissedBanner(dismissed);
    } catch {
      setHasDismissedBanner(false);
    }

    setIsReady(true);
  }, []);

  const dismissBanner = useCallback(() => {
    const storage = getSafeStorage();
    try {
      storage?.setItem(BANNER_DISMISSED_KEY, "true");
    } catch {
      // Ignore storage write failures; rely on in-memory state.
    }
    setHasDismissedBanner(true);
  }, []);

  const isReturningVisitor =
    typeof visitCount === "number" && Number.isFinite(visitCount)
      ? visitCount >= 2
      : false;

  return {
    isReturningVisitor,
    hasDismissedBanner,
    dismissBanner,
    isReady,
  };
};

export default useReturningVisitorBannerState;



