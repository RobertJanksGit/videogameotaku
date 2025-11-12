import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../config/firebase";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  updateDoc,
  setDoc,
  increment,
  writeBatch,
  onSnapshot,
} from "firebase/firestore";
import VoteButtons from "./VoteButtons";
import ShareButtons from "../common/ShareButtons";
import CommentThread from "./CommentThread";
import {
  createNotification,
  getNotificationMessage,
} from "../../utils/notifications";
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

const buildCommentThreads = (comments) => {
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
    .sort(sortByCreatedAtAsc);

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

// COMMENT FLOW:
// - Determines comment access by checking `user` from AuthContext (unauthenticated users see sign-in prompt).
// - `handleSubmitComment`, `handleReply`, `handleEditComment`, `handleDeleteComment` all guard on `user`/ownership to enforce auth.
// - New comments and replies are written via Firestore `addDoc` to the `comments` collection; counts and notifications update related docs.
// TODO: COMMENT FLOW ENHANCEMENTS COMPLETE – see summary above.
const PostDetail = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const hasScrolledToComment = useRef(false);
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
    () => buildCommentThreads(comments),
    [comments]
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
    if (!postId) return;

    setCommentsLoading(true);
    const commentsQueryRef = query(
      collection(db, "comments"),
      where("postId", "==", postId),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(
      commentsQueryRef,
      (snapshot) => {
        const fetchedComments = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
          replyCount: docSnapshot.data().replyCount ?? 0,
        }));

        setComments(fetchedComments);
        setCommentsLoading(false);
      },
      (error) => {
        console.error("Error listening to comments:", error);
        setCommentsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [postId]);

  // Separate useEffect for handling comment scrolling
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

  // Reset the scroll flag when the postId or target changes
  useEffect(() => {
    hasScrolledToComment.current = false;
  }, [postId, targetCommentIdFromState, targetCommentIdFromHash]);

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

  const interpretCommentError = useCallback((error) => {
    if (!error) {
      return "Unable to post comment. Please try again.";
    }

    if (error.code === "resource-exhausted") {
      return "You’re commenting a bit fast. Please wait a moment and try again.";
    }

    if (error.code === "permission-denied") {
      return "You’re commenting a bit fast. Please wait a moment and try again.";
    }

    if (typeof error.message === "string") {
      const message = error.message.toLowerCase();
      if (message.includes("rate") || message.includes("fast")) {
        return "You’re commenting a bit fast. Please wait a moment and try again.";
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

        console.log("[Comments] submit comment auth", {
          uid: user.uid,
          isAnonymous: user.isAnonymous,
        });

        const commentPayload = {
          postId,
          content: trimmedContent,
          authorId: user.uid,
          authorName,
          authorPhotoURL,
          parentId: null,
          parentCommentId: null,
          createdAt: serverTimestamp(),
          replyCount: 0,
        };

        console.log("[Comments] payload", commentPayload);

        const commentRef = await addDoc(
          collection(db, "comments"),
          commentPayload
        );

        console.log("[Comments] wrote comment doc", {
          path: commentRef.path,
        });

        const newCommentObj = {
          id: commentRef.id,
          postId,
          content: trimmedContent,
          authorId: user.uid,
          authorName,
          authorPhotoURL,
          parentId: null,
          parentCommentId: null,
          createdAt: new Date(),
          replyCount: 0,
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
          console.log("[Comments] updating commentMeta", {
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
            "Error updating comment rate limit metadata:",
            metaError
          );
        }

        markStarterPackCommented(user.uid);

        if (post?.authorId && post.authorId !== user.uid) {
          try {
            const authorDoc = await getDoc(doc(db, "users", post.authorId));
            const authorData = authorDoc.data();

            if (authorData?.notificationPrefs?.postComments !== false) {
              await createNotification({
                recipientId: post.authorId,
                senderId: user.uid,
                senderName: authorName,
                message: getNotificationMessage({
                  type: "post_comment",
                  senderName: authorName,
                  postTitle: post.title,
                }),
                type: "post_comment",
                link: `/post/${postId}`,
                postId,
                commentId: commentRef.id,
              });
            }
          } catch (notificationError) {
            console.error(
              "Error sending comment notification:",
              notificationError
            );
          }
        }

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
      post,
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
        const replyPayload = {
          postId,
          content: trimmedContent,
          authorId: user.uid,
          authorName,
          authorPhotoURL,
          parentId,
          parentCommentId: parentId,
          createdAt: serverTimestamp(),
          replyCount: 0,
        };

        console.log("[Comments] reply payload", replyPayload);

        const replyRef = await addDoc(collection(db, "comments"), replyPayload);

        console.log("[Comments] wrote reply doc", {
          path: replyRef.path,
        });

        const newReply = {
          id: replyRef.id,
          ...replyPayload,
          createdAt: new Date(),
        };

        const parentCommentRef = doc(db, "comments", parentId);
        await updateDoc(parentCommentRef, {
          replyCount: increment(1),
        });

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

        if (parentComment.authorId && parentComment.authorId !== user.uid) {
          try {
            const authorDoc = await getDoc(
              doc(db, "users", parentComment.authorId)
            );
            const authorData = authorDoc.data();

            if (authorData?.notificationPrefs?.commentReplies !== false) {
              await createNotification({
                recipientId: parentComment.authorId,
                senderId: user.uid,
                senderName: authorName,
                message: getNotificationMessage({
                  type: "comment_reply",
                  senderName: authorName,
                }),
                type: "comment_reply",
                link: `/post/${postId}`,
                postId,
                commentId: replyRef.id,
              });
            }
          } catch (notificationError) {
            console.error(
              "Error sending reply notification:",
              notificationError
            );
          }
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
      const commentRef = doc(db, "comments", commentId);
      await updateDoc(commentRef, {
        content: trimmedContent,
        updatedAt: serverTimestamp(),
      });

      setComments((prevComments) =>
        prevComments.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                content: trimmedContent,
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
      const replyRef = doc(db, "comments", reply.id);
      batch.delete(replyRef);
    });

    const commentRef = doc(db, "comments", commentId);
    batch.delete(commentRef);

    if (parentCommentId) {
      const parentCommentRef = doc(db, "comments", parentCommentId);
      batch.update(parentCommentRef, {
        replyCount: increment(-1),
      });
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
                <div className="flex items-center justify-between mb-4">
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
                    <div
                      className="flex items-center space-x-2"
                      role="list"
                      aria-label="Platforms"
                    >
                      <h3
                        className={`text-sm font-semibold ${
                          darkMode ? "text-gray-300" : "text-gray-700"
                        }`}
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
                  <ShareButtons
                    url={window.location.href}
                    title={post.title}
                    darkMode={darkMode}
                  />
                </div>
                <h1
                  className={`text-2xl font-bold mb-4 p-name ${
                    darkMode ? "text-gray-100" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </h1>
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
            <section className="mt-12" aria-label="Comments">
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
                <form onSubmit={handleSubmitComment}>
                  <label htmlFor="post-comment" className="sr-only">
                    Write a comment
                  </label>
                  <textarea
                    id="post-comment"
                    rows="3"
                    value={newCommentDraft}
                    onChange={handleCommentChange}
                    onKeyDown={handleCommentKeyDown}
                    placeholder="Share your thoughts..."
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
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span
                      className={`text-xs ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      {user
                        ? `Posting as ${resolveAuthorName(user)}`
                        : "We’ll ask you to sign in or continue as guest when you post."}
                    </span>
                    <button
                      type="submit"
                      disabled={!newCommentDraft.trim() || isCommentProcessing}
                      className={`inline-flex justify-center px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                        darkMode
                          ? "bg-blue-600 hover:bg-blue-500"
                          : "bg-blue-500 hover:bg-blue-600"
                      }`}
                    >
                      {isCommentProcessing ? "Posting..." : "Post Comment"}
                    </button>
                  </div>
                </form>
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
