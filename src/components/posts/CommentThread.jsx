import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import formatTimeAgo, { getTimestampDate } from "../../utils/formatTimeAgo";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";
import useCommentDraft from "../../hooks/useCommentDrafts";
import MentionTextarea from "./MentionTextarea";
import { getBadgeMeta } from "../../constants/badges";
import useCommentLikedByMe from "../../lib/comments/useCommentLikedByMe";

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

const MentionLink = ({ mention, darkMode, authorMetaMap }) => {
  if (!mention?.handle) {
    return null;
  }

  const meta = mention.userId ? authorMetaMap?.[mention.userId] || {} : {};
  const badgeId = Array.isArray(meta.badges)
    ? meta.badges[meta.badges.length - 1]
    : null;
  const badgeMeta = badgeId ? getBadgeMeta(badgeId) : null;
  const avatar = normalizeProfilePhoto(
    mention.avatarUrl || meta.avatarUrl || "",
    64
  );
  const mentionLabel = `@${mention.handle}`;
  const displayName =
    mention.displayName || meta.displayName || mentionLabel.slice(1);

  const tooltipClasses = darkMode
    ? "border-gray-700 bg-gray-900 text-gray-100"
    : "border-gray-200 bg-white text-gray-700";

  return (
    <span className="relative inline-flex group">
      {mention.userId ? (
        <Link
          to={`/user/${mention.userId}`}
          className={`font-semibold ${
            darkMode ? "text-blue-300 hover:text-blue-200" : "text-blue-600"
          }`}
        >
          {mentionLabel}
        </Link>
      ) : (
        <span
          className={`font-semibold ${
            darkMode ? "text-blue-300" : "text-blue-600"
          }`}
        >
          {mentionLabel}
        </span>
      )}
      {mention.userId && (
        <span
          className={`pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-60 rounded-xl border px-3 py-2 text-xs shadow-lg group-hover:flex ${tooltipClasses}`}
        >
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-700 bg-gray-800">
            {avatar ? (
              <img
                src={avatar}
                alt={displayName}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-sm font-semibold">
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <span className="ml-3 flex flex-col space-y-1">
            <span className="text-sm font-semibold">{displayName}</span>
            {Number.isFinite(meta.dailyStreak) && meta.dailyStreak > 0 && (
              <span className="text-[11px] text-gray-400">
                Streak {meta.dailyStreak} days
              </span>
            )}
            {badgeMeta && (
              <span className="text-[11px] text-gray-400">
                Last badge: {badgeMeta.label}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
};

MentionLink.propTypes = {
  mention: PropTypes.shape({
    handle: PropTypes.string,
    userId: PropTypes.string,
    displayName: PropTypes.string,
    avatarUrl: PropTypes.string,
  }),
  darkMode: PropTypes.bool.isRequired,
  authorMetaMap: PropTypes.object,
};

const CommentItem = ({
  comment,
  postId,
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
  replyTooltip = "Reply to comment",
  isTopThread = false,
  isTopReply = false,
  isLikePending = false,
  onLikeToggle = () => {},
  canAuthorPick = false,
  onAuthorPickToggle = () => {},
  isAuthorPickPending = false,
  authorProfile = {},
  authorMetaMap = {},
}) => {
  const likedByMe = useCommentLikedByMe({
    postId,
    commentId: comment.id,
    documentPath: comment.documentPath,
  });
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

  const mentionLookup = useMemo(() => {
    const lookup = new Map();
    if (Array.isArray(comment.mentionHandles)) {
      comment.mentionHandles.forEach((entry) => {
        if (entry?.handle) {
          lookup.set(entry.handle.toLowerCase(), entry);
        }
      });
    }
    return lookup;
  }, [comment.mentionHandles]);

  const badgeList = useMemo(() => {
    const badges = Array.isArray(authorProfile.badges)
      ? authorProfile.badges.slice(-3)
      : [];
    return badges;
  }, [authorProfile.badges]);

  const contentNodes = useMemo(() => {
    if (!comment.content) {
      return null;
    }
    const parts = comment.content.split(/(@[A-Za-z0-9_-]+)/g);
    return parts.map((part, index) => {
      if (!part) {
        return null;
      }
      if (part.startsWith("@")) {
        const handle = part.slice(1);
        const mention =
          mentionLookup.get(handle.toLowerCase()) || {
            handle,
          };
        return (
          <MentionLink
            key={`mention-${comment.id}-${handle}-${index}`}
            mention={mention}
            darkMode={darkMode}
            authorMetaMap={authorMetaMap}
          />
        );
      }
      return (
        <span key={`text-${comment.id}-${index}`}>{part}</span>
      );
    });
  }, [comment.content, comment.id, darkMode, mentionLookup, authorMetaMap]);

  const isMenuButtonDisabled =
    isDeleting || (isEditDisabled && isDeleteDisabled);

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

  const chipClasses = darkMode
    ? "bg-blue-900/30 text-blue-200 border border-blue-800"
    : "bg-blue-50 text-blue-700 border border-blue-200";

  const authorChipClasses = darkMode
    ? "bg-amber-900/30 text-amber-200 border border-amber-800"
    : "bg-amber-50 text-amber-800 border border-amber-200";

  const reactionButtonClasses = likedByMe
    ? darkMode
      ? "text-pink-300"
      : "text-pink-600"
    : darkMode
    ? "text-gray-400 hover:text-pink-200"
    : "text-gray-500 hover:text-pink-600";

  const bodyClasses = [
    "flex-1 min-w-0",
    isTopThread
      ? darkMode
        ? "rounded-2xl border border-blue-900/40 bg-blue-900/30 p-4"
        : "rounded-2xl border border-blue-200 bg-blue-50/70 p-4"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

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
      <div className={bodyClasses}>
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
            {authorProfile.dailyStreak > 2 && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  darkMode
                    ? "bg-orange-900/40 text-orange-200"
                    : "bg-orange-50 text-orange-700"
                }`}
              >
                Streak {authorProfile.dailyStreak}d
              </span>
            )}
            {badgeList.length > 0 && (
              <span className="inline-flex items-center gap-1">
                {badgeList.map((badgeId) => {
                  const badge = getBadgeMeta(badgeId);
                  return (
                    <span
                      key={`${comment.id}-${badgeId}`}
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                        darkMode
                          ? "bg-gray-800 text-yellow-200"
                          : "bg-gray-100 text-yellow-700"
                      }`}
                      title={badge.label}
                    >
                      {badge.icon}
                    </span>
                  );
                })}
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
            {isTopThread && (
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${chipClasses}`}
              >
                Top comment
              </span>
            )}
            {isTopReply && (
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${chipClasses}`}
              >
                Top reply
              </span>
            )}
            {comment.likedByAuthor && (
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${authorChipClasses}`}
              >
                Author liked
              </span>
            )}
          </div>
          {canManage && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={handleMenuToggle}
                disabled={isMenuButtonDisabled}
                className={`text-gray-400 hover:text-gray-200 focus:outline-none bg-transparent ${
                  isMenuButtonDisabled ? "cursor-not-allowed" : ""
                }`}
                aria-haspopup="true"
                aria-expanded={isMenuOpen}
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
                    } ${darkMode ? "text-red-400" : "text-red-500"}`}
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
          {contentNodes}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            onClick={onLikeToggle}
            disabled={isLikePending}
            className={`inline-flex items-center gap-1 font-medium transition-colors disabled:opacity-40 bg-transparent ${reactionButtonClasses}`}
            aria-pressed={likedByMe}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill={likedByMe ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 21.364 4.318 12.682a4.5 4.5 0 010-6.364z"
              />
            </svg>
            <span>{comment.likeCount || 0}</span>
          </button>
          <button
            type="button"
            onClick={onReplyClick}
            disabled={!canReply || isReplyDisabled}
            title={
              canReply
                ? isReplyDisabled
                  ? "Action in progress"
                  : replyTooltip
                : replyTooltip
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
          {!isReply &&
            Number.isFinite(comment.replyCount) &&
            comment.replyCount > 0 && (
              <span
                className={`text-xs ${
                  darkMode ? "text-gray-400" : "text-gray-500"
                }`}
              >
                {comment.replyCount} repl{comment.replyCount === 1 ? "y" : "ies"}
              </span>
            )}
          {canAuthorPick && (
            <button
              type="button"
              onClick={onAuthorPickToggle}
              disabled={isAuthorPickPending}
              className={`text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 ${
                comment.likedByAuthor
                  ? darkMode
                    ? "text-amber-200"
                    : "text-amber-700"
                  : darkMode
                  ? "text-gray-500 hover:text-amber-200"
                  : "text-gray-500 hover:text-amber-600"
              }`}
            >
              {comment.likedByAuthor
                ? "Remove Author Pick"
                : "Mark Author Pick"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

CommentItem.propTypes = {
  comment: commentPropType.isRequired,
  postId: PropTypes.string.isRequired,
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
  replyTooltip: PropTypes.string,
  isTopThread: PropTypes.bool,
  isTopReply: PropTypes.bool,
  isLikePending: PropTypes.bool,
  onLikeToggle: PropTypes.func,
  canAuthorPick: PropTypes.bool,
  onAuthorPickToggle: PropTypes.func,
  isAuthorPickPending: PropTypes.bool,
  authorProfile: PropTypes.shape({
    badges: PropTypes.arrayOf(PropTypes.string),
    dailyStreak: PropTypes.number,
  }),
  authorMetaMap: PropTypes.object,
};

const ReplyForm = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  darkMode,
  inputId,
  errorMessage = "",
}) => (
  <form onSubmit={onSubmit} className="mt-3">
    <label htmlFor={inputId} className="sr-only">
      Reply to comment
    </label>
    <MentionTextarea
      id={inputId}
      rows={3}
      value={value}
      onChange={onChange}
      className={`w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        darkMode
          ? "bg-gray-900 border-gray-700 text-gray-100 placeholder-gray-500"
          : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
      }`}
      placeholder="Write a reply..."
      aria-label="Reply to comment"
      disabled={isSubmitting}
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
    {errorMessage ? (
      <p className="mt-2 text-xs text-red-500" role="alert">
        {errorMessage}
      </p>
    ) : null}
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
  errorMessage: PropTypes.string,
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
  postId,
  replyResolutionSignal = null,
  processingReplyTargetId = null,
  replyErrors = {},
  onClearReplyError = () => {},
  onToggleLike = () => {},
  likeBusyMap = {},
  highlightedReplyIds = [],
  topThreadParentId = null,
  canAuthorPick = false,
  authorPickBusyMap = {},
  onAuthorPickToggle = () => {},
  authorMetaMap = {},
}) => {
  const [activeReplyTargetId, setActiveReplyTargetId] = useState(null);
  const [isReplySubmitting, setIsReplySubmitting] = useState(false);
  const [activeEditTargetId, setActiveEditTargetId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const {
    draft: replyDraft,
    setDraft: setReplyDraft,
    clearDraft: clearReplyDraft,
  } = useCommentDraft(postId, activeReplyTargetId || undefined);
  const lastHandledResolution = useRef(0);

  const canReply = true;
  const currentUserId = currentUser?.uid ?? null;
  const isAdmin =
    currentUser?.role === "admin" ||
    currentUser?.isAdmin === true ||
    currentUser?.role === "ADMIN";

  const isCommentAuthor = (authorId) =>
    Boolean(currentUserId) && Boolean(authorId) && currentUserId === authorId;

  const canEditComment = (authorId) => isCommentAuthor(authorId);

  const canDeleteComment = (authorId) =>
    Boolean(currentUserId) && (isCommentAuthor(authorId) || isAdmin);

  const canManageComment = (authorId) =>
    canEditComment(authorId) || canDeleteComment(authorId);

  const replyNodes = useMemo(() => {
    if (!Array.isArray(replies)) {
      return [];
    }

    return replies
      .map((entry) => {
        if (!entry) return null;
        if (entry.comment && entry.comment.id) {
          return {
            comment: entry.comment,
            depth:
              Number.isFinite(entry.depth) && entry.depth > 0 ? entry.depth : 1,
          };
        }
        if (entry.id) {
          return { comment: entry, depth: 1 };
        }
        return null;
      })
      .filter(Boolean);
  }, [replies]);

  const highlightedReplySet = useMemo(
    () => new Set(highlightedReplyIds || []),
    [highlightedReplyIds]
  );

  const handleReplyClick = (commentId) => {
    onClearReplyError(commentId);
    setActiveEditTargetId(null);
    setEditDraft("");
    setActiveReplyTargetId((prev) => (prev === commentId ? null : commentId));
  };

  // When a reply form is opened, automatically focus its textarea so users can
  // start typing right away after clicking "Reply".
  useEffect(() => {
    if (!activeReplyTargetId) return;

    const inputId = `reply-${activeReplyTargetId}`;

    // Defer to the next frame to ensure the form is mounted in the DOM
    const focusHandle = window.requestAnimationFrame(() => {
      const textarea = document.getElementById(inputId);
      if (textarea && typeof textarea.focus === "function") {
        textarea.focus();
        try {
          const length = textarea.value?.length ?? 0;
          if (typeof textarea.setSelectionRange === "function") {
            textarea.setSelectionRange(length, length);
          }
        } catch {
          // Ignore selection positioning errors (e.g., non-text inputs)
        }
      }
    });

    return () => {
      window.cancelAnimationFrame(focusHandle);
    };
  }, [activeReplyTargetId]);

  const handleReplyCancel = () => {
    const targetId = activeReplyTargetId || parentComment.id;
    onClearReplyError(targetId);
    clearReplyDraft();
    setActiveReplyTargetId(null);
  };

  const handleReplySubmit = async (event) => {
    event.preventDefault();
    const trimmedDraft = replyDraft.trim();
    if (!trimmedDraft) {
      return;
    }

    setIsReplySubmitting(true);
    try {
      const targetId = activeReplyTargetId || parentComment.id;
      // Use the actual target comment as the parent for deeper nesting
      const parentIdForSubmission = targetId;
      if (replyErrors[targetId]) {
        onClearReplyError(targetId);
      }
      const result = await onReply(parentIdForSubmission, trimmedDraft, {
        targetId,
      });

      if (result?.status === "queued" || result?.status === "error") {
        return;
      }

      clearReplyDraft();
      setActiveReplyTargetId(null);
    } finally {
      setIsReplySubmitting(false);
    }
  };

  useEffect(() => {
    if (!replyResolutionSignal || !replyResolutionSignal.timestamp) {
      return;
    }

    if (replyResolutionSignal.timestamp <= lastHandledResolution.current) {
      return;
    }

    const targetId = activeReplyTargetId || parentComment.id;
    if (replyResolutionSignal.targetId === targetId) {
      clearReplyDraft();
      setActiveReplyTargetId(null);
    }

    lastHandledResolution.current = replyResolutionSignal.timestamp;
  }, [
    replyResolutionSignal,
    activeReplyTargetId,
    parentComment.id,
    clearReplyDraft,
  ]);

  const renderReplyForm = (targetId) => {
    const effectiveTargetId = targetId || parentComment.id;
    const externalProcessing =
      processingReplyTargetId !== null &&
      processingReplyTargetId === effectiveTargetId;
    return (
      <ReplyForm
        key={`reply-form-${targetId}`}
        value={replyDraft}
        onChange={(event) => {
          if (replyErrors[effectiveTargetId]) {
            onClearReplyError(effectiveTargetId);
          }
          setReplyDraft(event.target.value);
        }}
        onSubmit={handleReplySubmit}
        onCancel={handleReplyCancel}
        isSubmitting={isReplySubmitting || externalProcessing}
        darkMode={darkMode}
        inputId={`reply-${targetId}`}
        errorMessage={replyErrors[effectiveTargetId] || ""}
      />
    );
  };

  const handleEditClick = (comment) => {
    if (!canEditComment(comment.authorId)) {
      return;
    }

    setActiveReplyTargetId(null);
    clearReplyDraft();
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
      clearReplyDraft();
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

  const parentCanEdit = canEditComment(parentComment.authorId);
  const parentCanDelete = canDeleteComment(parentComment.authorId);
  const parentCanManage = canManageComment(parentComment.authorId);

  const buildItemProps = (comment, { isReply = false } = {}) => ({
    isLikePending: Boolean(likeBusyMap?.[comment.id]),
    onLikeToggle: () => onToggleLike(comment),
    canAuthorPick,
    onAuthorPickToggle: () =>
      onAuthorPickToggle(comment.id, !comment.likedByAuthor),
    isAuthorPickPending: Boolean(authorPickBusyMap?.[comment.id]),
    authorProfile: authorMetaMap?.[comment.authorId] || {},
    authorMetaMap,
    isTopThread: !isReply && topThreadParentId === comment.id,
    isTopReply: isReply && highlightedReplySet.has(comment.id),
  });

  return (
    <article
      className={`p-5 rounded-xl border ${
        darkMode ? "border-gray-800 bg-gray-900/60" : "border-gray-200 bg-white"
      } shadow-sm`}
    >
      <CommentItem
        comment={parentComment}
        postId={postId}
        darkMode={darkMode}
        onReplyClick={() => handleReplyClick(parentComment.id)}
        canReply={canReply}
        isReply={false}
        isReplyFormOpen={activeReplyTargetId === parentComment.id}
        canManage={parentCanManage}
        onEditClick={() => handleEditClick(parentComment)}
        onDeleteClick={() => handleDelete(parentComment.id)}
        isEditDisabled={
          !parentCanEdit || isEditSubmitting || deletingCommentId !== null
        }
        isDeleteDisabled={
          !parentCanDelete ||
          isEditSubmitting ||
          isReplySubmitting ||
          (deletingCommentId !== null && deletingCommentId !== parentComment.id)
        }
        isReplyDisabled={
          isEditSubmitting ||
          deletingCommentId !== null ||
          (processingReplyTargetId !== null &&
            processingReplyTargetId === parentComment.id)
        }
        isDeleting={deletingCommentId === parentComment.id}
        replyTooltip={
          currentUser
            ? "Reply to comment"
            : "Reply to comment (choose how to post when you send)"
        }
        {...buildItemProps(parentComment, { isReply: false })}
      />
      {activeReplyTargetId === parentComment.id && canReply && renderReplyForm(parentComment.id)}
      {currentUserId === parentComment.authorId &&
        activeEditTargetId === parentComment.id &&
        renderEditForm(parentComment.id)}

      {replyNodes.length > 0 && (
        <div
          className={`mt-5 space-y-4 border-l ${
            darkMode ? "border-gray-800" : "border-gray-200"
          } pl-6 md:pl-8`}
        >
          {replyNodes.map(({ comment: reply, depth }) => {
            const replyCanEdit = canEditComment(reply.authorId);
            const replyCanDelete = canDeleteComment(reply.authorId);
            const replyCanManage = canManageComment(reply.authorId);
            const indentLevel = Math.max(0, (depth || 1) - 1);
            const indentationRem = Math.min(indentLevel, 6) * 1.5;
            return (
              <div
                key={reply.id}
                className="relative"
                style={
                  indentLevel > 0
                    ? { marginLeft: `${indentationRem}rem` }
                    : undefined
                }
              >
                <CommentItem
                  comment={reply}
                  postId={postId}
                  darkMode={darkMode}
                  onReplyClick={() => handleReplyClick(reply.id)}
                  canReply={canReply}
                  isReply
                  isReplyFormOpen={activeReplyTargetId === reply.id}
                  canManage={replyCanManage}
                  onEditClick={() => handleEditClick(reply)}
                  onDeleteClick={() => handleDelete(reply.id)}
                  isEditDisabled={
                    !replyCanEdit ||
                    isEditSubmitting ||
                    deletingCommentId !== null
                  }
                  isDeleteDisabled={
                    !replyCanDelete ||
                    isEditSubmitting ||
                    isReplySubmitting ||
                    (deletingCommentId !== null &&
                      deletingCommentId !== reply.id)
                  }
                  isReplyDisabled={
                    isEditSubmitting ||
                    deletingCommentId !== null ||
                    (processingReplyTargetId !== null &&
                      processingReplyTargetId === reply.id)
                  }
                  isDeleting={deletingCommentId === reply.id}
                  replyTooltip={
                    currentUser
                      ? "Reply to comment"
                      : "Reply to comment (choose how to post when you send)"
                  }
                  {...buildItemProps(reply, { isReply: true })}
                />
                {activeReplyTargetId === reply.id &&
                  canReply &&
                  renderReplyForm(reply.id)}
                {currentUserId === reply.authorId &&
                  activeEditTargetId === reply.id &&
                  renderEditForm(reply.id)}
              </div>
            );
          })}
        </div>
      )}

    </article>
  );
};

CommentThread.propTypes = {
  parentComment: commentPropType.isRequired,
  replies: PropTypes.arrayOf(
    PropTypes.oneOfType([
      commentPropType,
      PropTypes.shape({
        comment: commentPropType.isRequired,
        depth: PropTypes.number,
      }),
    ])
  ),
  darkMode: PropTypes.bool.isRequired,
  onReply: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  currentUser: PropTypes.object,
  postId: PropTypes.string.isRequired,
  replyResolutionSignal: PropTypes.shape({
    targetId: PropTypes.string,
    status: PropTypes.string,
    timestamp: PropTypes.number,
  }),
  processingReplyTargetId: PropTypes.string,
  replyErrors: PropTypes.objectOf(PropTypes.string),
  onClearReplyError: PropTypes.func,
  onToggleLike: PropTypes.func,
  likeBusyMap: PropTypes.object,
  highlightedReplyIds: PropTypes.arrayOf(PropTypes.string),
  topThreadParentId: PropTypes.string,
  canAuthorPick: PropTypes.bool,
  authorPickBusyMap: PropTypes.object,
  onAuthorPickToggle: PropTypes.func,
  authorMetaMap: PropTypes.object,
};

export default CommentThread;



