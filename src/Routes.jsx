import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "./contexts/AuthContext";
import PropTypes from "prop-types";
import Layout from "./components/layout/Layout";
import HomePage from "./components/home/HomePage";
import PostDetail from "./components/posts/PostDetail";
import ContentGuidelines from "./components/guidelines/ContentGuidelines";
import TermsOfUse from "./components/legal/TermsOfUse";
import Settings from "./components/settings/Settings";
import AdminPage from "./components/admin/AdminPage";
import UserDashboard from "./components/user/UserDashboard";
import NotFound from "./components/common/NotFound";

// PrivateRoute component to protect routes that require authentication
const PrivateRoute = ({ children }) => {
  const { user } = useAuth();
  return user ? children : <Navigate to="/" replace />;
};

// AdminRoute component to protect routes that require admin access
const AdminRoute = ({ children }) => {
  const { user } = useAuth();
  return user?.role === "admin" ? children : <Navigate to="/" replace />;
};

// RedirectHandler component to handle redirect parameter
const RedirectHandler = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we have a redirect parameter
    const params = new URLSearchParams(location.search);
    const redirectPath = params.get("redirect");

    if (redirectPath) {
      // Navigate to the specified path without adding to history
      // This ensures the browser's back button works properly
      navigate(redirectPath, { replace: true });
    }
  }, [location, navigate]);

  return null;
};

PrivateRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

AdminRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

const AppRoutes = () => {
  return (
    <Layout>
      {/* Handle redirects from Cloud Function */}
      <RedirectHandler />

      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/post/:postId" element={<PostDetail />} />
        <Route path="/guidelines" element={<ContentGuidelines />} />
        <Route path="/terms" element={<TermsOfUse />} />
        <Route path="/:category" element={<HomePage />} />

        {/* Protected Routes */}
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <Settings />
            </PrivateRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <UserDashboard />
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

        {/* 404 Route */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
};

export default AppRoutes;
