import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";

const DESTINATION_PATH = "/dashboard#share-your-find";

const variantClasses = {
  primary:
    "rounded-full bg-[#316DCA] text-white hover:bg-[#265DB5] focus-visible:ring-white/80 px-4 py-2",
  subtle:
    "rounded-lg border border-gray-300 dark:border-gray-700 bg-white text-gray-800 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 px-4 py-2",
  ghost:
    "rounded-full bg-transparent text-[#316DCA] hover:text-[#265DB5] px-3 py-2",
};

const baseClasses =
  "inline-flex items-center justify-center text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60 disabled:cursor-not-allowed";

const WritePostButton = ({
  label = "Write a Post",
  variant = "primary",
  className = "",
}) => {
  const navigate = useNavigate();
  const { user, signInWithGoogle } = useAuth();
  const { showErrorToast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState(false);

  useEffect(() => {
    if (!pendingRedirect) {
      return;
    }

    if (user && !user.isAnonymous) {
      navigate(DESTINATION_PATH);
      setPendingRedirect(false);
    }
  }, [pendingRedirect, user, navigate]);

  const navigateToEditor = () => {
    navigate(DESTINATION_PATH);
  };

  const handleClick = async () => {
    if (isProcessing) {
      return;
    }

    if (user && !user.isAnonymous) {
      navigateToEditor();
      return;
    }

    setIsProcessing(true);
    setPendingRedirect(true);

    try {
      const authenticatedUser = await signInWithGoogle();
      if (authenticatedUser && !authenticatedUser.isAnonymous) {
        navigateToEditor();
        setPendingRedirect(false);
      }
    } catch (error) {
      console.error("WritePostButton: Google sign-in failed", error);
      const message =
        error?.message || "We couldn't start Google sign-in. Please try again.";
      showErrorToast(message);
      setPendingRedirect(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const variantClass = variantClasses[variant] || variantClasses.primary;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isProcessing}
      className={`${baseClasses} ${variantClass} ${className}`}
    >
      {isProcessing ? "One sec..." : label}
    </button>
  );
};

WritePostButton.propTypes = {
  label: PropTypes.string,
  variant: PropTypes.oneOf(["primary", "subtle", "ghost"]),
  className: PropTypes.string,
};

export default WritePostButton;

