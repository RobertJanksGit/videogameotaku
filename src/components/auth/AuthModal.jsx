import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useAuth } from "../../contexts/AuthContext";
import Modal from "../common/Modal";

const EyeIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 16 16"
    strokeWidth={1}
    stroke="currentColor"
    className="w-3.5 h-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M1.357 8.215a.675.675 0 010-.426C2.282 5.007 4.907 3 8 3c3.093 0 5.715 2.005 6.642 4.785.047.138.047.287 0 .426C13.715 10.993 11.093 13 8 13c-3.093 0-5.715-2.005-6.642-4.785z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10 8a2 2 0 11-4 0 2 2 0 014 0z"
    />
  </svg>
);

const EyeSlashIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 16 16"
    strokeWidth={1}
    stroke="currentColor"
    className="w-3.5 h-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.653 5.482A6.983 6.983 0 001.29 8c.817 2.897 4.084 5 6.71 5a6.97 6.97 0 001.909-.263M4.152 4.152A6.97 6.97 0 008 3c2.626 0 5.893 2.103 6.71 5a7.015 7.015 0 01-2.862 3.849M4.152 4.152L2 2m2.152 2.152L6.91 6.91m5.253 5.253L14 14m-2.152-2.152L9.09 9.09m0 0a2 2 0 10-2.828-2.828m2.828 2.828L6.262 6.262"
    />
  </svg>
);

const PasswordInput = ({ id, label, value, onChange, required = true }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-sm text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <div className="relative group">
        <input
          type={showPassword ? "text" : "password"}
          id={id}
          value={value}
          onChange={onChange}
          className="w-full px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-[#F6F8FA] dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md focus:border-[#2D7FF9] dark:focus:border-[#2D7FF9] focus:outline-none focus:ring-1 focus:ring-[#2D7FF9] transition-colors pr-8"
          required={required}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#57606a] dark:text-[#7d8590] opacity-75 hover:opacity-100 transition-opacity focus:outline-none bg-transparent"
          style={{ background: "none" }}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          <div className="p-0.5">
            {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
          </div>
        </button>
      </div>
    </div>
  );
};

PasswordInput.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  required: PropTypes.bool,
};

const AuthModal = ({ isOpen, onClose, initialMode = "login" }) => {
  const [mode, setMode] = useState(initialMode);

  // Reset mode when initialMode changes or modal closes
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, isOpen]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login, signup } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      if (mode === "login") {
        await login(email, password);
        setEmail("");
        setPassword("");
      } else {
        await signup(email, password, displayName);
        setEmail("");
        setPassword("");
        setConfirmPassword("");
        setDisplayName("");
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setDisplayName("");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        mode === "login" ? "Sign in to VideoGame Otaku" : "Create an account"
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="text-sm text-red-500">{error}</div>}

        {mode === "register" && (
          <div className="space-y-2">
            <label
              htmlFor="displayName"
              className="block text-sm text-gray-700 dark:text-gray-300"
            >
              Username
            </label>
            <input
              type="text"
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-[#F6F8FA] dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md focus:border-[#2D7FF9] dark:focus:border-[#2D7FF9] focus:outline-none focus:ring-1 focus:ring-[#2D7FF9] transition-colors"
              required
            />
          </div>
        )}

        <div className="space-y-2">
          <label
            htmlFor="email"
            className="block text-sm text-gray-700 dark:text-gray-300"
          >
            Email address
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-[#F6F8FA] dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md focus:border-[#2D7FF9] dark:focus:border-[#2D7FF9] focus:outline-none focus:ring-1 focus:ring-[#2D7FF9] transition-colors"
            required
          />
        </div>

        <PasswordInput
          id="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {mode === "register" && (
          <PasswordInput
            id="confirmPassword"
            label="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full py-1.5 text-sm text-white bg-[#2D7FF9] rounded-md hover:bg-[#2872E0] focus:outline-none focus:ring-2 focus:ring-[#2D7FF9] focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Processing..."
              : mode === "login"
              ? "Sign in"
              : "Create account"}
          </button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={toggleMode}
            className="text-sm text-[#2D7FF9] hover:text-[#2872E0] transition-colors"
          >
            {mode === "login" ? "Create an account" : "Sign in instead"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

AuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  initialMode: PropTypes.oneOf(["login", "register"]),
};

export default AuthModal;
