import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Layout from "./components/layout/Layout";
import Settings from "./components/settings/Settings";
import AdminPage from "./components/admin/AdminPage";
import PropTypes from "prop-types";

function App() {
  return (
    <Router>
      <AuthProvider>
        <ThemeProvider>
          <Layout>
            <Routes>
              <Route
                path="/"
                element={
                  <div className="w-full space-y-8">
                    <section className="w-full">
                      <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
                        Latest Gaming News
                      </h2>
                      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        <div className="p-6 rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
                          <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
                            Welcome to VideoGame Otaku!
                          </h3>
                          <p className="text-gray-600 dark:text-gray-300">
                            Your source for the latest gaming news, reviews, and
                            community discussions.
                          </p>
                        </div>
                      </div>
                    </section>
                  </div>
                }
              />
              <Route
                path="/settings"
                element={
                  <PrivateRoute>
                    <Settings />
                  </PrivateRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <AdminPage />
                  </AdminRoute>
                }
              />
            </Routes>
          </Layout>
        </ThemeProvider>
      </AuthProvider>
    </Router>
  );
}

// PrivateRoute component to protect routes that require authentication
function PrivateRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/" replace />;
}

// AdminRoute component to protect routes that require admin access
function AdminRoute({ children }) {
  const { user } = useAuth();
  return user?.role === "admin" ? children : <Navigate to="/" replace />;
}

PrivateRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

AdminRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default App;
