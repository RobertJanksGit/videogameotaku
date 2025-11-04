import { useState, useRef, useEffect } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import PropTypes from "prop-types";
import AuthModal from "../auth/AuthModal";
import { Link, useNavigate } from "react-router-dom";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../../config/firebase";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";
import formatTimeAgo from "../../utils/formatTimeAgo";
import {
  getNotificationMessage,
  markNotificationsAsRead,
} from "../../utils/notifications";

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

const ProfileIcon = ({ photoURL }) => {
  const normalized = normalizeProfilePhoto(photoURL || "", 64);
  const normalized2x = normalized
    ? normalizeProfilePhoto(photoURL || "", 128)
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
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const dropdownRef = useRef(null);
  const notificationsRef = useRef(null);

  // Reset dropdowns when user changes
  useEffect(() => {
    setShowDropdown(false);
    setShowNotifications(false);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setHasUnreadNotifications(false);
      return;
    }

    const notificationsRef = collection(
      db,
      "users",
      user.uid,
      "notifications"
    );

    const q = query(notificationsRef, orderBy("createdAt", "desc"), limit(10));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notificationData = snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data();

        return {
          id: docSnapshot.id,
          ...data,
          isRead:
            typeof data.isRead === "boolean"
              ? data.isRead
              : typeof data.read === "boolean"
              ? data.read
              : false,
        };
      });

      setNotifications(notificationData);
      setHasUnreadNotifications(notificationData.some((n) => !n.isRead));
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!showNotifications || !user) return;

    const unreadIds = notifications
      .filter((notification) => !notification.isRead)
      .map((notification) => notification.id);

    if (unreadIds.length === 0) return;

    markNotificationsAsRead({
      userId: user.uid,
      notificationIds: unreadIds,
    });
  }, [showNotifications, notifications, user]);

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
      if (!user) return;

      if (!notification.isRead) {
        await markNotificationsAsRead({
          userId: user.uid,
          notificationIds: [notification.id],
        });
      }

      setShowNotifications(false);
      setShowDropdown(false);

      const targetPath = `/post/${notification.postId}`;
      const navigationOptions = notification.commentId
        ? { state: { targetCommentId: notification.commentId } }
        : undefined;

      navigate(targetPath, navigationOptions);
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
            <nav className="flex items-center space-x-4">
              {user ? (
                <>
                  <Link
                    to="/dashboard#share-your-find"
                    className="inline-flex items-center justify-center rounded-full bg-[#316DCA] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#265DB5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    Post Your Find
                  </Link>
                  <div className="relative" ref={notificationsRef}>
                    <button
                      onClick={() => {
                        setShowNotifications((prev) => !prev);
                        setShowDropdown(false);
                      }}
                      className="p-2 rounded-full text-[#7D8590] hover:text-white hover:bg-[#1F242A] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                      aria-label="Notifications"
                    >
                      <BellIcon hasUnread={hasUnreadNotifications} />
                    </button>
                    {showNotifications && (
                      <div className="absolute right-0 mt-2 w-80 rounded-md bg-[#2D333B] ring-1 ring-[#1C2128] ring-opacity-5 py-1 shadow-lg z-50">
                        <div className="px-4 py-2 border-b border-[#373E47]">
                          <h3 className="text-sm font-medium text-[#ADBAC7]">
                            Notifications
                          </h3>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                          {notifications.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-[#7D8590]">
                              No notifications
                            </div>
                          ) : (
                            <ul className="divide-y divide-[#1C2128]">
                              {notifications.map((notification) => {
                                const description =
                                  getNotificationMessage({
                                    type: notification.type,
                                    postTitle: notification.postTitle,
                                  }) || "You have a new notification";
                                const actorName =
                                  notification.actorDisplayName || "Someone";

                                return (
                                  <li key={notification.id}>
                                    <button
                                      onClick={() =>
                                        handleNotificationClick(notification)
                                      }
                                      className={`w-full flex flex-col items-start px-4 py-3 text-left transition ${
                                        notification.isRead
                                          ? "bg-transparent text-[#7D8590] hover:bg-[#316DCA] hover:text-white"
                                          : "bg-[#1C2128] text-[#ADBAC7] hover:bg-[#316DCA] hover:text-white"
                                      }`}
                                    >
                                      <div className="flex w-full items-center justify-between gap-2">
                                        <span className="text-sm font-semibold">
                                          {actorName}
                                        </span>
                                        <span className="text-xs text-[#768390]">
                                          {formatTimeAgo(notification.createdAt)}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm leading-snug">
                                        {description}
                                      </p>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => {
                        setShowDropdown(!showDropdown);
                        setShowNotifications(false);
                      }}
                      className="flex items-center space-x-2 group p-0 m-0 bg-transparent border-0 cursor-pointer"
                    >
                      <ProfileIcon photoURL={user.photoURL} />
                      <span className="text-sm text-[#7D8590] group-hover:text-white transition-colors">
                        {user.displayName || user.email}
                      </span>
                      <ChevronDownIcon />
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
              ) : (
                <div className="flex items-center space-x-4">
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
