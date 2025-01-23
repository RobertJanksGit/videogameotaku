import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Navigate } from "react-router-dom";
import PropTypes from "prop-types";
import PostManager from "./PostManager";
import UserManager from "./UserManager";

const TabButton = ({ active, onClick, children }) => {
  const { darkMode } = useTheme();

  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-md focus:outline-none ${
        active
          ? darkMode
            ? "bg-[#316DCA] text-white"
            : "bg-blue-600 text-white"
          : darkMode
          ? "text-[#ADBAC7] hover:bg-[#373E47]"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
};

TabButton.propTypes = {
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};

const AdminPage = () => {
  const { user } = useAuth();
  const { darkMode } = useTheme();
  const [activeTab, setActiveTab] = useState("posts");

  // Redirect if not admin
  if (user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1
          className={`text-2xl font-bold ${
            darkMode ? "text-white" : "text-gray-900"
          }`}
        >
          Admin Dashboard
        </h1>
      </div>

      <div
        className={`rounded-lg shadow ${
          darkMode ? "bg-[#2D333B]" : "bg-white border border-gray-200"
        }`}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex space-x-4">
            <TabButton
              active={activeTab === "posts"}
              onClick={() => setActiveTab("posts")}
            >
              Posts
            </TabButton>
            <TabButton
              active={activeTab === "users"}
              onClick={() => setActiveTab("users")}
            >
              Users
            </TabButton>
          </div>
        </div>

        <div className="p-6">
          {activeTab === "posts" ? (
            <PostManager darkMode={darkMode} />
          ) : (
            <UserManager darkMode={darkMode} />
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
