import { useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import useReturningVisitorBannerState from "../../hooks/useReturningVisitorBannerState";
import useScrollTrigger from "../../hooks/useScrollTrigger";
import AuthModal from "../auth/AuthModal";

/**
 * Gentle, non-intrusive banner encouraging returning, unauthenticated visitors
 * (including anonymous guests) to join or sign in.
 *
 * - Only shows for returning visitors (visitCount >= 2).
 * - Hidden once dismissed for this browser.
 * - Appears after meaningful scroll (default: 70% of page).
 */
const JoinCommunityBanner = ({ scrollThreshold = 0.7 }) => {
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const {
    isReturningVisitor,
    hasDismissedBanner,
    dismissBanner,
    isReady,
  } = useReturningVisitorBannerState();
  const scrollTriggered = useScrollTrigger(scrollThreshold);

  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("register");

  // Treat anonymous users as not fully "joined" so they still see the banner.
  const isFullyAuthenticated = Boolean(user && !user.isAnonymous);

  const shouldShowBanner =
    isReady &&
    !isFullyAuthenticated &&
    isReturningVisitor &&
    !hasDismissedBanner &&
    scrollTriggered;

  if (!shouldShowBanner) {
    return null;
  }

  const handleCreateAccountClick = () => {
    setAuthMode("register");
    setAuthModalOpen(true);
  };

  const handleLoginClick = () => {
    setAuthMode("login");
    setAuthModalOpen(true);
  };

  const handleDismiss = () => {
    dismissBanner();
  };

  return (
    <>
      <section
        aria-label="Join the Video Game Otaku community"
        className="mt-10"
      >
        <div
          className={`relative rounded-lg border p-4 sm:p-5 shadow-sm ${
            darkMode
              ? "bg-gray-900/80 border-gray-800"
              : "bg-white border-gray-200"
          }`}
        >
          <button
            type="button"
            onClick={handleDismiss}
            className={`absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
              darkMode
                ? "text-gray-500 hover:text-gray-300 hover:bg-gray-800 focus-visible:ring-blue-500/70 focus-visible:ring-offset-gray-900"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus-visible:ring-blue-500/60 focus-visible:ring-offset-white"
            }`}
            aria-label="Dismiss join community suggestion"
          >
            ×
          </button>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2
                className={`text-base sm:text-lg font-semibold ${
                  darkMode ? "text-gray-100" : "text-gray-900"
                }`}
              >
                Join the Video Game Otaku community
              </h2>
              <p
                className={`text-sm ${
                  darkMode ? "text-gray-400" : "text-gray-600"
                }`}
              >
                Create a free account to comment on posts, share your own
                articles, and build your gaming feed.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleCreateAccountClick}
                className="inline-flex w-full items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 sm:w-auto"
              >
                Create account
              </button>
              <button
                type="button"
                onClick={handleLoginClick}
                className={`inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  darkMode
                    ? "border-gray-700 bg-transparent text-gray-200 hover:bg-gray-800 focus-visible:ring-blue-500/70 focus-visible:ring-offset-gray-900"
                    : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50 focus-visible:ring-blue-500/60 focus-visible:ring-offset-white"
                } sm:w-auto`}
              >
                Log in
              </button>
            </div>
          </div>
        </div>
      </section>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
      />
    </>
  );
};

export default JoinCommunityBanner;



