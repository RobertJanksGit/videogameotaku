import { createContext, useContext, useEffect, useCallback } from "react";
import PropTypes from "prop-types";

const AccessibilityContext = createContext();

export const useAccessibility = () => {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error(
      "useAccessibility must be used within an AccessibilityProvider"
    );
  }
  return context;
};

export const AccessibilityProvider = ({ children }) => {
  // Handle keyboard navigation
  const handleKeyboardNavigation = useCallback((e) => {
    // Show focus outline when using keyboard
    if (e.key === "Tab") {
      document.body.classList.add("keyboard-navigation");
    }
  }, []);

  // Handle mouse navigation
  const handleMouseNavigation = useCallback(() => {
    document.body.classList.remove("keyboard-navigation");
  }, []);

  // Skip to main content functionality
  const skipToContent = useCallback(() => {
    const mainContent = document.querySelector('[role="main"]');
    if (mainContent) {
      mainContent.focus();
      mainContent.scrollIntoView();
    }
  }, []);

  useEffect(() => {
    // Add event listeners for keyboard/mouse navigation
    document.addEventListener("keydown", handleKeyboardNavigation);
    document.addEventListener("mousedown", handleMouseNavigation);

    // Add keyboard shortcut for skip to content
    const handleSkipToContent = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        skipToContent();
      }
    };
    document.addEventListener("keydown", handleSkipToContent);

    // Ensure proper color contrast
    const root = document.documentElement;
    root.style.setProperty("--min-contrast-ratio", "4.5:1");

    return () => {
      document.removeEventListener("keydown", handleKeyboardNavigation);
      document.removeEventListener("mousedown", handleMouseNavigation);
      document.removeEventListener("keydown", handleSkipToContent);
    };
  }, [handleKeyboardNavigation, handleMouseNavigation, skipToContent]);

  const value = {
    skipToContent,
  };

  return (
    <>
      <button
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:top-0 focus:left-0 focus:z-50 focus:p-4 focus:bg-white focus:text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Skip to main content"
      >
        Skip to main content
      </button>
      <AccessibilityContext.Provider value={value}>
        {children}
      </AccessibilityContext.Provider>
    </>
  );
};

AccessibilityProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export default AccessibilityProvider;
