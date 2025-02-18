import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
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
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import PropTypes from "prop-types";
import VoteButtons from "./VoteButtons";
import ShareButtons from "../common/ShareButtons";
import {
  createNotification,
  getNotificationMessage,
} from "../../utils/notifications";
import RichContent from "./RichContent";

const ReplyForm = ({ onSubmit, darkMode, isMainThreadComment }) => {
  const [replyContent, setReplyContent] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (replyContent.trim()) {
      await onSubmit(replyContent);
      setReplyContent("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        value={replyContent}
        onChange={(e) => setReplyContent(e.target.value)}
        onKeyDown={handleKeyDown}
        className={`w-full p-2 text-sm rounded-md ${
          darkMode
            ? "bg-gray-700 text-white border-gray-600"
            : "bg-white text-gray-900 border-gray-300"
        } border`}
        rows="2"
        placeholder="Write a reply... (Press Enter to submit, Shift+Enter for new line)"
      />
      <div className="flex justify-end mt-2 space-x-2">
        {!isMainThreadComment && (
          <button
            type="button"
            onClick={() => onSubmit(null)}
            className={`px-3 py-1 text-sm rounded-md ${
              darkMode
                ? "text-gray-300 hover:text-gray-200"
                : "text-gray-600 hover:text-gray-700"
            }`}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className={`px-3 py-1 text-sm text-white rounded-md ${
            darkMode
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-blue-500 hover:bg-blue-600"
          }`}
        >
          Reply
        </button>
      </div>
    </form>
  );
};

ReplyForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  darkMode: PropTypes.bool.isRequired,
  isMainThreadComment: PropTypes.bool.isRequired,
};

const Comment = ({
  comment,
  darkMode,
  onReply,
  user,
  onThreadClick,
  allComments,
  onLoadReplies,
  isLoadingReplies,
  isInThread = false,
  currentThreadId,
}) => {
  const [showReplyForm, setShowReplyForm] = useState(false);

  // Find all replies to this comment from the loaded comments
  const replies = allComments.filter((c) => c.parentId === comment.id);
  const hasReplies = comment.replyCount > 0;
  // A comment is the main thread comment if it's the one being viewed in the thread
  const isMainThreadComment = isInThread && comment.id === currentThreadId;

  const handleCommentClick = async () => {
    // Only load replies if there are any and they haven't been loaded yet
    if (hasReplies && replies.length === 0) {
      await onLoadReplies(comment.id);
    }
    // Always trigger thread view for any clicked comment
    onThreadClick(comment.id);
  };

  const handleReplySubmit = async (content) => {
    if (content === null) {
      setShowReplyForm(false);
      return;
    }
    await onReply(comment.id, content);
    setShowReplyForm(false);
  };

  return (
    <div className="relative">
      <div
        id={`comment-${comment.id}`}
        onClick={handleCommentClick}
        className={`p-4 ${!isInThread ? "cursor-pointer" : ""} ${
          darkMode ? "hover:bg-gray-800" : "hover:bg-gray-50"
        } transition-colors duration-200 border-b ${
          darkMode ? "border-gray-800" : "border-gray-100"
        }`}
      >
        <div className="flex items-start space-x-3">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 ${
              darkMode ? "bg-gray-700" : "bg-gray-100"
            } ring-2 ${darkMode ? "ring-gray-600" : "ring-gray-200"}`}
          >
            {comment.authorPhotoURL ? (
              <img
                src={comment.authorPhotoURL}
                alt={comment.authorName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span
                className={`text-sm font-medium ${
                  darkMode ? "text-gray-100" : "text-gray-600"
                }`}
              >
                {comment.authorName?.[0]?.toUpperCase() || "A"}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span
                className={`font-medium ${
                  darkMode ? "text-white" : "text-gray-900"
                }`}
              >
                {comment.authorName}
              </span>
              <span
                className={`text-xs ${
                  darkMode ? "text-gray-400" : "text-gray-500"
                }`}
              >
                {comment.createdAt instanceof Date
                  ? comment.createdAt.toLocaleDateString()
                  : comment.createdAt?.toDate().toLocaleDateString()}
              </span>
            </div>
            <p
              className={`text-sm mt-1 ${
                darkMode ? "text-white" : "text-gray-600"
              }`}
            >
              {comment.content}
            </p>
            <div className="flex items-center space-x-4 mt-2">
              {user && !isMainThreadComment && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowReplyForm(!showReplyForm);
                  }}
                  className={`text-sm font-medium ${
                    darkMode
                      ? "text-blue-400 hover:text-blue-300"
                      : "text-blue-600 hover:text-blue-700"
                  }`}
                >
                  Reply
                </button>
              )}
              {hasReplies && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCommentClick();
                  }}
                  className={`text-sm font-medium flex items-center space-x-1 ${
                    darkMode
                      ? "text-gray-400 hover:text-gray-300"
                      : "text-gray-600 hover:text-gray-700"
                  }`}
                >
                  <span>
                    {comment.replyCount}{" "}
                    {comment.replyCount === 1 ? "reply" : "replies"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Show reply form directly under main thread comment */}
      {isMainThreadComment && user && (
        <div className="ml-11 mt-2 mb-4">
          <ReplyForm
            onSubmit={handleReplySubmit}
            darkMode={darkMode}
            isMainThreadComment={true}
          />
        </div>
      )}

      {/* Show reply form for other comments when requested */}
      {!isMainThreadComment && showReplyForm && (
        <div className="ml-11 mt-2" onClick={(e) => e.stopPropagation()}>
          <ReplyForm
            onSubmit={handleReplySubmit}
            darkMode={darkMode}
            isMainThreadComment={false}
          />
        </div>
      )}

      {isLoadingReplies && (
        <div
          className={`p-4 text-sm ${
            darkMode ? "text-gray-400" : "text-gray-600"
          }`}
        >
          Loading replies...
        </div>
      )}
    </div>
  );
};

Comment.propTypes = {
  comment: PropTypes.shape({
    id: PropTypes.string.isRequired,
    content: PropTypes.string.isRequired,
    authorName: PropTypes.string.isRequired,
    authorPhotoURL: PropTypes.string,
    parentId: PropTypes.string,
    createdAt: PropTypes.oneOfType([
      PropTypes.instanceOf(Date),
      PropTypes.shape({
        toDate: PropTypes.func.isRequired,
      }),
    ]),
    replyCount: PropTypes.number,
  }).isRequired,
  darkMode: PropTypes.bool.isRequired,
  onReply: PropTypes.func.isRequired,
  user: PropTypes.object,
  onThreadClick: PropTypes.func.isRequired,
  allComments: PropTypes.array.isRequired,
  onLoadReplies: PropTypes.func.isRequired,
  isLoadingReplies: PropTypes.bool.isRequired,
  isInThread: PropTypes.bool,
  currentThreadId: PropTypes.string,
};

const PostDetail = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const hasScrolledToComment = useRef(false);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [threadHistory, setThreadHistory] = useState([]);
  const [loadedCommentIds, setLoadedCommentIds] = useState(new Set());

  const scrollToComment = async (commentId) => {
    if (!commentId) return;

    const maxAttempts = 10;
    let attempts = 0;

    const attemptScroll = async () => {
      let commentElement = document.getElementById(`comment-${commentId}`);

      if (!commentElement) {
        // Find the comment in our loaded comments
        const targetComment = comments.find(
          (comment) => comment.id === commentId
        );

        if (!targetComment) {
          try {
            // Fetch the target comment directly from Firestore
            const commentDoc = await getDoc(doc(db, "comments", commentId));

            if (commentDoc.exists()) {
              const commentData = { id: commentDoc.id, ...commentDoc.data() };

              if (commentData.parentId) {
                // Set the parent as current thread
                setCurrentThreadId(commentData.parentId);
                // Load the parent's replies
                await loadReplies(commentData.parentId);

                // Add this comment to our state if it's not there
                setComments((prevComments) => {
                  if (!prevComments.some((c) => c.id === commentData.id)) {
                    return [...prevComments, commentData];
                  }
                  return prevComments;
                });

                setLoadedCommentIds((prev) => {
                  const newSet = new Set(prev);
                  newSet.add(commentData.id);
                  return newSet;
                });
              }
            }
          } catch (error) {
            console.error("Error fetching comment:", error);
          }
        } else {
          if (targetComment.parentId) {
            setCurrentThreadId(targetComment.parentId);
            if (!loadedCommentIds.has(commentId)) {
              await loadReplies(targetComment.parentId);
            }
          }
        }

        if (attempts < maxAttempts) {
          attempts++;
          setTimeout(attemptScroll, 200);
          return;
        }
      } else {
        commentElement.scrollIntoView({ behavior: "smooth", block: "center" });
        commentElement.classList.add("highlight-comment");
        setTimeout(() => {
          commentElement.classList.remove("highlight-comment");
        }, 3000);
      }
    };

    // Start the first attempt after a short delay to ensure comments are loaded
    setTimeout(attemptScroll, 100);
  };

  useEffect(() => {
    const fetchPost = async () => {
      try {
        const postDoc = await getDoc(doc(db, "posts", postId));
        if (!postDoc.exists()) {
          navigate("/");
          return;
        }
        setPost({ id: postDoc.id, ...postDoc.data() });

        // Only fetch top-level comments initially
        const commentsQuery = query(
          collection(db, "comments"),
          where("postId", "==", postId),
          where("parentId", "==", null),
          orderBy("createdAt", "desc")
        );
        const commentsSnapshot = await getDocs(commentsQuery);

        // Get the reply count for each comment
        const commentsWithCounts = await Promise.all(
          commentsSnapshot.docs.map(async (doc) => {
            const comment = {
              id: doc.id,
              ...doc.data(),
              isLoadingReplies: false, // Initialize isLoadingReplies
            };

            // Get the count of replies
            const replyCountQuery = query(
              collection(db, "comments"),
              where("postId", "==", postId),
              where("parentId", "==", doc.id)
            );
            const replySnapshot = await getDocs(replyCountQuery);
            comment.replyCount = replySnapshot.size;

            return comment;
          })
        );

        setComments(commentsWithCounts);
        setLoadedCommentIds(new Set(commentsWithCounts.map((c) => c.id)));
        setLoading(false);
      } catch (error) {
        console.error("Error fetching post:", error);
        navigate("/");
      }
    };

    fetchPost();
  }, [postId, navigate]);

  // Separate useEffect for handling comment scrolling
  useEffect(() => {
    if (
      !loading &&
      comments.length > 0 &&
      location.state?.targetCommentId &&
      !hasScrolledToComment.current
    ) {
      scrollToComment(location.state.targetCommentId);
      hasScrolledToComment.current = true;
    }
  }, [loading, comments, location.state?.targetCommentId]);

  // Reset the scroll flag when the postId changes
  useEffect(() => {
    hasScrolledToComment.current = false;
  }, [postId]);

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

  const handleSubmitComment = async (e) => {
    e.preventDefault();
    if (!user) return;
    if (!newComment.trim()) return;

    try {
      const commentRef = await addDoc(collection(db, "comments"), {
        postId,
        content: newComment.trim(),
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL || "", // Use empty string as fallback
        parentId: null,
        createdAt: serverTimestamp(),
        replyCount: 0, // Add replyCount field
      });

      const newCommentObj = {
        id: commentRef.id,
        postId,
        content: newComment.trim(),
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL || "",
        parentId: null,
        createdAt: new Date(),
        replyCount: 0,
        isLoadingReplies: false,
      };

      // Create notification for post author if it's not their own comment
      if (post.authorId !== user.uid) {
        const authorDoc = await getDoc(doc(db, "users", post.authorId));
        const authorData = authorDoc.data();

        if (authorData?.notificationPrefs?.postComments !== false) {
          await createNotification({
            recipientId: post.authorId,
            senderId: user.uid,
            senderName: user.displayName || user.email.split("@")[0],
            message: getNotificationMessage({
              type: "post_comment",
              senderName: user.displayName || user.email.split("@")[0],
              postTitle: post.title,
            }),
            type: "post_comment",
            link: `/post/${postId}`,
            postId,
            commentId: commentRef.id,
          });
        }
      }

      setComments([newCommentObj, ...comments]);
      setNewComment("");
    } catch (error) {
      console.error("Error adding comment:", error);
    }
  };

  const handleReply = async (parentId, content) => {
    if (!user) {
      console.log("No user found - authentication error");
      return;
    }

    try {
      // Get the parent comment first
      const parentComment = comments.find((comment) => comment.id === parentId);
      if (!parentComment) {
        console.log("Parent comment not found:", parentId);
        return;
      }

      // Create the reply data object
      const replyData = {
        postId,
        content,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL,
        parentId,
        createdAt: serverTimestamp(),
        replyCount: 0,
      };

      // Create the reply in Firestore
      const replyRef = await addDoc(collection(db, "comments"), replyData);

      // Update the parent comment's replyCount in Firestore
      const parentRef = doc(db, "comments", parentId);
      await updateDoc(parentRef, {
        replyCount: (parentComment.replyCount || 0) + 1,
      });

      const newReply = {
        id: replyRef.id,
        content,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL,
        parentId,
        createdAt: new Date(),
        replyCount: 0,
        isLoadingReplies: false,
      };

      // Create notification for comment author if it's not their own reply
      if (parentComment.authorId !== user.uid) {
        const authorDoc = await getDoc(
          doc(db, "users", parentComment.authorId)
        );
        const authorData = authorDoc.data();

        if (authorData?.notificationPrefs?.commentReplies !== false) {
          await createNotification({
            recipientId: parentComment.authorId,
            senderId: user.uid,
            senderName: user.displayName || user.email.split("@")[0],
            message: getNotificationMessage({
              type: "comment_reply",
              senderName: user.displayName || user.email.split("@")[0],
            }),
            type: "comment_reply",
            link: `/post/${postId}`,
            postId,
            commentId: replyRef.id,
          });
        }
      }

      // Update both the new reply and the parent comment's replyCount in local state
      setComments((prevComments) =>
        prevComments
          .map((comment) =>
            comment.id === parentId
              ? { ...comment, replyCount: (comment.replyCount || 0) + 1 }
              : comment
          )
          .concat([newReply])
      );

      // Add the new reply ID to loadedCommentIds
      setLoadedCommentIds((prev) => {
        const newSet = new Set(prev);
        newSet.add(replyRef.id);
        return newSet;
      });
    } catch (error) {
      console.error("Error adding reply:", error);
      console.log("Error details:", {
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
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

  const handleThreadClick = async (commentId) => {
    // Add current thread to history before changing to new thread
    if (currentThreadId) {
      setThreadHistory((prev) => [...prev, currentThreadId]);
    }
    setCurrentThreadId(commentId);

    // Set loading state for the clicked comment
    setComments((prevComments) =>
      prevComments.map((c) =>
        c.id === commentId ? { ...c, isLoadingReplies: true } : c
      )
    );

    if (!loadedCommentIds.has(commentId)) {
      await loadReplies(commentId);
    }

    // Clear loading state
    setComments((prevComments) =>
      prevComments.map((c) =>
        c.id === commentId ? { ...c, isLoadingReplies: false } : c
      )
    );
  };

  const handleBackClick = () => {
    if (threadHistory.length > 0) {
      // Get the last thread from history
      const previousThread = threadHistory[threadHistory.length - 1];
      // Remove it from history
      setThreadHistory((prev) => prev.slice(0, -1));
      // Set it as current thread
      setCurrentThreadId(previousThread);
    } else {
      // If no history, go back to all comments
      setCurrentThreadId(null);
    }
  };

  const loadReplies = async (commentId) => {
    try {
      // Load direct replies to this comment
      const repliesQuery = query(
        collection(db, "comments"),
        where("postId", "==", postId),
        where("parentId", "==", commentId),
        orderBy("createdAt", "desc")
      );
      const repliesSnapshot = await getDocs(repliesQuery);

      const newReplies = await Promise.all(
        repliesSnapshot.docs.map(async (doc) => {
          const reply = {
            id: doc.id,
            ...doc.data(),
            isLoadingReplies: false,
          };

          // Get the count of nested replies
          const nestedRepliesQuery = query(
            collection(db, "comments"),
            where("postId", "==", postId),
            where("parentId", "==", doc.id)
          );
          const nestedRepliesSnapshot = await getDocs(nestedRepliesQuery);
          reply.replyCount = nestedRepliesSnapshot.size;

          // If there are nested replies, load them recursively
          if (reply.replyCount > 0) {
            await loadReplies(doc.id);
          }

          return reply;
        })
      );

      // Add all replies to the comments array if they're not already there
      setComments((prevComments) => {
        const newComments = [...prevComments];
        newReplies.forEach((reply) => {
          if (!loadedCommentIds.has(reply.id)) {
            newComments.push(reply);
          }
        });
        return newComments;
      });

      // Update the set of loaded comment IDs
      setLoadedCommentIds((prev) => {
        const newSet = new Set(prev);
        newReplies.forEach((reply) => newSet.add(reply.id));
        return newSet;
      });

      return newReplies;
    } catch (error) {
      console.error("Error loading replies:", error);
      return [];
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitComment(e);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div
          className={`text-xl font-semibold ${
            darkMode ? "text-gray-200" : "text-gray-900"
          }`}
        >
          Loading...
        </div>
      </div>
    );
  }

  if (!post) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {loading ? (
        <div>Loading...</div>
      ) : post ? (
        <div className="space-y-6">
          <div
            className={`rounded-lg shadow-lg overflow-hidden ${
              darkMode ? "bg-gray-800" : "bg-white"
            }`}
          >
            {post.imageUrl && (
              <img
                src={post.imageUrl}
                alt={post.title}
                className="w-full h-64 object-cover"
              />
            )}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${
                        darkMode ? "bg-gray-700" : "bg-gray-100"
                      }`}
                    >
                      {post.authorPhotoURL ? (
                        <img
                          src={post.authorPhotoURL}
                          alt={post.authorName}
                          className="w-full h-full object-cover"
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
                    </div>
                    <div className="ml-3">
                      <p
                        className={`text-sm font-medium ${
                          darkMode ? "text-gray-200" : "text-gray-900"
                        }`}
                      >
                        {post.authorName}
                      </p>
                      <p
                        className={`text-xs ${
                          darkMode ? "text-gray-400" : "text-gray-500"
                        }`}
                      >
                        {post.createdAt?.toDate().toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {(Array.isArray(post.platforms)
                      ? post.platforms
                      : [post.platform]
                    ).map((platform) => (
                      <div
                        key={platform}
                        className={`px-3 py-1 rounded-full text-sm ${
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
                className={`text-2xl font-bold mb-4 ${
                  darkMode ? "text-gray-100" : "text-gray-900"
                }`}
              >
                {post.title}
              </h1>
              <div className="mb-6">
                <RichContent content={post.content} darkMode={darkMode} />
              </div>
              <div className="mt-6">
                <VoteButtons
                  post={post}
                  onVoteChange={handleVoteChange}
                  darkMode={darkMode}
                />
              </div>
            </div>
          </div>

          {/* Comments Section */}
          <div className="mt-12">
            <h2
              className={`text-2xl font-bold mb-6 ${
                darkMode ? "text-white" : "text-gray-900"
              }`}
            >
              Comments
            </h2>

            {/* New Comment Form */}
            {user ? (
              <form onSubmit={handleSubmitComment} className="mb-8">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Write a comment... (Press Enter to submit, Shift+Enter for new line)"
                  className={`w-full p-4 rounded-lg ${
                    darkMode
                      ? "bg-gray-800 text-white border-gray-700"
                      : "bg-white text-gray-900 border-gray-200"
                  } border`}
                  rows="3"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="submit"
                    className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                      darkMode
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "bg-blue-500 hover:bg-blue-600"
                    }`}
                  >
                    Post Comment
                  </button>
                </div>
              </form>
            ) : (
              <div
                className={`p-4 rounded-lg mb-8 ${
                  darkMode ? "bg-gray-800" : "bg-gray-100"
                }`}
              >
                <p
                  className={`text-center ${
                    darkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  Please sign in to leave a comment.
                </p>
              </div>
            )}

            {/* Comments List */}
            <div className="space-y-6">
              {currentThreadId ? (
                <>
                  <button
                    onClick={handleBackClick}
                    className={`flex items-center space-x-2 mb-4 text-sm ${
                      darkMode
                        ? "text-blue-400 hover:text-blue-300"
                        : "text-blue-600 hover:text-blue-700"
                    }`}
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 19l-7-7m0 0l7-7m-7 7h18"
                      />
                    </svg>
                    <span>
                      {threadHistory.length > 0
                        ? "Back to previous thread"
                        : "Back to all comments"}
                    </span>
                  </button>
                  {/* First show the main comment */}
                  {comments
                    .filter((comment) => comment.id === currentThreadId)
                    .map((comment) => (
                      <Comment
                        key={comment.id}
                        comment={comment}
                        darkMode={darkMode}
                        onReply={handleReply}
                        user={user}
                        onThreadClick={handleThreadClick}
                        allComments={comments}
                        onLoadReplies={loadReplies}
                        isLoadingReplies={comment.isLoadingReplies}
                        isInThread={true}
                        currentThreadId={currentThreadId}
                      />
                    ))}
                  {/* Then show all replies */}
                  {comments
                    .filter((comment) => comment.parentId === currentThreadId)
                    .map((comment) => (
                      <Comment
                        key={comment.id}
                        comment={comment}
                        darkMode={darkMode}
                        onReply={handleReply}
                        user={user}
                        onThreadClick={handleThreadClick}
                        allComments={comments}
                        onLoadReplies={loadReplies}
                        isLoadingReplies={comment.isLoadingReplies}
                        isInThread={true}
                        currentThreadId={currentThreadId}
                      />
                    ))}
                </>
              ) : (
                // Show top-level comments
                comments
                  .filter((comment) => comment.parentId === null)
                  .map((comment) => (
                    <Comment
                      key={comment.id}
                      comment={comment}
                      darkMode={darkMode}
                      onReply={handleReply}
                      user={user}
                      onThreadClick={handleThreadClick}
                      allComments={comments}
                      onLoadReplies={loadReplies}
                      isLoadingReplies={comment.isLoadingReplies}
                      isInThread={false}
                      currentThreadId={currentThreadId}
                    />
                  ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PostDetail;
