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
  increment,
} from "firebase/firestore";
import PropTypes from "prop-types";
import VoteButtons from "./VoteButtons";
import ShareButtons from "../common/ShareButtons";
import {
  createNotification,
  getNotificationMessage,
} from "../../utils/notifications";
import RichContent from "./RichContent";
import SEO, { createTeaser } from "../common/SEO";
import StructuredData from "../common/StructuredData";
import Breadcrumbs from "../common/Breadcrumbs";
import OptimizedImage from "../common/OptimizedImage";

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
        if (postDoc.exists()) {
          const postData = { id: postDoc.id, ...postDoc.data() };
          setPost(postData);

          // Set page title and meta description
          document.title = `${postData.title} | Video Game Otaku`;
        } else {
          navigate("/");
        }
      } catch (error) {
        console.error("Error fetching post:", error);
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    fetchPost();
  }, [postId, navigate]);

  // Add a new useEffect to fetch comments when the post is loaded
  useEffect(() => {
    const fetchComments = async () => {
      if (!postId) return;

      try {
        // Query for top-level comments (parentId is null)
        const commentsQuery = query(
          collection(db, "comments"),
          where("postId", "==", postId),
          where("parentId", "==", null),
          orderBy("createdAt", "desc")
        );

        const commentsSnapshot = await getDocs(commentsQuery);

        if (!commentsSnapshot.empty) {
          const fetchedComments = commentsSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            isLoadingReplies: false,
          }));

          setComments(fetchedComments);

          // Update the set of loaded comment IDs
          setLoadedCommentIds(
            new Set(fetchedComments.map((comment) => comment.id))
          );
        }
      } catch (error) {
        console.error("Error fetching comments:", error);
      }
    };

    if (!loading && post) {
      fetchComments();
    }
  }, [postId, loading, post]);

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

      // Update the post's comment count in Firestore
      const postRef = doc(db, "posts", postId);
      await updateDoc(postRef, {
        commentCount: increment(1),
      });

      // Update the local post state with the new comment count
      setPost((prevPost) => ({
        ...prevPost,
        commentCount: (prevPost.commentCount || 0) + 1,
      }));

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

      // Create the reply data
      const replyData = {
        postId,
        content: content.trim(),
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL || "",
        parentId,
        createdAt: serverTimestamp(),
        replyCount: 0,
      };

      // Add the reply to Firestore
      const replyRef = await addDoc(collection(db, "comments"), replyData);

      // Update the parent comment's replyCount in Firestore
      const parentCommentRef = doc(db, "comments", parentId);
      await updateDoc(parentCommentRef, {
        replyCount: increment(1),
      });

      // Update the post's comment count in Firestore
      const postRef = doc(db, "posts", postId);
      await updateDoc(postRef, {
        commentCount: increment(1),
      });

      // Update the local post state with the new comment count
      setPost((prevPost) => ({
        ...prevPost,
        commentCount: (prevPost.commentCount || 0) + 1,
      }));

      // Create the reply object for local state
      const newReply = {
        id: replyRef.id,
        ...replyData,
        createdAt: new Date(),
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
                    className="w-full h-64 rounded-lg mb-6 u-photo"
                    sizes="(min-width: 1024px) 896px, 100vw"
                  />
                </figure>
              )}
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <address className="flex items-center not-italic h-card p-author">
                      <div
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
                      </div>
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
                    </address>
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

              {user ? (
                <div>
                  <h3
                    className={`text-lg font-semibold mb-3 ${
                      darkMode ? "text-gray-200" : "text-gray-800"
                    }`}
                  >
                    Add Your Comment
                  </h3>
                  <form onSubmit={handleSubmitComment} className="mb-8">
                    <label htmlFor="comment" className="sr-only">
                      Add a comment
                    </label>
                    <textarea
                      id="comment"
                      rows="3"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Add a comment..."
                      className={`w-full px-4 py-2 rounded-lg ${
                        darkMode
                          ? "bg-gray-700 text-white placeholder-gray-400"
                          : "bg-white text-gray-900 placeholder-gray-500"
                      } border ${
                        darkMode ? "border-gray-600" : "border-gray-300"
                      } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      aria-label="Add a comment"
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        type="submit"
                        disabled={!newComment.trim()}
                        className={`px-4 py-2 rounded-lg ${
                          darkMode
                            ? "bg-blue-600 hover:bg-blue-700"
                            : "bg-blue-500 hover:bg-blue-600"
                        } text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        Post Comment
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <p
                  className={`mb-8 ${
                    darkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  Please sign in to comment.
                </p>
              )}

              {/* Comments List */}
              <div className="space-y-6" role="feed" aria-label="Comments list">
                {currentThreadId ? (
                  <>
                    <button
                      onClick={handleBackClick}
                      className={`flex items-center space-x-2 mb-4 text-sm ${
                        darkMode
                          ? "text-blue-400 hover:text-blue-300"
                          : "text-blue-600 hover:text-blue-700"
                      }`}
                      aria-label={
                        threadHistory.length > 0
                          ? "Back to previous thread"
                          : "Back to all comments"
                      }
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
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
            </section>
          </article>
        ) : null}
      </main>
    </>
  );
};

export default PostDetail;
