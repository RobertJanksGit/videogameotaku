import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import formatTimeAgo, { getTimestampDate } from "../../utils/formatTimeAgo";

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

  const avatar = (
    <span
      className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 ring-2 ${
        darkMode ? "bg-gray-700 ring-gray-600" : "bg-gray-100 ring-gray-200"
      }`}
    >
      {authorPhotoURL ? (
        <img
          src={authorPhotoURL}
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
}) => {
  const commentDate = useMemo(
    () => getTimestampDate(comment.createdAt),
    [comment.createdAt]
  );

  const relativeTime = commentDate ? formatTimeAgo(commentDate) : "";
  const fullDateLabel = commentDate?.toLocaleString();

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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {comment.authorId ? (
            <Link
              to={`/user/${comment.authorId}`}
              className={`font-semibold transition hover:underline ${
                darkMode ? "text-white hover:text-gray-200" : "text-gray-900 hover:text-gray-700"
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
            disabled={!canReply}
            title={canReply ? "Reply to comment" : "Sign in to reply"}
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

const CommentThread = ({
  parentComment,
  replies = [],
  darkMode,
  onReply,
  currentUser = null,
}) => {
  const [activeReplyTargetId, setActiveReplyTargetId] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canReply = Boolean(currentUser);

  const handleReplyClick = (commentId) => {
    if (!canReply) return;
    setReplyDraft("");
    setActiveReplyTargetId((prev) => (prev === commentId ? null : commentId));
  };

  const handleCancel = () => {
    setReplyDraft("");
    setActiveReplyTargetId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!replyDraft.trim() || !canReply) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onReply(parentComment.id, replyDraft.trim());
      setReplyDraft("");
      setActiveReplyTargetId(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderReplyForm = (targetId) => (
    <ReplyForm
      key={`reply-form-${targetId}`}
      value={replyDraft}
      onChange={(event) => setReplyDraft(event.target.value)}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      isSubmitting={isSubmitting}
      darkMode={darkMode}
      inputId={`reply-${targetId}`}
    />
  );

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
      />
      {activeReplyTargetId === parentComment.id && canReply && renderReplyForm(parentComment.id)}

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
              />
              {activeReplyTargetId === reply.id && canReply && renderReplyForm(reply.id)}
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
  currentUser: PropTypes.object,
};

export default CommentThread;

