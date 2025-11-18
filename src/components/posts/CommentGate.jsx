import { useState } from "react";
import PropTypes from "prop-types";
import { useAuth } from "../../contexts/AuthContext";
import Modal from "../common/Modal";
import MentionTextarea from "./MentionTextarea";

const CommentGate = ({
  darkMode,
  commentValue,
  onCommentChange,
  onCommentKeyDown,
  onSubmit,
  isSubmitting,
  commentError,
  signedInLabel,
  placeholder = "Share your thoughts...",
  textareaId = "post-comment",
}) => {
  const { user, signInWithGoogle } = useAuth();
  const [isGateOpen, setIsGateOpen] = useState(false);
  const [gateError, setGateError] = useState("");
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleOpenGate = () => {
    setGateError("");
    setIsGateOpen(true);
  };

  const handleCloseGate = () => {
    setGateError("");
    setIsGateOpen(false);
  };

  const handleGoogleSignIn = async () => {
    if (isGoogleLoading) {
      return;
    }

    setGateError("");
    setIsGoogleLoading(true);

    try {
      await signInWithGoogle();
      setIsGateOpen(false);
    } catch (error) {
      setGateError(error.message || "Unable to sign you in right now. Try again soon.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  if (user) {
    return (
      <form onSubmit={onSubmit}>
        <label htmlFor={textareaId} className="sr-only">
          Write a comment
        </label>
        <MentionTextarea
          id={textareaId}
          rows={3}
          value={commentValue}
          onChange={onCommentChange}
          onKeyDown={onCommentKeyDown}
          placeholder={placeholder}
          darkMode={darkMode}
          disabled={isSubmitting}
          className={`w-full px-4 py-2 rounded-lg text-sm ${
            darkMode
              ? "bg-gray-800 text-white placeholder-gray-400 border border-gray-700 focus:border-blue-500"
              : "bg-white text-gray-900 placeholder-gray-500 border border-gray-300 focus:border-blue-500"
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          aria-label="Add a comment"
        />
        {commentError ? (
          <p className="mt-2 text-xs text-red-500" role="alert">
            {commentError}
          </p>
        ) : null}
        <div className="mt-3 flex flex-col gap-2 min-[840px]:flex-row min-[840px]:items-center min-[840px]:justify-between">
          <span
            className={`text-xs ${
              darkMode ? "text-gray-400" : "text-gray-500"
            }`}
          >
            {signedInLabel}
          </span>
          <button
            type="submit"
            disabled={!commentValue.trim() || isSubmitting}
            className={`inline-flex justify-center px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              darkMode
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {isSubmitting ? "Posting..." : "Post Comment"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpenGate}
        className={`w-full text-left rounded-lg border ${
          darkMode
            ? "border-gray-800 bg-gray-900/60 text-gray-200 hover:border-blue-500 hover:bg-gray-900"
            : "border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:bg-gray-50"
        } p-4 md:p-5 shadow-sm transition`}
        aria-label="Sign in to comment"
      >
        <div className="space-y-3">
          <div
            className={`w-full rounded-lg border px-4 py-2 text-sm ${
              darkMode
                ? "border-gray-700 bg-gray-800 text-gray-400"
                : "border-gray-300 bg-gray-50 text-gray-500"
            }`}
          >
            Sign in to join the discussion…
          </div>
          <div
            className={`text-xs font-medium uppercase tracking-wide ${
              darkMode ? "text-blue-300" : "text-blue-600"
            }`}
          >
            Click to continue
          </div>
        </div>
      </button>

      <Modal
        isOpen={isGateOpen}
        onClose={handleCloseGate}
        title="Join the discussion"
      >
        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <p>Create a free account to comment and post your own stories.</p>
          {gateError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {gateError}
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-[#2D7FF9] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2872E0] focus:outline-none focus:ring-2 focus:ring-[#2D7FF9] focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isGoogleLoading ? "Connecting..." : "Continue with Google"}
          </button>
          <button
            type="button"
            onClick={handleCloseGate}
            className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Not now
          </button>
        </div>
      </Modal>
    </>
  );
};

CommentGate.propTypes = {
  darkMode: PropTypes.bool.isRequired,
  commentValue: PropTypes.string.isRequired,
  onCommentChange: PropTypes.func.isRequired,
  onCommentKeyDown: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool.isRequired,
  commentError: PropTypes.string,
  signedInLabel: PropTypes.string,
  placeholder: PropTypes.string,
  textareaId: PropTypes.string,
};

export default CommentGate;

