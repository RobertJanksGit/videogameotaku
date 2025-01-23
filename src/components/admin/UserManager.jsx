import { useState, useEffect } from "react";
import { db } from "../../config/firebase";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import PropTypes from "prop-types";

const UserManager = ({ darkMode }) => {
  const [users, setUsers] = useState([]);

  // Fetch users
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const usersCollection = collection(db, "users");
        const usersSnapshot = await getDocs(usersCollection);
        const usersList = usersSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setUsers(usersList);
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    };

    fetchUsers();
  }, []);

  // Update user role
  const handleRoleChange = async (userId, newRole) => {
    try {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, {
        role: newRole,
      });

      // Update local state
      setUsers(
        users.map((user) =>
          user.id === userId ? { ...user, role: newRole } : user
        )
      );
    } catch (error) {
      console.error("Error updating user role:", error);
    }
  };

  // Toggle user active status
  const handleToggleActive = async (userId, currentStatus) => {
    try {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, {
        isActive: !currentStatus,
      });

      // Update local state
      setUsers(
        users.map((user) =>
          user.id === userId ? { ...user, isActive: !currentStatus } : user
        )
      );
    } catch (error) {
      console.error("Error toggling user status:", error);
    }
  };

  return (
    <div className="space-y-6">
      <div
        className={`rounded-md border ${
          darkMode ? "border-gray-700" : "border-gray-200"
        }`}
      >
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className={darkMode ? "bg-[#1C2128]" : "bg-gray-50"}>
            <tr>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                User
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Email
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Role
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Status
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody
            className={`divide-y ${
              darkMode ? "divide-gray-700" : "divide-gray-200"
            }`}
          >
            {users.map((user) => (
              <tr key={user.id}>
                <td
                  className={`px-6 py-4 whitespace-nowrap text-sm ${
                    darkMode ? "text-gray-200" : "text-gray-900"
                  }`}
                >
                  {user.name || "N/A"}
                </td>
                <td
                  className={`px-6 py-4 whitespace-nowrap text-sm ${
                    darkMode ? "text-gray-200" : "text-gray-900"
                  }`}
                >
                  {user.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                    className={`block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
                      darkMode
                        ? "bg-[#1C2128] border-gray-700 text-white"
                        : "border-gray-300"
                    }`}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="moderator">Moderator</option>
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => handleToggleActive(user.id, user.isActive)}
                    className={`text-sm ${
                      user.isActive
                        ? "text-red-600 hover:text-red-900"
                        : "text-green-600 hover:text-green-900"
                    } hover:underline`}
                  >
                    {user.isActive ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

UserManager.propTypes = {
  darkMode: PropTypes.bool.isRequired,
};

export default UserManager;
