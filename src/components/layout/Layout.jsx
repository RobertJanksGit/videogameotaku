import { useState, useRef, useEffect } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import useNotifications from "../../hooks/useNotifications";
import PropTypes from "prop-types";
import AuthModal from "../auth/AuthModal";
import { Link, useNavigate } from "react-router-dom";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";
import WritePostButton from "../common/WritePostButton";

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

const PROFILE_ICON_DISPLAY_SIZE = 32;
const PROFILE_ICON_BASE_SIZE = 64;

const ProfileIcon = ({ photoURL }) => {
  const normalized = normalizeProfilePhoto(photoURL || "", PROFILE_ICON_BASE_SIZE);
  const normalized2x = normalized
    ? normalizeProfilePhoto(photoURL || "", PROFILE_ICON_BASE_SIZE * 2)
    : "";
  const srcSet =
    normalized && normalized2x && normalized2x !== normalized
      ? `${normalized2x} 2x`
      : undefined;

  if (normalized) {
    return (
      <img
        src={normalized}
        srcSet={srcSet}
        width={PROFILE_ICON_DISPLAY_SIZE}
        height={PROFILE_ICON_DISPLAY_SIZE}
        alt="Profile"
        className="w-8 h-8 rounded-full object-cover ring-1 ring-gray-700"
      />
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
      <svg
        className="w-5 h-5 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    </div>
  );
};

ProfileIcon.propTypes = {
  photoURL: PropTypes.string,
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
};

const getNotificationDescription = (notification) => {
  const actorName =
    notification.actorName && typeof notification.actorName === "string"
      ? notification.actorName
      : null;

  switch (notification.type) {
    case "post_comment":
      return actorName
        ? `${actorName} commented on your post`
        : "Someone commented on your post";
    case "reply":
      return actorName
        ? `${actorName} replied to your comment`
        : "Someone replied to your comment";
    case "mention":
      return actorName
        ? `${actorName} mentioned you in a discussion`
        : "You were mentioned in a discussion";
    case "like":
      return actorName
        ? `${actorName} liked your comment`
        : "Your comment received a like";
    default:
      return "You have a new notification";
  }
};

const ChevronDownIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

const BellIcon = ({ hasUnread }) => (
  <div className="relative">
    <svg
      className="h-5 w-5 text-[#7D8590] hover:text-white transition-colors"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
    {hasUnread && (
      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500"></span>
    )}
  </div>
);

BellIcon.propTypes = {
  hasUnread: PropTypes.bool.isRequired,
};

const UserPlusIcon = () => (
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
      d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"
    />
  </svg>
);

const LoginIcon = () => (
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
      d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
    />
  </svg>
);

const Layout = ({ children }) => {
  const { darkMode, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const isAnonymousVisitor = Boolean(user?.isAnonymous);
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef(null);
  const notificationsRef = useRef(null);
  const { showInfoToast } = useToast();
  const {
    notifications: engagementNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
  } = useNotifications(!user || user.isAnonymous ? null : user.uid);
  const hasUnreadNotifications = unreadCount > 0;
  const notificationsInitializedRef = useRef(false);
  const latestNotificationTsRef = useRef(0);

  // Reset dropdowns when user changes
  useEffect(() => {
    setShowDropdown(false);
    setShowNotifications(false);
  }, [user]);

  useEffect(() => {
    notificationsInitializedRef.current = false;
    latestNotificationTsRef.current = 0;
  }, [user?.uid]);

  useEffect(() => {
    if (!engagementNotifications.length) {
      return;
    }
    const timestamps = engagementNotifications.map((notification) =>
      toMillis(notification.createdAt)
    );
    const newest = Math.max(...timestamps);
    if (!notificationsInitializedRef.current) {
      notificationsInitializedRef.current = true;
      latestNotificationTsRef.current = newest;
      return;
    }
    const freshNotifications = engagementNotifications.filter(
      (notification) =>
        !notification.read &&
        toMillis(notification.createdAt) > latestNotificationTsRef.current
    );
    freshNotifications.forEach((notification) => {
      if (
        notification.type === "reply" ||
        notification.type === "post_comment" ||
        notification.type === "mention"
      ) {
        showInfoToast(getNotificationDescription(notification));
      }
    });
    if (freshNotifications.length > 0) {
      latestNotificationTsRef.current = Math.max(
        newest,
        latestNotificationTsRef.current
      );
    }
  }, [engagementNotifications, showInfoToast]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target)
      ) {
        setShowNotifications(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAuthClick = (mode) => {
    setAuthMode(mode);
    setShowAuthModal(true);
  };

  const handleModalClose = () => {
    setShowAuthModal(false);
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/");
    } catch (error) {
      console.error("Failed to log out", error);
    }
  };

  const handleNotificationClick = async (notification) => {
    try {
      if (notification.id) {
        await markAsRead(notification.id);
      }
      setShowNotifications(false);

      if (notification.link) {
        navigate(notification.link, {
          state: { targetCommentId: notification.commentId },
        });
        return;
      }

      if (notification.postId) {
        navigate(`/post/${notification.postId}`, {
          state: notification.commentId
            ? { targetCommentId: notification.commentId }
            : undefined,
        });
      }
    } catch (error) {
      console.error("Error handling notification click:", error);
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
              VideoGameOtaku
            </Link>
            <nav className="flex items-center gap-4">
              {user ? (
                isAnonymousVisitor ? (
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    <div className="flex items-center gap-2 rounded-full border border-[#21262d] bg-[#161B22] px-3 py-1.5">
                      <ProfileIcon photoURL={user.photoURL} />
                      <div className="leading-tight">
                        <div className="text-sm text-gray-100">
                          {user.displayName || user.name || "Guest"}
                        </div>
                        <div className="text-xs text-[#7D8590]">
                          Guest account
                        </div>
                      </div>
                    </div>
                    <WritePostButton
                      label="Write a Post"
                      className="max-[500px]:hidden flex-shrink-0"
                    />
                    <button
                      onClick={() => handleAuthClick("register")}
                      className="inline-flex items-center justify-center rounded-full bg-[#316DCA] px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white whitespace-nowrap shadow-sm transition hover:bg-[#265DB5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                    >
                      Create Account
                    </button>
                    <button
                      onClick={() => handleAuthClick("login")}
                      className="text-sm text-[#7D8590] hover:text-white transition-colors"
                    >
                      Sign in
                    </button>
                  </div>
                ) : (
                  <>
                    <WritePostButton
                      label="Write a Post"
                      className="max-[500px]:hidden flex-shrink-0"
                    />
                    <div className="relative" ref={dropdownRef}>
                      <button
                        onClick={() => setShowDropdown(!showDropdown)}
                        className="flex items-center space-x-2 group p-0 m-0 bg-transparent border-0 cursor-pointer"
                      >
                        <ProfileIcon photoURL={user.photoURL} />
                        <span className="hidden sm:inline text-sm text-[#7D8590] group-hover:text-white transition-colors">
                          {user.displayName || user.email}
                        </span>
                        <span className="hidden sm:inline-flex">
                          <ChevronDownIcon />
                        </span>
                        {hasUnreadNotifications && (
                          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500"></span>
                        )}
                      </button>

                      {showDropdown && (
                        <div className="absolute right-0 mt-2 w-48 rounded-md bg-[#2D333B] ring-1 ring-[#1C2128] ring-opacity-5 py-1 shadow-lg">
                          {user.role === "admin" ? (
                            <Link
                              to="/admin"
                              onClick={() => setShowDropdown(false)}
                              className="block w-full text-left px-4 py-2 text-sm text-[#ADBAC7] hover:bg-[#316DCA] hover:text-white"
                            >
                              Admin Dashboard
                            </Link>
                          ) : (
                            <Link
                              to="/dashboard"
                              onClick={() => setShowDropdown(false)}
                              className="block w-full text-left px-4 py-2 text-sm text-[#ADBAC7] hover:bg-[#316DCA] hover:text-white"
                            >
                              My Dashboard
                            </Link>
                          )}
                          <button
                            onClick={() => {
                              setShowDropdown(false);
                              setShowNotifications(!showNotifications);
                            }}
                            className="block w-full text-left px-4 py-2 text-sm text-[#ADBAC7] hover:bg-[#316DCA] hover:text-white bg-transparent border-0 cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span>Notifications</span>
                              {hasUnreadNotifications && (
                                <span className="h-2 w-2 rounded-full bg-red-500"></span>
                              )}
                            </div>
                          </button>
                          <Link
                            to="/settings"
                            onClick={() => setShowDropdown(false)}
                            className="block w-full text-left px-4 py-2 text-sm text-[#ADBAC7] hover:bg-[#316DCA] hover:text-white"
                          >
                            Settings
                          </Link>
                          <div className="my-1 h-px bg-[#373E47]"></div>
                          <button
                            onClick={handleLogout}
                            className="block w-full text-left px-4 py-2 text-sm text-[#ADBAC7] hover:bg-[#316DCA] hover:text-white bg-transparent border-0 cursor-pointer"
                          >
                            Logout
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )
              ) : (
                <div className="flex items-center space-x-3">
                  <WritePostButton
                    label="Write a Post"
                    className="max-[500px]:hidden"
                  />

                  {/* Desktop / larger screens: show separate Register + Sign in actions */}
                  <div className="hidden sm:flex items-center space-x-3">
                    <button
                      onClick={() => handleAuthClick("register")}
                      className="flex items-center space-x-2 px-3 py-1.5 text-sm text-[#7D8590] hover:text-white transition-colors bg-transparent"
                    >
                      <UserPlusIcon />
                      <span>Register</span>
                    </button>
                    <button
                      onClick={() => handleAuthClick("login")}
                      className="flex items-center space-x-2 px-3 py-1.5 text-sm text-[#7D8590] hover:text-white transition-colors bg-transparent"
                    >
                      <LoginIcon />
                      <span>Sign in</span>
                    </button>
                  </div>

                  {/* Mobile: single primary Sign in button that opens the auth modal */}
                  <button
                    onClick={() => handleAuthClick("login")}
                    className="sm:hidden inline-flex items-center justify-center rounded-full bg-[#316DCA] px-3 py-1.5 text-sm font-semibold text-white whitespace-nowrap shadow-sm transition hover:bg-[#265DB5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    Sign in
                  </button>
                </div>
              )}
              <button
                onClick={toggleTheme}
                className="p-0 m-0 bg-transparent border-0 cursor-pointer text-[#7D8590] hover:text-white"
                aria-label="Toggle theme"
              >
                {darkMode ? <SunIcon /> : <MoonIcon />}
              </button>
            </nav>
          </div>
        </header>

        {showNotifications && !isAnonymousVisitor && (
          <div
            ref={notificationsRef}
            className="fixed right-4 top-16 w-80 rounded-md bg-[#2D333B] ring-1 ring-[#1C2128] ring-opacity-5 py-1 shadow-lg z-50"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#373E47]">
              <h3 className="text-sm font-medium text-[#ADBAC7]">
                Notifications
              </h3>
              {engagementNotifications.length > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs font-semibold text-[#58A6FF] hover:text-white transition-colors"
                  type="button"
                >
                  Mark all as read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {engagementNotifications.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[#7D8590]">
                  You're all caught up.
                </div>
              ) : (
                engagementNotifications.map((notification) => {
                  const description = getNotificationDescription(notification);
                  const createdAtMs = toMillis(notification.createdAt);
                  const timestampLabel = createdAtMs
                    ? new Date(createdAtMs).toLocaleString()
                    : "";
                  return (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      type="button"
                      className={`w-full block px-4 py-3 text-left text-sm border-0 rounded-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#316DCA]/60 ${
                        notification.read
                          ? "bg-[#2D333B] text-[#7D8590] hover:text-white hover:bg-[#316DCA]/30"
                          : "bg-[#316DCA]/15 text-[#ADBAC7] font-semibold hover:bg-[#316DCA]/25"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span>{description}</span>
                        {!notification.read && (
                          <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-[#58A6FF]" />
                        )}
                      </div>
                      {notification.snippet ? (
                        <p className="mt-1 text-xs text-[#7D8590] line-clamp-2">
                          {notification.snippet}
                        </p>
                      ) : null}
                      {timestampLabel ? (
                        <p className="mt-1 text-[11px] uppercase tracking-wider text-[#6E7681]">
                          {timestampLabel}
                        </p>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        <AuthModal
          isOpen={showAuthModal}
          onClose={handleModalClose}
          initialMode={authMode}
        />
      </div>
    </div>
  );
};

Layout.propTypes = {
  children: PropTypes.node.isRequired,
};

export default Layout;
