import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import formatTimeAgo, { getTimestampDate } from "../../utils/formatTimeAgo";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";

const commentPropType = PropTypes.shape({
  id: PropTypes.string.isRequired,
  content: PropTypes.string.isRequired,
  authorId: PropTypes.string,
  authorName: PropTypes.string,
  authorPhotoURL: PropTypes.string,
  createdAt: PropTypes.oneOfType([
    PropTypes.instanceOf(Date),
    PropTypes.string,
    PropTypes.number,
    PropTypes.shape({ toDate: PropTypes.func }),
  ]),
});

const CommentAvatar = ({
  authorId,
  authorName = "Anonymous",
  authorPhotoURL,
  darkMode,
}) => {
  const initial = (authorName || "").charAt(0).toUpperCase() || "A";

  const normalizedPhotoUrl = normalizeProfilePhoto(authorPhotoURL || "", 80);
  const normalizedPhotoUrl2x = normalizeProfilePhoto(authorPhotoURL || "", 160);
  const avatarSrcSet =
    normalizedPhotoUrl &&
    normalizedPhotoUrl2x &&
    normalizedPhotoUrl2x !== normalizedPhotoUrl
      ? `${normalizedPhotoUrl2x} 2x`
      : undefined;

  const avatar = (
    <span
      className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 ring-2 ${
        darkMode ? "bg-gray-700 ring-gray-600" : "bg-gray-100 ring-gray-200"
      }`}
    >
      {normalizedPhotoUrl ? (
        <img
          src={normalizedPhotoUrl}
          srcSet={avatarSrcSet}
          alt={authorName}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span
          className={`text-sm font-semibold ${
            darkMode ? "text-gray-200" : "text-gray-600"
          }`}
        >
          {initial}
        </span>
      )}
    </span>
  );

  if (authorId) {
    return (
      <Link
        to={`/user/${authorId}`}
        aria-label={`View ${authorName}'s profile`}
        className="inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-2"
      >
        {avatar}
      </Link>
    );
  }

  return avatar;
};

CommentAvatar.propTypes = {
  authorId: PropTypes.string,
  authorName: PropTypes.string,
  authorPhotoURL: PropTypes.string,
  darkMode: PropTypes.bool.isRequired,
};

const CommentItem = ({
  comment,
  darkMode,
  onReplyClick,
  canReply,
  isReply = false,
  isReplyFormOpen = false,
  canManage = false,
  onEditClick = () => {},
  onDeleteClick = () => {},
  isEditDisabled = false,
  isDeleteDisabled = false,
  isReplyDisabled = false,
  isDeleting = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!canManage) {
      setIsMenuOpen(false);
    }
  }, [canManage]);

  useEffect(() => {
    if (isEditDisabled && isDeleteDisabled) {
      setIsMenuOpen(false);
    }
  }, [isEditDisabled, isDeleteDisabled]);

  const commentDate = useMemo(
    () => getTimestampDate(comment.createdAt),
    [comment.createdAt]
  );

  const relativeTime = commentDate ? formatTimeAgo(commentDate) : "";
  const fullDateLabel = commentDate?.toLocaleString();

  const isMenuButtonDisabled = isDeleting || (isEditDisabled && isDeleteDisabled);

  const handleMenuToggle = () => {
    if (isMenuButtonDisabled) return;
    setIsMenuOpen((prev) => !prev);
  };

  const handleEditSelect = () => {
    if (isEditDisabled) return;
    setIsMenuOpen(false);
    onEditClick();
  };

  const handleDeleteSelect = () => {
    if (isDeleteDisabled || isDeleting) return;
    setIsMenuOpen(false);
    onDeleteClick();
  };

  return (
    <div
      id={`comment-${comment.id}`}
      className={`flex gap-4 ${isReply ? "pt-4" : ""}`}
      role="article"
      aria-label={`Comment by ${comment.authorName || "anonymous"}`}
    >
      <CommentAvatar
        authorId={comment.authorId}
        authorName={comment.authorName}
        authorPhotoURL={comment.authorPhotoURL}
        darkMode={darkMode}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {comment.authorId ? (
              <Link
                to={`/user/${comment.authorId}`}
                className={`font-semibold transition hover:underline ${
                  darkMode
                    ? "text-white hover:text-gray-200"
                    : "text-gray-900 hover:text-gray-700"
                }`}
              >
                {comment.authorName || "Anonymous"}
              </Link>
            ) : (
              <span
                className={`font-semibold ${
                  darkMode ? "text-white" : "text-gray-900"
                }`}
              >
                {comment.authorName || "Anonymous"}
              </span>
            )}
            {relativeTime && (
              <time
                className={`text-xs ${
                  darkMode ? "text-gray-400" : "text-gray-500"
                }`}
                dateTime={commentDate?.toISOString()}
                title={fullDateLabel}
              >
                {relativeTime}
              </time>
            )}
          </div>
          {canManage && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={handleMenuToggle}
                disabled={isMenuButtonDisabled}
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full bg-transparent transition-colors focus:outline-none ${
                  darkMode
                    ? "text-gray-300 hover:text-gray-100 hover:bg-gray-800/60"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/40"
                } ${
                  isMenuButtonDisabled
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                }`}
                title="Open comment options"
              >
                <span className="sr-only">Open comment options</span>
                <span
                  aria-hidden="true"
                  className="flex flex-col items-center justify-center gap-[2px]"
                >
                  <span className="block h-1 w-1 rounded-full bg-current" />
                  <span className="block h-1 w-1 rounded-full bg-current" />
                  <span className="block h-1 w-1 rounded-full bg-current" />
                </span>
              </button>
              {isMenuOpen && (
                <div
                  role="menu"
                  className={`absolute right-0 z-20 mt-1 flex flex-col items-end gap-1 text-xs ${
                    darkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleEditSelect}
                    disabled={isEditDisabled}
                    className={`bg-transparent p-0 text-right focus:outline-none ${
                      isEditDisabled
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer"
                    } ${darkMode ? "text-gray-200" : "text-gray-600"}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleDeleteSelect}
                    disabled={isDeleteDisabled || isDeleting}
                    className={`bg-transparent p-0 text-right focus:outline-none ${
                      isDeleteDisabled || isDeleting
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer"
                    } ${
                      darkMode ? "text-red-400" : "text-red-500"
                    }`}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <p
          className={`mt-2 text-sm whitespace-pre-wrap leading-relaxed ${
            darkMode ? "text-gray-200" : "text-gray-700"
          }`}
        >
          {comment.content}
        </p>
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={onReplyClick}
            disabled={!canReply || isReplyDisabled}
            title={
              canReply
                ? isReplyDisabled
                  ? "Action in progress"
                  : "Reply to comment"
                : "Sign in to reply"
            }
            className={`text-sm font-medium transition-colors ${
              canReply
                ? darkMode
                  ? "text-blue-400 hover:text-blue-300"
                  : "text-blue-600 hover:text-blue-700"
                : darkMode
                ? "text-gray-600 cursor-not-allowed"
                : "text-gray-400 cursor-not-allowed"
            } ${isReplyFormOpen ? "underline" : ""}`}
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  );
};

CommentItem.propTypes = {
  comment: commentPropType.isRequired,
  darkMode: PropTypes.bool.isRequired,
  onReplyClick: PropTypes.func.isRequired,
  canReply: PropTypes.bool.isRequired,
  isReply: PropTypes.bool,
  isReplyFormOpen: PropTypes.bool,
  canManage: PropTypes.bool,
  onEditClick: PropTypes.func,
  onDeleteClick: PropTypes.func,
  isEditDisabled: PropTypes.bool,
  isDeleteDisabled: PropTypes.bool,
  isReplyDisabled: PropTypes.bool,
  isDeleting: PropTypes.bool,
};

const ReplyForm = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  darkMode,
  inputId,
}) => (
  <form onSubmit={onSubmit} className="mt-3">
    <label htmlFor={inputId} className="sr-only">
      Reply to comment
    </label>
    <textarea
      id={inputId}
      rows="3"
      value={value}
      onChange={onChange}
      className={`w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        darkMode
          ? "bg-gray-800 text-white border-gray-700 placeholder-gray-500"
          : "bg-white text-gray-900 border-gray-300 placeholder-gray-500"
      }`}
      placeholder="Write a reply..."
      aria-label="Reply to comment"
    />
    <div className="mt-2 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className={`px-3 py-1 text-sm rounded-md transition-colors ${
          darkMode
            ? "text-gray-300 hover:text-gray-100"
            : "text-gray-600 hover:text-gray-800"
        }`}
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSubmitting || !value.trim()}
        className={`px-4 py-1.5 text-sm font-medium rounded-md text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          darkMode ? "bg-blue-600 hover:bg-blue-500" : "bg-blue-500 hover:bg-blue-600"
        }`}
      >
        {isSubmitting ? "Sending..." : "Post Reply"}
      </button>
    </div>
  </form>
);

ReplyForm.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool.isRequired,
  darkMode: PropTypes.bool.isRequired,
  inputId: PropTypes.string.isRequired,
};

const EditForm = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  darkMode,
  inputId,
}) => (
  <form onSubmit={onSubmit} className="mt-3">
    <label htmlFor={inputId} className="sr-only">
      Edit comment
    </label>
    <textarea
      id={inputId}
      rows="3"
      value={value}
      onChange={onChange}
      className={`w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        darkMode
          ? "bg-gray-800 text-white border-gray-700 placeholder-gray-500"
          : "bg-white text-gray-900 border-gray-300 placeholder-gray-500"
      }`}
      placeholder="Update your comment..."
      aria-label="Edit comment"
    />
    <div className="mt-2 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className={`px-3 py-1 text-sm rounded-md transition-colors ${
          darkMode
            ? "text-gray-300 hover:text-gray-100"
            : "text-gray-600 hover:text-gray-800"
        }`}
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSubmitting || !value.trim()}
        className={`px-4 py-1.5 text-sm font-medium rounded-md text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          darkMode ? "bg-blue-600 hover:bg-blue-500" : "bg-blue-500 hover:bg-blue-600"
        }`}
      >
        {isSubmitting ? "Saving..." : "Save Changes"}
      </button>
    </div>
  </form>
);

EditForm.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool.isRequired,
  darkMode: PropTypes.bool.isRequired,
  inputId: PropTypes.string.isRequired,
};

const CommentThread = ({
  parentComment,
  replies = [],
  darkMode,
  onReply,
  onEdit,
  onDelete,
  currentUser = null,
}) => {
  const [activeReplyTargetId, setActiveReplyTargetId] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [isReplySubmitting, setIsReplySubmitting] = useState(false);
  const [activeEditTargetId, setActiveEditTargetId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState(null);

  const canReply = Boolean(currentUser);

  const handleReplyClick = (commentId) => {
    if (!canReply) return;
    setReplyDraft("");
    setActiveEditTargetId(null);
    setEditDraft("");
    setActiveReplyTargetId((prev) => (prev === commentId ? null : commentId));
  };

  const handleReplyCancel = () => {
    setReplyDraft("");
    setActiveReplyTargetId(null);
  };

  const handleReplySubmit = async (event) => {
    event.preventDefault();
    if (!replyDraft.trim() || !canReply) {
      return;
    }

    setIsReplySubmitting(true);
    try {
      await onReply(parentComment.id, replyDraft.trim());
      setReplyDraft("");
      setActiveReplyTargetId(null);
    } finally {
      setIsReplySubmitting(false);
    }
  };

  const renderReplyForm = (targetId) => (
    <ReplyForm
      key={`reply-form-${targetId}`}
      value={replyDraft}
      onChange={(event) => setReplyDraft(event.target.value)}
      onSubmit={handleReplySubmit}
      onCancel={handleReplyCancel}
      isSubmitting={isReplySubmitting}
      darkMode={darkMode}
      inputId={`reply-${targetId}`}
    />
  );

  const handleEditClick = (comment) => {
    setActiveReplyTargetId(null);
    setReplyDraft("");
    setActiveEditTargetId((prev) => {
      if (prev === comment.id) {
        setEditDraft("");
        return null;
      }
      setEditDraft(comment.content);
      return comment.id;
    });
  };

  const handleEditCancel = () => {
    setEditDraft("");
    setActiveEditTargetId(null);
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!editDraft.trim() || !activeEditTargetId) {
      return;
    }

    setIsEditSubmitting(true);
    try {
      await onEdit(activeEditTargetId, editDraft.trim());
      setEditDraft("");
      setActiveEditTargetId(null);
    } catch (error) {
      console.error("Error updating comment:", error);
    } finally {
      setIsEditSubmitting(false);
    }
  };

  const handleDelete = async (commentId) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Are you sure you want to delete this comment? Any replies will also be removed."
      );
      if (!confirmed) {
        return;
      }
    }

    setDeletingCommentId(commentId);
    try {
      await onDelete(commentId);
      setActiveReplyTargetId(null);
      setReplyDraft("");
      if (activeEditTargetId === commentId) {
        setActiveEditTargetId(null);
        setEditDraft("");
      }
    } catch (error) {
      console.error("Error deleting comment:", error);
    } finally {
      setDeletingCommentId(null);
    }
  };

  const renderEditForm = (targetId) => (
    <EditForm
      key={`edit-form-${targetId}`}
      value={editDraft}
      onChange={(event) => setEditDraft(event.target.value)}
      onSubmit={handleEditSubmit}
      onCancel={handleEditCancel}
      isSubmitting={isEditSubmitting}
      darkMode={darkMode}
      inputId={`edit-${targetId}`}
    />
  );

  const currentUserId = currentUser?.uid ?? null;

  return (
    <article
      className={`p-5 rounded-xl border ${
        darkMode ? "border-gray-800 bg-gray-900/60" : "border-gray-200 bg-white"
      } shadow-sm`}
    >
      <CommentItem
        comment={parentComment}
        darkMode={darkMode}
        onReplyClick={() => handleReplyClick(parentComment.id)}
        canReply={canReply}
        isReply={false}
        isReplyFormOpen={activeReplyTargetId === parentComment.id}
        canManage={currentUserId === parentComment.authorId}
        onEditClick={() => handleEditClick(parentComment)}
        onDeleteClick={() => handleDelete(parentComment.id)}
        isEditDisabled={isEditSubmitting || deletingCommentId !== null}
        isDeleteDisabled={
          isEditSubmitting ||
          isReplySubmitting ||
          (deletingCommentId !== null && deletingCommentId !== parentComment.id)
        }
        isReplyDisabled={isEditSubmitting || deletingCommentId !== null}
        isDeleting={deletingCommentId === parentComment.id}
      />
      {activeReplyTargetId === parentComment.id && canReply && renderReplyForm(parentComment.id)}
      {currentUserId === parentComment.authorId &&
        activeEditTargetId === parentComment.id &&
        renderEditForm(parentComment.id)}

      {replies.length > 0 && (
        <div
          className={`mt-5 space-y-4 border-l ${
            darkMode ? "border-gray-800" : "border-gray-200"
          } pl-6 md:pl-8`}
        >
          {replies.map((reply) => (
            <div key={reply.id} className="relative">
              <CommentItem
                comment={reply}
                darkMode={darkMode}
                onReplyClick={() => handleReplyClick(reply.id)}
                canReply={canReply}
                isReply
                isReplyFormOpen={activeReplyTargetId === reply.id}
                canManage={currentUserId === reply.authorId}
                onEditClick={() => handleEditClick(reply)}
                onDeleteClick={() => handleDelete(reply.id)}
                isEditDisabled={isEditSubmitting || deletingCommentId !== null}
                isDeleteDisabled={
                  isEditSubmitting ||
                  isReplySubmitting ||
                  (deletingCommentId !== null && deletingCommentId !== reply.id)
                }
                isReplyDisabled={isEditSubmitting || deletingCommentId !== null}
                isDeleting={deletingCommentId === reply.id}
              />
              {activeReplyTargetId === reply.id && canReply && renderReplyForm(reply.id)}
              {currentUserId === reply.authorId &&
                activeEditTargetId === reply.id &&
                renderEditForm(reply.id)}
            </div>
          ))}
        </div>
      )}

    </article>
  );
};

CommentThread.propTypes = {
  parentComment: commentPropType.isRequired,
  replies: PropTypes.arrayOf(commentPropType),
  darkMode: PropTypes.bool.isRequired,
  onReply: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  currentUser: PropTypes.object,
};

export default CommentThread;

