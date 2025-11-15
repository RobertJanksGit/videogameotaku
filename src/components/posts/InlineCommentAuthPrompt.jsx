import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "../common/Modal";
import { useAuth } from "../../contexts/AuthContext";

const providerLabel = {
  google: "Sign in with Google",
  guest: "Continue as Guest",
  email: "Sign in with Email",
};

const buildErrorMessage = (error) =>
  error?.message || "Something went wrong. Please try again.";

const InlineCommentAuthPrompt = ({
  isOpen,
  onClose,
  onAuthenticated,
  onRequestEmail,
  commentPreview = "",
}) => {
  const { signInWithGoogle, signInAnonymously } = useAuth();
  const [activeProvider, setActiveProvider] = useState(null);
  const [error, setError] = useState("");

  const resetState = () => {
    setActiveProvider(null);
    setError("");
  };

  const handleClose = () => {
    if (activeProvider) {
      return;
    }
    resetState();
    onClose();
  };

  const handleProviderAction = async (providerType) => {
    try {
      setActiveProvider(providerType);
      setError("");
      let resultUser = null;

      if (providerType === "google") {
        resultUser = await signInWithGoogle();
      } else if (providerType === "guest") {
        resultUser = await signInAnonymously();
      }

      if (resultUser) {
        await onAuthenticated?.(resultUser);
        resetState();
      }
    } catch (providerError) {
      console.error("Inline auth provider error:", providerError);
      setError(buildErrorMessage(providerError));
    } finally {
      setActiveProvider(null);
    }
  };

  const handleEmail = () => {
    if (activeProvider) {
      return;
    }
    onRequestEmail?.();
  };

  const renderButton = (type, onClick, variant = "primary") => {
    const isActive = activeProvider === type;
    const baseClasses =
      "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
    let appearanceClasses = "";

    if (variant === "primary") {
      appearanceClasses =
        "bg-blue-600 text-white hover:bg-blue-500 focus:ring-blue-500";
    } else if (variant === "ghost") {
      appearanceClasses =
        "bg-transparent text-blue-600 hover:text-blue-700 focus:ring-blue-500";
    } else {
      appearanceClasses =
        "bg-gray-100 text-gray-800 hover:bg-gray-200 focus:ring-gray-300";
    }

    return (
      <button
        key={type}
        type="button"
        onClick={onClick}
        disabled={Boolean(activeProvider)}
        className={`${baseClasses} ${appearanceClasses} ${
          isActive ? "opacity-70 cursor-wait" : ""
        }`}
      >
        {isActive ? "Working..." : providerLabel[type]}
      </button>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Save your comment"
    >
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <p>
          Choose how you want to post this comment. We&apos;ll submit it
          automatically once you&apos;re ready.
        </p>

        {commentPreview ? (
          <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
            {commentPreview.length > 160
              ? `${commentPreview.slice(0, 157)}…`
              : commentPreview}
          </div>
        ) : null}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {renderButton("google", () => handleProviderAction("google"), "primary")}
          {renderButton("guest", () => handleProviderAction("guest"), "secondary")}
          {renderButton("email", handleEmail, "ghost")}
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Continuing as a guest keeps your comment history local to this device.
          Create an account later to unlock profiles, dashboards, and more.
        </p>
      </div>
    </Modal>
  );
};

InlineCommentAuthPrompt.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onAuthenticated: PropTypes.func,
  onRequestEmail: PropTypes.func,
  commentPreview: PropTypes.string,
};

export default InlineCommentAuthPrompt;

















