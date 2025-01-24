import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Navigate } from "react-router-dom";
import UserPostManager from "./UserPostManager";

const UserDashboard = () => {
  const { user } = useAuth();
  const { darkMode } = useTheme();

  // Redirect if not logged in
  if (!user) {
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
          My Dashboard
        </h1>
      </div>

      <div
        className={`rounded-lg shadow ${
          darkMode ? "bg-[#2D333B]" : "bg-white border border-gray-200"
        }`}
      >
        <div className="p-6">
          <UserPostManager darkMode={darkMode} />
        </div>
      </div>
    </div>
  );
};

export default UserDashboard;
