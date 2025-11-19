import { useEffect, useState } from "react";

/**
 * Returns true once the user has scrolled beyond the given threshold
 * of the page height (0–1). Designed to be lightweight and fire once.
 */
const useScrollTrigger = (threshold = 0.7) => {
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || triggered) {
      return;
    }

    const handleScroll = () => {
      if (triggered) {
        return;
      }

      const doc = document.documentElement;
      const scrollTop = window.scrollY || window.pageYOffset || doc.scrollTop || 0;
      const maxScrollable = (doc.scrollHeight || 0) - (window.innerHeight || 0);

      if (maxScrollable <= 0) {
        // Very short pages: consider immediately "scrolled".
        setTriggered(true);
        return;
      }

      const progress = scrollTop / maxScrollable;
      if (progress >= threshold) {
        setTriggered(true);
      }
    };

    // Run once on mount in case the user has already scrolled.
    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [threshold, triggered]);

  return triggered;
};

export default useScrollTrigger;


