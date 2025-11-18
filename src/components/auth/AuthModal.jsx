import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useAuth } from "../../contexts/AuthContext";
import Modal from "../common/Modal";
import { Link } from "react-router-dom";

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

const PasswordInput = ({
  id,
  label,
  value,
  onChange,
  required = true,
  mode,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const isRegistrationPassword = mode === "register" && id === "password";

  const checkPasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    return strength;
  };

  useEffect(() => {
    if (isRegistrationPassword) {
      setPasswordStrength(checkPasswordStrength(value));
    }
  }, [value, isRegistrationPassword]);

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
          placeholder={
            isRegistrationPassword
              ? "Min. 8 characters with letters, numbers & symbols"
              : "Enter your password"
          }
          title={
            isRegistrationPassword
              ? "Must contain at least 8 characters, including uppercase, lowercase, number and special character"
              : undefined
          }
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
      {isRegistrationPassword && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {[...Array(5)].map((_, index) => (
              <div
                key={index}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  index < passwordStrength
                    ? passwordStrength <= 2
                      ? "bg-red-500"
                      : passwordStrength <= 3
                      ? "bg-yellow-500"
                      : "bg-green-500"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              />
            ))}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <div className={value.length >= 8 ? "text-green-500" : ""}>
              • Minimum 8 characters
            </div>
            <div className={/[a-z]/.test(value) ? "text-green-500" : ""}>
              • One lowercase letter
            </div>
            <div className={/[A-Z]/.test(value) ? "text-green-500" : ""}>
              • One uppercase letter
            </div>
            <div className={/[0-9]/.test(value) ? "text-green-500" : ""}>
              • One number
            </div>
            <div className={/[^a-zA-Z0-9]/.test(value) ? "text-green-500" : ""}>
              • One special character
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

PasswordInput.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  required: PropTypes.bool,
  mode: PropTypes.oneOf(["login", "register"]).isRequired,
};

const AuthModal = ({ isOpen, onClose, initialMode = "login" }) => {
  const [mode, setMode] = useState(initialMode);

  // Update mode when modal opens with initialMode
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
    }
  }, [isOpen, initialMode]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedToGuidelines, setAgreedToGuidelines] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const { login, signup, signInWithGoogle } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setDisplayName("");
      setError("");
      setAgreedToGuidelines(false);
      setAgreedToTerms(false);
      setGoogleLoading(false);
    }
  }, [isOpen]);

  const handleGoogleSignIn = async () => {
    if (googleLoading) return;

    setError("");
    setGoogleLoading(true);

    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to sign in with Google right now.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }

      if (displayName.length < 3) {
        setError("Username must be at least 3 characters long");
        return;
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(displayName)) {
        setError(
          "Username can only contain letters, numbers, underscores, and hyphens"
        );
        return;
      }

      if (password.length < 8) {
        setError("Password must be at least 8 characters long");
        return;
      }

      if (!/[a-z]/.test(password)) {
        setError("Password must contain at least one lowercase letter");
        return;
      }

      if (!/[A-Z]/.test(password)) {
        setError("Password must contain at least one uppercase letter");
        return;
      }

      if (!/[0-9]/.test(password)) {
        setError("Password must contain at least one number");
        return;
      }

      if (!/[^a-zA-Z0-9]/.test(password)) {
        setError("Password must contain at least one special character");
        return;
      }

      if (!agreedToGuidelines || !agreedToTerms) {
        setError(
          "You must agree to both the Terms of Use and Content Guidelines to create an account"
        );
        return;
      }
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
    setAgreedToGuidelines(false);
    setAgreedToTerms(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        mode === "login" ? "Sign in to VideoGame Otaku" : "Create an account"
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Sign in to comment and post your own articles.
        </p>

        {error && <div className="text-sm text-red-500">{error}</div>}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-white text-gray-800 dark:bg-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="#EA4335"
              d="M12 10.2v3.6h5.1c-.2 1.2-.9 2.3-1.9 3l3.1 2.4c1.8-1.7 2.9-4.1 2.9-6.9 0-.7-.1-1.3-.2-1.9H12z"
            />
            <path
              fill="#34A853"
              d="M5.3 14.3l-.8.6-2.5 1.9C4 20.1 7.7 22 12 22c2.4 0 4.5-.8 6-2.2l-3.1-2.4c-.8.5-1.9.9-3 .9-2.3 0-4.2-1.5-4.9-3.6z"
            />
            <path
              fill="#4A90E2"
              d="M2 6.5c-.6 1.1-.9 2.3-.9 3.5s.3 2.4.9 3.5c0 0 3.3-2.6 3.3-2.6-.2-.5-.3-1-.3-1.5 0-.5.1-1 .3-1.5z"
            />
            <path
              fill="#FBBC05"
              d="M12 4.2c1.3 0 2.5.5 3.4 1.3l2.6-2.6C16.5 1.2 14.4 0 12 0 7.7 0 4 2 2 6.5l3.6 2.6c.7-2.1 2.6-3.6 4.9-3.6z"
            />
          </svg>
          {googleLoading ? "Connecting..." : "Continue with Google"}
        </button>

        <div className="relative flex items-center">
          <span className="flex-grow border-t border-gray-200 dark:border-gray-700" />
          <span className="mx-2 text-xs uppercase tracking-wide text-gray-400">
            or continue with email
          </span>
          <span className="flex-grow border-t border-gray-200 dark:border-gray-700" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="e.g., game_master123"
                pattern="^[a-zA-Z0-9_-]+$"
                title="Username can only contain letters, numbers, underscores, and hyphens"
                minLength={3}
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
              placeholder="your.email@example.com"
            />
          </div>

          <PasswordInput
            id="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            mode={mode}
          />

          {mode === "register" && (
            <>
              <PasswordInput
                id="confirmPassword"
                label="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                mode={mode}
              />

              <div className="space-y-3">
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      id="terms"
                      type="checkbox"
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label
                      htmlFor="terms"
                      className="text-gray-700 dark:text-gray-300"
                    >
                      I have read and agree to the{" "}
                      <Link
                        to="/terms"
                        className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        onClick={() => onClose()}
                      >
                        Terms of Use
                      </Link>
                    </label>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      id="guidelines"
                      type="checkbox"
                      checked={agreedToGuidelines}
                      onChange={(e) =>
                        setAgreedToGuidelines(e.target.checked)
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label
                      htmlFor="guidelines"
                      className="text-gray-700 dark:text-gray-300"
                    >
                      I have read and agree to the{" "}
                      <Link
                        to="/guidelines"
                        className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        onClick={() => onClose()}
                      >
                        Content Guidelines
                      </Link>
                    </label>
                  </div>
                </div>
              </div>
            </>
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
                ? "Sign in with email"
                : "Create account with email"}
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
      </div>
    </Modal>
  );
};

AuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  initialMode: PropTypes.oneOf(["login", "register"]),
};

export default AuthModal;
