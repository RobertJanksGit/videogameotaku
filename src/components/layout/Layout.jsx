import { useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import PropTypes from "prop-types";
import AuthModal from "../auth/AuthModal";
import { Link } from "react-router-dom";

const SunIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
    />
  </svg>
);

const MoonIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-5 h-5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
    />
  </svg>
);

const Layout = ({ children }) => {
  const { darkMode, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  const handleAuthClick = (mode) => {
    setAuthMode(mode);
    setShowAuthModal(true);
  };

  const handleModalClose = () => {
    setShowAuthModal(false);
    // Reset auth mode when modal is closed
    setAuthMode("login");
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Failed to log out:", error);
    }
  };

  return (
    <div className={`w-full ${darkMode ? "dark" : ""}`}>
      <div className="min-h-screen w-full bg-white dark:bg-gray-900">
        <header className="sticky top-0 z-50 w-full bg-[#0D1117] border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
            <Link
              to="/"
              className="text-xl font-semibold text-white hover:text-gray-300 transition-colors"
            >
              VideoGame Otaku
            </Link>
            <nav className="flex items-center space-x-4">
              {user ? (
                <div className="flex items-center space-x-4">
                  <Link
                    to="/settings"
                    className="text-sm text-[#7D8590] hover:text-white transition-colors"
                  >
                    Settings
                  </Link>
                  <span className="text-sm text-[#7D8590]">
                    {user.displayName || user.email}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="text-sm text-[#7D8590] hover:text-white transition-colors"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => handleAuthClick("register")}
                    className="text-sm text-[#7D8590] hover:text-white transition-colors"
                  >
                    Register
                  </button>
                  <button
                    onClick={() => handleAuthClick("login")}
                    className="text-sm bg-[#2D7FF9] text-white px-4 py-1.5 rounded-md hover:bg-[#2872E0] transition-colors"
                  >
                    Login
                  </button>
                </div>
              )}
              <button
                onClick={toggleTheme}
                className="p-2 text-[#7D8590] hover:text-white transition-colors"
                aria-label="Toggle theme"
              >
                {darkMode ? <SunIcon /> : <MoonIcon />}
              </button>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-gray-900 dark:text-white">
          {children}
        </main>
        <footer className="w-full border-t border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-gray-600 dark:text-gray-400">
            © {new Date().getFullYear()} VideoGame Otaku. All rights reserved.
          </div>
        </footer>
      </div>
      <AuthModal
        isOpen={showAuthModal}
        onClose={handleModalClose}
        initialMode={authMode}
      />
    </div>
  );
};

Layout.propTypes = {
  children: PropTypes.node.isRequired,
};

export default Layout;
