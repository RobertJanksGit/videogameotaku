import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { db, functions } from "../../config/firebase";
import {
  doc,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  setDoc,
  increment,
  writeBatch,
  onSnapshot,
  collection,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import VoteButtons from "./VoteButtons";
import ShareButtons from "../common/ShareButtons";
import CommentThread from "./CommentThread";
import RichContent from "./RichContent";
import SEO, { createTeaser } from "../common/SEO";
import StructuredData from "../common/StructuredData";
import Breadcrumbs from "../common/Breadcrumbs";
import OptimizedImage from "../common/OptimizedImage";
import { getTimestampDate } from "../../utils/formatTimeAgo";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";
import { markStarterPackCommented } from "../../utils/starterPackStorage";
import useCommentDraft, { buildDraftKey } from "../../hooks/useCommentDrafts";
import InlineCommentAuthPrompt from "./InlineCommentAuthPrompt";
import AuthModal from "../auth/AuthModal";
import CommentGate from "./CommentGate";
import {
  postCommentsCollection,
  postCommentDoc,
  commentDocFromPath,
} from "../../utils/commentRefs";
import { buildMentionPayload } from "../../utils/mentions";
import useAuthorRanks from "../../hooks/useAuthorRanks";
import { useToast } from "../../contexts/ToastContext";
import { getBadgeMeta } from "../../constants/badges";
import toggleCommentLikeAction from "../../lib/comments/toggleLike";

const findParentCommentId = (comment) => {
  if (
    comment.parentCommentId !== undefined &&
    comment.parentCommentId !== null
  ) {
    return comment.parentCommentId;
  }
  if (comment.parentId !== undefined && comment.parentId !== null) {
    return comment.parentId;
  }
  return null;
};

const sortByCreatedAtAsc = (a, b) => {
  const dateA = getTimestampDate(a.createdAt) || new Date(0);
  const dateB = getTimestampDate(b.createdAt) || new Date(0);
  return dateA.getTime() - dateB.getTime();
};

const sortByCreatedAtDesc = (a, b) => -sortByCreatedAtAsc(a, b);

const sortByScoreDesc = (a, b) => {
  const scoreA = Number.isFinite(a.score) ? a.score : 0;
  const scoreB = Number.isFinite(b.score) ? b.score : 0;
  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }
  return sortByCreatedAtDesc(a, b);
};

const buildCommentThreads = (comments, sortMode = "newest") => {
  const repliesByParent = comments.reduce((acc, comment) => {
    const parentId = findParentCommentId(comment);
    if (parentId) {
      if (!acc[parentId]) {
        acc[parentId] = [];
      }
      acc[parentId].push(comment);
    }
    return acc;
  }, {});

  const parentComments = comments
    .filter((comment) => findParentCommentId(comment) === null)
    .sort(sortMode === "top" ? sortByScoreDesc : sortByCreatedAtDesc);

  const visited = new Set();

  const collectReplies = (parentId, depth = 1) => {
    const children = (repliesByParent[parentId] || []).sort(sortByCreatedAtAsc);
    const results = [];

    for (const child of children) {
      if (!child?.id || visited.has(child.id)) {
        continue;
      }

      visited.add(child.id);
      results.push({ comment: child, depth: Math.max(1, depth) });
      results.push(...collectReplies(child.id, depth + 1));
    }

    return results;
  };

  return parentComments.map((comment) => {
    if (comment?.id) {
      visited.add(comment.id);
    }
    return {
      parent: comment,
      replies: collectReplies(comment.id, 1),
    };
  });
};

const TOP_REPLY_THRESHOLD = 5;

const collectTopReplies = (threads) => {
  const topReplyIds = new Set();
  threads.forEach(({ replies }) => {
    if (!Array.isArray(replies) || replies.length === 0) {
      return;
    }
    const sortedReplies = [...replies].sort((a, b) =>
      sortByScoreDesc(a.comment, b.comment)
    );
    const candidate = sortedReplies[0]?.comment;
    if (!candidate) {
      return;
    }
    const qualifies =
      (candidate.score || 0) >= TOP_REPLY_THRESHOLD || candidate.likedByAuthor;
    if (qualifies && candidate.id) {
      topReplyIds.add(candidate.id);
    }
  });
  return topReplyIds;
};

// COMMENT FLOW:
// - Determines comment access by checking `user` from AuthContext (unauthenticated users see sign-in prompt).
// - `handleSubmitComment`, `handleReply`, `handleEditComment`, `handleDeleteComment` all guard on `user`/ownership to enforce auth.
// - New comments and replies are written via Firestore `addDoc` to the `comments` collection; counts and notifications update related docs.
// TODO: COMMENT FLOW ENHANCEMENTS COMPLETE GÇô see summary above.
const PostDetail = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { darkMode } = useTheme();
  const { user, signInWithGoogle } = useAuth();
  const { showErrorToast } = useToast();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentSort, setCommentSort] = useState("top");
  const [likeBusyMap, setLikeBusyMap] = useState({});
  const [authorPickBusyMap, setAuthorPickBusyMap] = useState({});
  const [isWritePostBusy, setIsWritePostBusy] = useState(false);
  const hasScrolledToComment = useRef(false);
  const commentsSectionRef = useRef(null);
  const {
    draft: newCommentDraft,
    setDraft: setNewCommentDraft,
    clearDraft: clearNewCommentDraft,
  } = useCommentDraft(postId);
  const [commentError, setCommentError] = useState("");
  const [replyErrors, setReplyErrors] = useState({});
  const [pendingSubmission, setPendingSubmission] = useState(null);
  const [isInlineAuthPromptOpen, setInlineAuthPromptOpen] = useState(false);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [replyResolutionSignal, setReplyResolutionSignal] = useState(null);
  const [isProcessingPending, setIsProcessingPending] = useState(false);
  const previousUserRef = useRef(user);
  const commentThreads = useMemo(
    () => buildCommentThreads(comments, commentSort),
    [comments, commentSort]
  );
  const highlightedReplyIds = useMemo(
    () => collectTopReplies(commentThreads),
    [commentThreads]
  );
  const highlightedReplyIdsArray = useMemo(
    () => Array.from(highlightedReplyIds),
    [highlightedReplyIds]
  );
  const topThreadParentId =
    commentSort === "top" && commentThreads.length > 0
      ? commentThreads[0].parent?.id || null
      : null;
  const canAuthorPick = Boolean(post?.authorId && user?.uid === post?.authorId);
  const authorPickSummary = useMemo(() => {
    const liked = comments.filter((comment) => comment.likedByAuthor);
    if (!liked.length) {
      return null;
    }
    const sorted = [...liked].sort(sortByScoreDesc);
    const top = sorted[0];
    if (!top) {
      return null;
    }
    return {
      commentId: top.id,
      authorName: top.authorName,
    };
  }, [comments]);
  const authorIdsForMeta = useMemo(() => {
    const ids = new Set();
    comments.forEach((comment) => {
      if (comment.authorId) {
        ids.add(comment.authorId);
      }
      if (Array.isArray(comment.mentions)) {
        comment.mentions.forEach((mentionedId) => ids.add(mentionedId));
      }
    });
    if (post?.authorId) {
      ids.add(post.authorId);
    }
    return Array.from(ids);
  }, [comments, post?.authorId]);
  const authorMeta = useAuthorRanks(authorIdsForMeta);
  const postAuthorMeta = post?.authorId ? authorMeta[post.authorId] : null;
  const postAuthorLastBadgeId = postAuthorMeta?.badges?.length
    ? postAuthorMeta.badges[postAuthorMeta.badges.length - 1]
    : postAuthorMeta?.lastBadge || "";
  const postAuthorLastBadgeMeta = postAuthorLastBadgeId
    ? getBadgeMeta(postAuthorLastBadgeId)
    : null;
  const authorLikeCallable = useMemo(
    () => httpsCallable(functions, "authorLikeToggle"),
    []
  );
  const targetCommentIdFromState = location.state?.targetCommentId ?? null;
  const targetCommentIdFromHash = useMemo(() => {
    if (!location.hash) return null;
    if (location.hash.startsWith("#comment-")) {
      return location.hash.replace("#comment-", "");
    }
    return null;
  }, [location.hash]);

  const scrollToComment = (commentId) => {
    if (!commentId) return;

    const attemptScroll = (attempt = 0) => {
      const commentElement = document.getElementById(`comment-${commentId}`);
      if (commentElement) {
        commentElement.scrollIntoView({ behavior: "smooth", block: "center" });
        commentElement.classList.add("highlight-comment");
        setTimeout(() => {
          commentElement.classList.remove("highlight-comment");
        }, 3000);
        return;
      }

      if (attempt < 10) {
        setTimeout(() => attemptScroll(attempt + 1), 200);
      }
    };

    attemptScroll();
  };

  const resolveCommentDocRef = useCallback(
    (comment) => {
      if (!comment) {
        return null;
      }
      if (comment.documentPath) {
        try {
          return commentDocFromPath(db, comment.documentPath);
        } catch (error) {
          console.warn(
            "Failed to resolve comment path",
            comment.documentPath,
            error
          );
        }
      }
      if (postId && comment.id) {
        return postCommentDoc(db, postId, comment.id);
      }
      return null;
    },
    [postId]
  );

  useEffect(() => {
    if (!postId) return;

    setLoading(true);
    const postRef = doc(db, "posts", postId);

    const unsubscribe = onSnapshot(
      postRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setLoading(false);
          navigate("/");
          return;
        }

        const postData = { id: snapshot.id, ...snapshot.data() };
        setPost(postData);
        document.title = `${postData.title} | Video Game Otaku`;
        setLoading(false);
      },
      (error) => {
        console.error("Error listening to post:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [postId, navigate]);

  useEffect(() => {
    if (!postId) return undefined;

    setCommentsLoading(true);
    let scopedComments = [];
    let legacyComments = [];

    const mergeAndSet = () => {
      const mergedMap = new Map();
      scopedComments.forEach((comment) => {
        mergedMap.set(comment.documentPath || comment.id, comment);
      });
      legacyComments.forEach((comment) => {
        if (!mergedMap.has(comment.documentPath || comment.id)) {
          mergedMap.set(comment.documentPath || comment.id, comment);
        }
      });
      const mergedList = Array.from(mergedMap.values()).sort(
        sortByCreatedAtAsc
      );
      setComments(mergedList);
      setCommentsLoading(false);
    };

    const formatSnapshot = (snapshot) =>
      snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data() || {};
        return {
          id: docSnapshot.id,
          ...data,
          replyCount: data.replyCount ?? 0,
          likeCount: data.likeCount ?? 0,
          likedByAuthor: Boolean(data.likedByAuthor),
          score: Number.isFinite(data.score) ? data.score : 0,
          documentPath: docSnapshot.ref.path,
        };
      });

    const scopedQueryRef = query(
      postCommentsCollection(db, postId),
      orderBy("createdAt", "asc")
    );

    const legacyQueryRef = query(
      collection(db, "comments"),
      where("postId", "==", postId),
      orderBy("createdAt", "asc")
    );

    const unsubscribeScoped = onSnapshot(
      scopedQueryRef,
      (snapshot) => {
        scopedComments = formatSnapshot(snapshot);
        mergeAndSet();
      },
      (error) => {
        console.error("Error listening to scoped comments:", error);
        setCommentsLoading(false);
      }
    );

    const unsubscribeLegacy = onSnapshot(
      legacyQueryRef,
      (snapshot) => {
        legacyComments = formatSnapshot(snapshot);
        mergeAndSet();
      },
      (error) => {
        console.error("Error listening to legacy comments:", error);
      }
    );

    return () => {
      unsubscribeScoped();
      unsubscribeLegacy();
    };
  }, [postId]);

  // Always start each post view at the top of the page
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [postId]);

  // Separate useEffect for handling comment scrolling when explicitly targeted
  useEffect(() => {
    if (
      !loading &&
      !commentsLoading &&
      comments.length > 0 &&
      !hasScrolledToComment.current
    ) {
      const targetCommentId =
        targetCommentIdFromState || targetCommentIdFromHash;

      if (targetCommentId) {
        scrollToComment(targetCommentId);
        hasScrolledToComment.current = true;
      }
    }
  }, [
    loading,
    commentsLoading,
    comments,
    targetCommentIdFromState,
    targetCommentIdFromHash,
  ]);

  useEffect(() => {
    if (
      !hasScrolledToComment.current &&
      typeof window !== "undefined" &&
      location.hash === "#comments"
    ) {
      commentsSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      hasScrolledToComment.current = true;
    }
  }, [location.hash]);

  // Reset the scroll flag when the postId or target changes
  useEffect(() => {
    hasScrolledToComment.current = false;
  }, [
    postId,
    targetCommentIdFromState,
    targetCommentIdFromHash,
    location.hash,
  ]);

  const resolveAuthorName = useCallback((authUser) => {
    if (!authUser) return "Guest";
    return (
      authUser.profile?.displayName ||
      authUser.displayName ||
      authUser.name ||
      (authUser.email ? authUser.email.split("@")[0] : "Guest")
    );
  }, []);

  const resolveAuthorPhoto = useCallback(
    (authUser) =>
      normalizeProfilePhoto(
        authUser?.profile?.avatarUrl ||
          authUser?.photoURL ||
          authUser?.photoUrl ||
          ""
      ),
    []
  );

  const signedInCommentLabel = useMemo(() => {
    if (!user) {
      return "";
    }
    return `Posting as ${resolveAuthorName(user)}`;
  }, [user, resolveAuthorName]);

  const scrollToComments = useCallback(() => {
    if (commentsSectionRef.current) {
      commentsSectionRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, []);

  const handleWritePostClick = useCallback(async () => {
    if (isWritePostBusy) {
      return;
    }

    if (user && !user.isAnonymous) {
      navigate("/dashboard#share-your-find");
      return;
    }

    setIsWritePostBusy(true);
    try {
      await signInWithGoogle();
      navigate("/dashboard#share-your-find");
    } catch (error) {
      console.error("Failed to initiate write-post flow", error);
      const message =
        typeof error?.message === "string"
          ? error.message
          : "Unable to start Google sign-in right now.";
      showErrorToast(message);
    } finally {
      setIsWritePostBusy(false);
    }
  }, [isWritePostBusy, user, navigate, signInWithGoogle, showErrorToast]);

  const interpretCommentError = useCallback((error) => {
    if (!error) {
      return "Unable to post comment. Please try again.";
    }

    if (error.code === "resource-exhausted") {
      return "You're commenting a bit fast. Please wait a moment and try again.";
    }

    if (error.code === "permission-denied") {
      return "You're commenting a bit fast. Please wait a moment and try again.";
    }

    if (typeof error.message === "string") {
      const message = error.message.toLowerCase();
      if (message.includes("rate") || message.includes("fast")) {
        return "You're commenting a bit fast. Please wait a moment and try again.";
      }
    }

    return "Unable to post comment. Please try again.";
  }, []);

  useEffect(() => {
    // Add styles for comment highlighting
    const style = document.createElement("style");
    style.textContent = `
      .highlight-comment {
        animation: highlight 3s ease-out;
      }
      
      @keyframes highlight {
        0% {
          background-color: rgba(59, 130, 246, 0.2);
        }
        100% {
          background-color: transparent;
        }
      }
      
      .dark .highlight-comment {
        animation: highlight-dark 3s ease-out;
      }
      
      @keyframes highlight-dark {
        0% {
          background-color: rgba(30, 58, 138, 0.3);
        }
        100% {
          background-color: transparent;
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // COMMENT FLOW RULES SYNC:
  // - Comments write to /comments/{commentId}
  // - Payload matches isValidCommentData in firestore.rules
  // - commentMeta/{uid}.lastCommentTime is updated with serverTimestamp()
  // - Anonymous and regular users are both allowed, with a 10s throttle
  const performCommentWrite = useCallback(
    async (content) => {
      if (!user) {
        return {
          status: "error",
          message: "You need to sign in before commenting.",
        };
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return { status: "error", message: "Comment cannot be empty." };
      }

      setIsSubmittingComment(true);
      setCommentError("");

      try {
        const authorName = resolveAuthorName(user);
        const authorPhotoURL = resolveAuthorPhoto(user);
        let mentionPayload = { mentionUserIds: [], mentionMetadata: [] };
        try {
          mentionPayload = await buildMentionPayload(db, trimmedContent);
        } catch (mentionError) {
          console.warn(
            "Unable to resolve mentions before submit",
            mentionError
          );
        }

        const commentPayload = {
          postId,
          content: trimmedContent,
          authorId: user.uid,
          authorName,
          authorPhotoURL,
          parentId: null,
          parentCommentId: null,
          threadRootCommentId: null,
          createdAt: serverTimestamp(),
          replyCount: 0,
          likeCount: 0,
          likedByAuthor: false,
          score: 0,
          mentions: mentionPayload.mentionUserIds,
          mentionHandles: mentionPayload.mentionMetadata,
        };

        const commentRef = await addDoc(
          postCommentsCollection(db, postId),
          commentPayload
        );

        const newCommentObj = {
          id: commentRef.id,
          ...commentPayload,
          createdAt: new Date(),
        };

        clearNewCommentDraft();

        const postRef = doc(db, "posts", postId);
        try {
          await updateDoc(postRef, {
            commentCount: increment(1),
          });
        } catch (error) {
          console.error("Error updating post comment count:", error);
        }

        setPost((prevPost) => {
          if (!prevPost) return prevPost;
          return {
            ...prevPost,
            commentCount: (prevPost.commentCount || 0) + 1,
          };
        });

        try {
          await setDoc(
            doc(db, "commentMeta", user.uid),
            {
              lastCommentTime: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (metaError) {
          console.error(
            "Error updating comment rate limit metadata:",
            metaError
          );
        }

        markStarterPackCommented(user.uid);

        return { status: "posted", comment: newCommentObj };
      } catch (error) {
        console.error("Error adding comment:", error);
        const friendlyMessage = interpretCommentError(error);
        setCommentError(friendlyMessage);
        return { status: "error", error, message: friendlyMessage };
      } finally {
        setIsSubmittingComment(false);
      }
    },
    [
      user,
      postId,
      clearNewCommentDraft,
      interpretCommentError,
      resolveAuthorName,
      resolveAuthorPhoto,
    ]
  );

  const performReplyWrite = useCallback(
    async (parentId, content, { targetId } = {}) => {
      if (!user) {
        return {
          status: "error",
          message: "You need to sign in before replying.",
        };
      }

      const parentComment = comments.find((comment) => comment.id === parentId);
      if (!parentComment) {
        console.warn("Parent comment not found:", parentId);
        return {
          status: "error",
          message: "The comment you replied to is no longer available.",
          targetId,
        };
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return { status: "error", message: "Reply cannot be empty.", targetId };
      }

      console.log("[Comments] currentUser (reply)", {
        uid: user.uid,
        isAnonymous: user.isAnonymous,
      });

      const authorName = resolveAuthorName(user);
      const authorPhotoURL = resolveAuthorPhoto(user);
      const effectiveTargetId = targetId || parentId;

      try {
        let mentionPayload = { mentionUserIds: [], mentionMetadata: [] };
        try {
          mentionPayload = await buildMentionPayload(db, trimmedContent);
        } catch (mentionError) {
          console.warn("Unable to resolve mentions before reply", mentionError);
        }

        const replyPayload = {
          postId,
          content: trimmedContent,
          authorId: user.uid,
          authorName,
          authorPhotoURL,
          parentId,
          parentCommentId: parentId,
          threadRootCommentId:
            parentComment.threadRootCommentId ||
            parentComment.parentCommentId ||
            parentComment.id,
          createdAt: serverTimestamp(),
          replyCount: 0,
          likeCount: 0,
          likedByAuthor: false,
          score: 0,
          mentions: mentionPayload.mentionUserIds,
          mentionHandles: mentionPayload.mentionMetadata,
        };

        console.log("[Comments] reply payload", replyPayload);

        const replyRef = await addDoc(
          postCommentsCollection(db, postId),
          replyPayload
        );

        console.log("[Comments] wrote reply doc", {
          path: replyRef.path,
        });

        const newReply = {
          id: replyRef.id,
          ...replyPayload,
          createdAt: new Date(),
        };

        const parentCommentRef = resolveCommentDocRef(parentComment);
        if (parentCommentRef) {
          await updateDoc(parentCommentRef, {
            replyCount: increment(1),
          });
        }

        const postRef = doc(db, "posts", postId);
        await updateDoc(postRef, {
          commentCount: increment(1),
        });

        setPost((prevPost) => {
          if (!prevPost) return prevPost;
          return {
            ...prevPost,
            commentCount: (prevPost.commentCount || 0) + 1,
          };
        });

        markStarterPackCommented(user.uid);

        try {
          console.log("[Comments] updating commentMeta (reply)", {
            uid: user.uid,
          });
          await setDoc(
            doc(db, "commentMeta", user.uid),
            {
              lastCommentTime: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (metaError) {
          console.error(
            "Error updating comment rate limit metadata (reply):",
            metaError
          );
        }

        return {
          status: "posted",
          reply: newReply,
          targetId: effectiveTargetId,
        };
      } catch (error) {
        console.error("Error adding reply:", error);
        const friendlyMessage = interpretCommentError(error);
        return {
          status: "error",
          error,
          message: friendlyMessage,
          targetId: effectiveTargetId,
        };
      }
    },
    [
      user,
      comments,
      postId,
      resolveCommentDocRef,
      interpretCommentError,
      resolveAuthorName,
      resolveAuthorPhoto,
    ]
  );

  const handleClearReplyError = useCallback((targetId) => {
    if (!targetId) return;
    setReplyErrors((prev) => {
      if (!prev[targetId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  }, []);

  const queueOrSubmit = useCallback(
    async (action) => {
      if (!user) {
        setPendingSubmission({
          ...action,
          timestamp: Date.now(),
        });
        setInlineAuthPromptOpen(true);
        return { status: "queued" };
      }

      if (action.type === "comment") {
        return performCommentWrite(action.content);
      }

      if (action.type === "reply") {
        return performReplyWrite(action.parentId, action.content, {
          targetId: action.targetId,
        });
      }

      return { status: "idle" };
    },
    [user, performCommentWrite, performReplyWrite]
  );

  const handleSubmitComment = async (event, { contentOverride } = {}) => {
    event?.preventDefault();
    if (isSubmittingComment || isProcessingPending) {
      return;
    }

    const content = (contentOverride ?? newCommentDraft).trim();
    if (!content) {
      return;
    }

    setCommentError("");

    const result = await queueOrSubmit({ type: "comment", content });

    if (result?.status === "posted") {
      setCommentError("");
    } else if (result?.status === "error") {
      setCommentError(result.message || interpretCommentError(result.error));
    }
  };

  const handleReplyRequest = useCallback(
    async (parentId, content, options = {}) => {
      const targetId = options.targetId || parentId;
      const result = await queueOrSubmit({
        type: "reply",
        parentId,
        content,
        targetId,
      });

      if (result?.status === "posted") {
        const finalTargetId = result.targetId || options.targetId || parentId;
        setReplyResolutionSignal({
          targetId: finalTargetId,
          status: "posted",
          timestamp: Date.now(),
        });
        handleClearReplyError(finalTargetId);
      } else if (result?.status === "error") {
        const finalTargetId = result.targetId || options.targetId || parentId;
        setReplyErrors((prev) => ({
          ...prev,
          [finalTargetId]:
            result.message || interpretCommentError(result.error),
        }));
      } else if (result?.status === "queued") {
        handleClearReplyError(targetId);
      }

      return result;
    },
    [queueOrSubmit, handleClearReplyError, interpretCommentError]
  );

  const submitPendingSubmission = useCallback(async () => {
    if (!pendingSubmission || !user) {
      return { status: "idle" };
    }

    setIsProcessingPending(true);
    try {
      let result;
      if (pendingSubmission.type === "comment") {
        result = await performCommentWrite(pendingSubmission.content);
        if (result?.status === "error") {
          setCommentError(
            result.message || interpretCommentError(result.error)
          );
        }
      } else if (pendingSubmission.type === "reply") {
        result = await performReplyWrite(
          pendingSubmission.parentId,
          pendingSubmission.content,
          { targetId: pendingSubmission.targetId }
        );

        const targetId =
          result?.targetId ||
          pendingSubmission.targetId ||
          pendingSubmission.parentId;

        if (result?.status === "posted") {
          setReplyResolutionSignal({
            targetId,
            status: "posted",
            timestamp: Date.now(),
          });
          handleClearReplyError(targetId);
          if (typeof window !== "undefined") {
            const draftKey = buildDraftKey(postId, targetId);
            if (draftKey) {
              try {
                window.localStorage.removeItem(draftKey);
              } catch (storageError) {
                console.warn(
                  "Unable to clear reply draft from storage",
                  storageError
                );
              }
            }
          }
        } else if (result?.status === "error") {
          setReplyErrors((prev) => ({
            ...prev,
            [targetId]: result.message || interpretCommentError(result.error),
          }));
        }
      }

      if (result?.status === "posted" || result?.status === "error") {
        setPendingSubmission(null);
      }

      return result;
    } finally {
      setIsProcessingPending(false);
    }
  }, [
    pendingSubmission,
    user,
    performCommentWrite,
    performReplyWrite,
    interpretCommentError,
    handleClearReplyError,
    postId,
  ]);

  useEffect(() => {
    if (
      pendingSubmission &&
      user &&
      !isProcessingPending &&
      !previousUserRef.current
    ) {
      submitPendingSubmission();
    }
    previousUserRef.current = user;
  }, [user, pendingSubmission, isProcessingPending, submitPendingSubmission]);

  const handleInlineAuthSuccess = useCallback(async () => {
    setInlineAuthPromptOpen(false);
    await submitPendingSubmission();
  }, [submitPendingSubmission]);

  const handleInlinePromptClose = useCallback(() => {
    setInlineAuthPromptOpen(false);
    setPendingSubmission(null);
  }, []);

  const handleCommentChange = (event) => {
    if (commentError) {
      setCommentError("");
    }
    setNewCommentDraft(event.target.value);
  };

  const handleCommentKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isSubmittingComment || isProcessingPending) {
        return;
      }
      handleSubmitComment(event);
    }
  };

  const processingReplyTargetId =
    isProcessingPending && pendingSubmission?.type === "reply"
      ? pendingSubmission.targetId || pendingSubmission.parentId
      : null;

  const isCommentProcessing =
    isSubmittingComment ||
    (isProcessingPending && pendingSubmission?.type === "comment");

  const handleEditComment = async (commentId, updatedContent) => {
    if (!user) {
      console.warn("No user found - authentication error");
      return;
    }

    const commentToUpdate = comments.find(
      (comment) => comment.id === commentId
    );
    if (!commentToUpdate) {
      console.warn("Comment not found:", commentId);
      return;
    }

    if (commentToUpdate.authorId !== user.uid) {
      console.warn(
        "User attempted to edit a comment they do not own:",
        commentId
      );
      return;
    }

    const trimmedContent = updatedContent.trim();
    if (!trimmedContent || trimmedContent === commentToUpdate.content) {
      return;
    }

    try {
      const commentRef = resolveCommentDocRef(commentToUpdate);
      if (!commentRef) {
        throw new Error("Unable to resolve comment reference");
      }
      let mentionPayload = { mentionUserIds: [], mentionMetadata: [] };
      try {
        mentionPayload = await buildMentionPayload(db, trimmedContent);
      } catch (mentionError) {
        console.warn("Unable to resolve mentions before edit", mentionError);
      }
      await updateDoc(commentRef, {
        content: trimmedContent,
        updatedAt: serverTimestamp(),
        mentions: mentionPayload.mentionUserIds,
        mentionHandles: mentionPayload.mentionMetadata,
      });

      setComments((prevComments) =>
        prevComments.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                content: trimmedContent,
                mentions: mentionPayload.mentionUserIds,
                mentionHandles: mentionPayload.mentionMetadata,
                updatedAt: new Date(),
              }
            : comment
        )
      );
    } catch (error) {
      console.error("Error updating comment:", error);
      throw error;
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!user) {
      console.warn("No user found - authentication error");
      return;
    }

    const commentToDelete = comments.find(
      (comment) => comment.id === commentId
    );
    if (!commentToDelete) {
      console.warn("Comment not found:", commentId);
      return;
    }

    const isAdmin =
      user?.role === "admin" ||
      user?.role === "ADMIN" ||
      user?.isAdmin === true;

    if (!isAdmin && commentToDelete.authorId !== user.uid) {
      console.warn(
        "User attempted to delete a comment they do not own:",
        commentId
      );
      return;
    }

    const parentCommentId = findParentCommentId(commentToDelete);

    const collectDescendants = (targetId) => {
      const descendants = [];
      const stack = [targetId];

      while (stack.length > 0) {
        const currentId = stack.pop();
        const children = comments.filter(
          (comment) => findParentCommentId(comment) === currentId
        );

        children.forEach((child) => {
          descendants.push(child);
          stack.push(child.id);
        });
      }

      return descendants;
    };

    const repliesToDelete = collectDescendants(commentId);

    const batch = writeBatch(db);

    repliesToDelete.forEach((reply) => {
      const replyRef = resolveCommentDocRef(reply);
      if (replyRef) {
        batch.delete(replyRef);
      }
    });

    const commentRef = resolveCommentDocRef(commentToDelete);
    if (commentRef) {
      batch.delete(commentRef);
    }

    if (parentCommentId) {
      const parentComment = comments.find(
        (comment) => comment.id === parentCommentId
      );
      const parentCommentRef = resolveCommentDocRef(
        parentComment || { id: parentCommentId }
      );
      if (parentCommentRef) {
        batch.update(parentCommentRef, {
          replyCount: increment(-1),
        });
      }
    }

    try {
      await batch.commit();
    } catch (error) {
      console.error("Error deleting comment from Firestore:", error);
      throw error;
    }

    const totalDeleted = 1 + repliesToDelete.length;
    const postRef = doc(db, "posts", postId);

    try {
      await updateDoc(postRef, {
        commentCount: increment(-totalDeleted),
      });
    } catch (error) {
      console.error("Error updating post comment count:", error);
    }

    setPost((prevPost) => {
      if (!prevPost) return prevPost;
      const nextCount = Math.max(
        (prevPost.commentCount || 0) - totalDeleted,
        0
      );
      return {
        ...prevPost,
        commentCount: nextCount,
      };
    });

    setComments((prevComments) => {
      const idsToRemove = new Set([
        commentId,
        ...repliesToDelete.map((reply) => reply.id),
      ]);

      const nextComments = prevComments
        .map((comment) => {
          if (comment.id === parentCommentId) {
            return {
              ...comment,
              replyCount: Math.max((comment.replyCount || 0) - 1, 0),
            };
          }
          return comment;
        })
        .filter((comment) => !idsToRemove.has(comment.id));

      return nextComments;
    });
  };

  const handleToggleCommentLike = useCallback(
    async (comment) => {
      if (!comment?.id) {
        return;
      }

      if (!comment.documentPath) {
        console.warn("Missing documentPath for comment like toggle", comment);
        showErrorToast(
          "Unable to locate that comment. Please refresh and try again."
        );
        return;
      }

      if (likeBusyMap[comment.id]) {
        return;
      }

      setLikeBusyMap((prev) => ({ ...prev, [comment.id]: true }));

      try {
        const payload = await toggleCommentLikeAction(comment.documentPath);
        setComments((prevComments) =>
          prevComments.map((existing) =>
            existing.id === comment.id
              ? {
                  ...existing,
                  likeCount:
                    typeof payload.likeCount === "number"
                      ? payload.likeCount
                      : existing.likeCount ?? 0,
                  score:
                    typeof payload.score === "number"
                      ? payload.score
                      : existing.score ?? 0,
                }
              : existing
          )
        );
      } catch (error) {
        console.error("Failed to toggle comment like", error);
        showErrorToast("Unable to update like. Please try again.");
      } finally {
        setLikeBusyMap((prev) => {
          const next = { ...prev };
          delete next[comment.id];
          return next;
        });
      }
    },
    [likeBusyMap, showErrorToast]
  );

  const handleAuthorPickToggle = useCallback(
    async (commentId, nextValue) => {
      if (!canAuthorPick) {
        return;
      }
      if (authorPickBusyMap[commentId]) {
        return;
      }
      setAuthorPickBusyMap((prev) => ({ ...prev, [commentId]: true }));

      try {
        const response = await authorLikeCallable({
          postId,
          commentId,
          liked: nextValue,
        });
        const payload = response?.data || response;
        setComments((prevComments) =>
          prevComments.map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  likedByAuthor:
                    typeof payload.likedByAuthor === "boolean"
                      ? payload.likedByAuthor
                      : nextValue,
                  score:
                    typeof payload.score === "number"
                      ? payload.score
                      : comment.score ?? 0,
                }
              : comment
          )
        );
      } catch (error) {
        console.error("Failed to toggle author pick", error);
        showErrorToast("Unable to update author pick. Please try again.");
      } finally {
        setAuthorPickBusyMap((prev) => {
          const next = { ...prev };
          delete next[commentId];
          return next;
        });
      }
    },
    [
      canAuthorPick,
      authorPickBusyMap,
      authorLikeCallable,
      postId,
      showErrorToast,
    ]
  );

  const handleVoteChange = async (updatedPost) => {
    try {
      const postRef = doc(db, "posts", postId);
      await updateDoc(postRef, {
        usersThatLiked: updatedPost.usersThatLiked || [],
        usersThatDisliked: updatedPost.usersThatDisliked || [],
        totalVotes:
          (updatedPost.usersThatLiked?.length || 0) -
          (updatedPost.usersThatDisliked?.length || 0),
      });
      setPost(updatedPost);
    } catch (error) {
      console.error("Error updating post votes:", error);
    }
  };

  if (loading) {
    return (
      <main
        className="flex justify-center items-center min-h-screen"
        role="main"
      >
        <div
          className={`text-xl font-semibold ${
            darkMode ? "text-gray-200" : "text-gray-900"
          }`}
          aria-live="polite"
        >
          Loading...
        </div>
      </main>
    );
  }

  if (!post) return null;

  // LIKES-AUTH-GUARD: per-user likes reads are now gated behind auth to satisfy Firestore rules.
  return (
    <>
      {post && (
        <>
          <SEO
            title={post.title}
            description={createTeaser(post.content)}
            image={post.imageUrl}
            url={`/post/${post.id}`}
            type="article"
            keywords={`${post.platforms?.join(", ")}, ${
              post.category
            }, gaming, video games`}
            author={post.authorName}
            publishedTime={post.createdAt?.toDate().toISOString()}
            modifiedTime={
              post.updatedAt?.toDate().toISOString() ||
              post.createdAt?.toDate().toISOString()
            }
            tags={Array.isArray(post.platforms) ? post.platforms : []}
            section={post.category || "Gaming"}
          />
          <StructuredData
            type="Article"
            data={{
              title: post.title,
              description: createTeaser(post.content, 60),
              image: post.imageUrl,
              datePublished: post.createdAt?.toDate().toISOString(),
              dateModified:
                post.updatedAt?.toDate().toISOString() ||
                post.createdAt?.toDate().toISOString(),
              author: post.authorName,
            }}
          />
        </>
      )}
      <main className="max-w-4xl mx-auto px-4 py-8" role="main">
        <nav aria-label="Breadcrumb">
          <Breadcrumbs
            customCrumbs={[
              { path: "/", label: "Home" },
              { path: `/${post.category.toLowerCase()}`, label: post.category },
              { path: `/post/${post.id}`, label: post.title },
            ]}
          />
        </nav>
        {loading ? (
          <div aria-live="polite">Loading...</div>
        ) : post ? (
          <article className="h-entry space-y-6">
            <header
              className={`rounded-lg shadow-lg overflow-hidden ${
                darkMode ? "bg-gray-800" : "bg-white"
              }`}
            >
              {post.imageUrl && (
                <figure>
                  <OptimizedImage
                    src={post.imageUrl}
                    alt={post.title}
                    className="w-full h-auto rounded-lg mb-6 u-photo"
                    sizes="(min-width: 1024px) 896px, 100vw"
                    objectFit="contain"
                  />
                </figure>
              )}
              <div className="p-6">
                <div className="mb-4 flex flex-col gap-4 min-[500px]:flex-row min-[500px]:items-center min-[500px]:justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center not-italic h-card p-author">
                      {post.authorId ? (
                        <Link
                          to={`/user/${post.authorId}`}
                          aria-label={`View ${post.authorName}'s profile`}
                          className="flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-2"
                        >
                          <span
                            className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${
                              darkMode ? "bg-gray-700" : "bg-gray-100"
                            }`}
                          >
                            {post.authorPhotoURL ? (
                              <img
                                src={post.authorPhotoURL}
                                alt={post.authorName}
                                className="w-full h-full object-cover u-photo"
                              />
                            ) : (
                              <span
                                className={`text-lg font-medium ${
                                  darkMode ? "text-gray-300" : "text-gray-600"
                                }`}
                              >
                                {post.authorName[0].toUpperCase()}
                              </span>
                            )}
                          </span>
                          <span className="ml-3 text-left">
                            <span
                              className={`block text-sm font-medium p-name ${
                                darkMode ? "text-gray-200" : "text-gray-900"
                              }`}
                            >
                              {post.authorName}
                            </span>
                            <time
                              dateTime={post.createdAt?.toDate().toISOString()}
                              className={`text-xs dt-published ${
                                darkMode ? "text-gray-400" : "text-gray-500"
                              }`}
                            >
                              {post.createdAt?.toDate().toLocaleDateString()}
                            </time>
                          </span>
                        </Link>
                      ) : (
                        <div className="flex items-center">
                          <span
                            className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${
                              darkMode ? "bg-gray-700" : "bg-gray-100"
                            }`}
                          >
                            {post.authorPhotoURL ? (
                              <img
                                src={post.authorPhotoURL}
                                alt={post.authorName}
                                className="w-full h-full object-cover u-photo"
                              />
                            ) : (
                              <span
                                className={`text-lg font-medium ${
                                  darkMode ? "text-gray-300" : "text-gray-600"
                                }`}
                              >
                                {post.authorName[0].toUpperCase()}
                              </span>
                            )}
                          </span>
                          <div className="ml-3">
                            <p
                              className={`text-sm font-medium p-name ${
                                darkMode ? "text-gray-200" : "text-gray-900"
                              }`}
                            >
                              {post.authorName}
                            </p>
                            <time
                              dateTime={post.createdAt?.toDate().toISOString()}
                              className={`text-xs dt-published ${
                                darkMode ? "text-gray-400" : "text-gray-500"
                              }`}
                            >
                              {post.createdAt?.toDate().toLocaleDateString()}
                            </time>
                          </div>
                        </div>
                      )}
                    </div>
                    {postAuthorMeta &&
                    (postAuthorMeta.dailyStreak > 0 ||
                      postAuthorLastBadgeMeta) ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
                        {postAuthorMeta.dailyStreak > 0 ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 ${
                              darkMode
                                ? "bg-orange-900/40 text-orange-200"
                                : "bg-orange-100 text-orange-800"
                            }`}
                          >
                            🔥 {postAuthorMeta.dailyStreak} day streak
                          </span>
                        ) : null}
                        {postAuthorLastBadgeMeta ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                              darkMode
                                ? "bg-gray-800 text-yellow-200"
                                : "bg-gray-100 text-yellow-700"
                            }`}
                          >
                            <span aria-hidden="true">
                              {postAuthorLastBadgeMeta.icon}
                            </span>
                            <span>{postAuthorLastBadgeMeta.label}</span>
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div
                      className="flex flex-wrap items-center gap-2 min-[840px]:flex-nowrap"
                      role="list"
                      aria-label="Platforms"
                    >
                      <h3
                        className={`hidden text-sm font-semibold min-[915px]:block ${
                          darkMode ? "text-gray-300" : "text-gray-700"
                        }`}
                        aria-hidden="true"
                      >
                        Platforms:
                      </h3>
                      {(Array.isArray(post.platforms)
                        ? post.platforms
                        : [post.platform]
                      ).map((platform) => (
                        <div
                          key={platform}
                          role="listitem"
                          className={`px-3 py-1 rounded-full text-sm p-category ${
                            darkMode
                              ? "bg-gray-700 text-gray-300"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {platform}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="w-full min-[500px]:w-auto min-[500px]:self-end">
                    <ShareButtons
                      url={window.location.href}
                      title={post.title}
                      darkMode={darkMode}
                    />
                  </div>
                </div>
                <h1
                  className={`text-2xl font-bold mb-4 p-name ${
                    darkMode ? "text-gray-100" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </h1>
                <div className="mt-2 mb-4 flex items-center justify-between text-xs sm:text-sm text-slate-400">
                  <button
                    type="button"
                    onClick={scrollToComments}
                    className={`inline-flex items-center gap-2 bg-transparent border-none p-0 transition-colors focus:outline-none ${
                      darkMode
                        ? "text-gray-400 hover:text-gray-100"
                        : "text-gray-600 hover:text-gray-800"
                    }`}
                    aria-label="View comments"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                      />
                    </svg>
                    <span className="font-semibold">
                      {post.commentCount != null ? post.commentCount : 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide opacity-70">
                      comments
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleWritePostClick}
                    disabled={isWritePostBusy}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span aria-hidden="true" className="leading-none">
                      ＋
                    </span>
                    <span>Share your own gaming news</span>
                  </button>
                </div>
                <div className="mb-6 e-content">
                  <RichContent content={post.content} darkMode={darkMode} />
                </div>
                <footer className="mt-6">
                  <h3
                    className={`text-lg font-semibold mb-2 ${
                      darkMode ? "text-gray-200" : "text-gray-800"
                    }`}
                  >
                    Article Information
                  </h3>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <span
                        className={`text-sm ${
                          darkMode ? "text-gray-400" : "text-gray-500"
                        }`}
                      >
                        <time
                          dateTime={
                            post.updatedAt?.toDate().toISOString() ||
                            post.createdAt?.toDate().toISOString()
                          }
                          className="dt-updated"
                        >
                          Updated:{" "}
                          {post.updatedAt?.toDate().toLocaleDateString() ||
                            post.createdAt?.toDate().toLocaleDateString()}
                        </time>
                      </span>
                      <a href={window.location.href} className="u-url hidden">
                        Permalink
                      </a>
                    </div>
                    <VoteButtons
                      post={post}
                      onVoteChange={handleVoteChange}
                      darkMode={darkMode}
                    />
                  </div>
                </footer>
              </div>
            </header>

            {/* Comments Section */}
            <section
              className="mt-12"
              aria-label="Comments"
              ref={commentsSectionRef}
            >
              <h2
                className={`text-2xl font-bold mb-6 ${
                  darkMode ? "text-white" : "text-gray-900"
                }`}
              >
                Comments
              </h2>

              <div
                className={`mb-8 rounded-lg border ${
                  darkMode
                    ? "border-gray-800 bg-gray-900/60"
                    : "border-gray-200 bg-white"
                } p-4 md:p-5 shadow-sm`}
              >
                <h3
                  className={`text-lg font-semibold mb-3 ${
                    darkMode ? "text-gray-200" : "text-gray-800"
                  }`}
                >
                  Join the discussion
                </h3>
                <CommentGate
                  darkMode={darkMode}
                  commentValue={newCommentDraft}
                  onCommentChange={handleCommentChange}
                  onCommentKeyDown={handleCommentKeyDown}
                  onSubmit={handleSubmitComment}
                  isSubmitting={isCommentProcessing}
                  commentError={commentError}
                  signedInLabel={signedInCommentLabel}
                  placeholder="Share your thoughts..."
                  textareaId="post-comment"
                />
              </div>

              {/* ENGAGEMENT: canonical listeners live at posts/${postId}/comments (legacy top-level fallback keeps older threads visible), auth = (anonymous allowed) */}
              <div className="flex flex-col gap-3 min-[840px]:flex-row min-[840px]:items-center min-[840px]:justify-between">
                <div className="inline-flex rounded-full border border-gray-200 bg-gray-100 p-1 dark:border-gray-800 dark:bg-gray-900">
                  {[
                    { id: "top", label: "Top Replies" },
                    { id: "newest", label: "Newest" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setCommentSort(option.id)}
                      className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-colors ${
                        commentSort === option.id
                          ? darkMode
                            ? "bg-blue-600 text-white"
                            : "bg-blue-600 text-white"
                          : darkMode
                          ? "bg-gray-800 text-gray-300"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {authorPickSummary ? (
                  <span
                    className={`text-xs font-medium ${
                      darkMode ? "text-gray-300" : "text-gray-600"
                    }`}
                  >
                    Top reply earned Author’s Pick (
                    {authorPickSummary.authorName})
                  </span>
                ) : null}
              </div>

              {/* Comments List */}
              <div className="space-y-6" role="feed" aria-label="Comments list">
                {commentsLoading ? (
                  <div
                    className={`text-sm ${
                      darkMode ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    Loading comments...
                  </div>
                ) : commentThreads.length === 0 ? (
                  <p
                    className={`${
                      darkMode ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    Be the first to comment.
                  </p>
                ) : (
                  commentThreads.map(({ parent, replies }) => (
                    <CommentThread
                      key={parent.id}
                      parentComment={parent}
                      replies={replies}
                      darkMode={darkMode}
                      onReply={handleReplyRequest}
                      onEdit={handleEditComment}
                      onDelete={handleDeleteComment}
                      currentUser={user}
                      postId={postId}
                      replyResolutionSignal={replyResolutionSignal}
                      processingReplyTargetId={processingReplyTargetId}
                      replyErrors={replyErrors}
                      onClearReplyError={handleClearReplyError}
                      onToggleLike={handleToggleCommentLike}
                      likeBusyMap={likeBusyMap}
                      highlightedReplyIds={highlightedReplyIdsArray}
                      topThreadParentId={topThreadParentId}
                      canAuthorPick={canAuthorPick}
                      authorPickBusyMap={authorPickBusyMap}
                      onAuthorPickToggle={handleAuthorPickToggle}
                      authorMetaMap={authorMeta}
                    />
                  ))
                )}
              </div>
            </section>
          </article>
        ) : null}
      </main>
      <InlineCommentAuthPrompt
        isOpen={isInlineAuthPromptOpen}
        onClose={handleInlinePromptClose}
        onAuthenticated={handleInlineAuthSuccess}
        onRequestEmail={() => {
          setInlineAuthPromptOpen(false);
          setAuthModalOpen(true);
        }}
        commentPreview={pendingSubmission?.content || newCommentDraft}
      />
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
          if (!user && pendingSubmission) {
            setInlineAuthPromptOpen(true);
          }
        }}
        initialMode="login"
      />
    </>
  );
};

export default PostDetail;
