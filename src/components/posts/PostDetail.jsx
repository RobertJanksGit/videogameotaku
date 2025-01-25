import { useState, useEffect } from "react";
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

const Comment = ({ comment, darkMode, onReply, user, level = 0 }) => {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [showReplies, setShowReplies] = useState(false);

  const handleSubmitReply = async (e) => {
    e.preventDefault();
    if (replyContent.trim()) {
      await onReply(comment.id, replyContent);
      setReplyContent("");
      setShowReplyForm(false);
      setShowReplies(true); // Show replies after adding a new one
    }
  };

  const hasReplies = comment.replies && comment.replies.length > 0;

  return (
    <div
      className={`${level > 0 ? "ml-8" : ""} mb-4`}
      style={{ marginLeft: `${level * 2}rem` }}
    >
      <div
        id={`comment-${comment.id}`}
        className={`p-4 rounded-lg ${
          darkMode ? "bg-gray-800" : "bg-white"
        } border ${
          darkMode ? "border-gray-700" : "border-gray-200"
        } transition-all duration-300 highlight-comment:bg-blue-100 dark:highlight-comment:bg-blue-900`}
      >
        <div className="flex items-center mb-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
              darkMode ? "bg-gray-700" : "bg-gray-100"
            }`}
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
                  darkMode ? "text-gray-300" : "text-gray-600"
                }`}
              >
                {comment.authorName?.[0]?.toUpperCase() || "A"}
              </span>
            )}
          </div>
          <div className="ml-2">
            <span
              className={`font-medium ${
                darkMode ? "text-gray-200" : "text-gray-900"
              }`}
            >
              {comment.authorName}
            </span>
            <span
              className={`text-xs ml-2 ${
                darkMode ? "text-gray-400" : "text-gray-500"
              }`}
            >
              {comment.createdAt instanceof Date
                ? comment.createdAt.toLocaleDateString()
                : comment.createdAt?.toDate().toLocaleDateString()}
            </span>
          </div>
        </div>
        <p
          className={`text-sm mb-3 ${
            darkMode ? "text-gray-300" : "text-gray-600"
          }`}
        >
          {comment.content}
        </p>
        <div className="flex items-center space-x-4">
          {user && level === 0 && (
            <button
              onClick={() => setShowReplyForm(!showReplyForm)}
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
              onClick={() => setShowReplies(!showReplies)}
              className={`text-sm font-medium flex items-center space-x-1 ${
                darkMode
                  ? "text-gray-400 hover:text-gray-300"
                  : "text-gray-600 hover:text-gray-700"
              }`}
            >
              <svg
                className={`w-4 h-4 transform transition-transform ${
                  showReplies ? "rotate-90" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span>
                {comment.replies.length}{" "}
                {comment.replies.length === 1 ? "reply" : "replies"}
              </span>
            </button>
          )}
        </div>
        {showReplyForm && (
          <form onSubmit={handleSubmitReply} className="mt-2">
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              className={`w-full p-2 text-sm rounded-md ${
                darkMode
                  ? "bg-gray-700 text-gray-200 border-gray-600"
                  : "bg-white text-gray-900 border-gray-300"
              } border`}
              rows="2"
              placeholder="Write a reply..."
            />
            <div className="flex justify-end mt-2 space-x-2">
              <button
                type="button"
                onClick={() => setShowReplyForm(false)}
                className={`px-3 py-1 text-sm rounded-md ${
                  darkMode
                    ? "text-gray-300 hover:text-gray-200"
                    : "text-gray-600 hover:text-gray-700"
                }`}
              >
                Cancel
              </button>
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
        )}
      </div>
      {hasReplies && showReplies && (
        <div className="mt-2">
          {comment.replies.map((reply) => (
            <Comment
              key={reply.id}
              comment={reply}
              darkMode={darkMode}
              onReply={onReply}
              user={user}
              level={level + 1}
            />
          ))}
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
    createdAt: PropTypes.oneOfType([
      PropTypes.instanceOf(Date),
      PropTypes.shape({
        toDate: PropTypes.func.isRequired,
      }),
    ]),
    replies: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
  darkMode: PropTypes.bool.isRequired,
  onReply: PropTypes.func.isRequired,
  user: PropTypes.object,
  level: PropTypes.number,
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

  // Function to scroll to and highlight a comment
  const scrollToComment = (commentId) => {
    if (!commentId) return;

    // First try to find the comment in top-level comments
    let commentElement = document.getElementById(`comment-${commentId}`);

    if (!commentElement) {
      // If not found, it might be a reply. Find the parent comment and expand it
      const parentComment = comments.find((comment) =>
        comment.replies?.some((reply) => reply.id === commentId)
      );

      if (parentComment) {
        // Find the comment in the DOM and update its state to show replies
        const commentIndex = comments.findIndex(
          (c) => c.id === parentComment.id
        );
        const newComments = [...comments];
        newComments[commentIndex] = { ...parentComment, showReplies: true };
        setComments(newComments);

        // Wait for the DOM to update before scrolling
        setTimeout(() => {
          const replyElement = document.getElementById(`comment-${commentId}`);
          if (replyElement) {
            replyElement.scrollIntoView({ behavior: "smooth" });
            replyElement.classList.add("highlight-comment");
            setTimeout(() => {
              replyElement.classList.remove("highlight-comment");
            }, 3000);
          }
        }, 100);
      }
    } else {
      // If it's a top-level comment, scroll to it directly
      commentElement.scrollIntoView({ behavior: "smooth" });
      commentElement.classList.add("highlight-comment");
      setTimeout(() => {
        commentElement.classList.remove("highlight-comment");
      }, 3000);
    }
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

        // Fetch comments
        const commentsQuery = query(
          collection(db, "comments"),
          where("postId", "==", postId),
          where("parentId", "==", null),
          orderBy("createdAt", "desc")
        );
        const commentsSnapshot = await getDocs(commentsQuery);

        // Fetch replies for each comment
        const commentsWithReplies = await Promise.all(
          commentsSnapshot.docs.map(async (commentDoc) => {
            const comment = { id: commentDoc.id, ...commentDoc.data() };
            const repliesQuery = query(
              collection(db, "comments"),
              where("postId", "==", postId),
              where("parentId", "==", commentDoc.id),
              orderBy("createdAt", "asc")
            );
            const repliesSnapshot = await getDocs(repliesQuery);
            comment.replies = repliesSnapshot.docs.map((replyDoc) => ({
              id: replyDoc.id,
              ...replyDoc.data(),
            }));
            return comment;
          })
        );

        setComments(commentsWithReplies);
        setLoading(false);

        // After comments are loaded, scroll to target comment if specified
        if (location.state?.targetCommentId) {
          // Small delay to ensure DOM is updated
          setTimeout(() => {
            scrollToComment(location.state.targetCommentId);
          }, 100);
        }
      } catch (error) {
        console.error("Error fetching post:", error);
        navigate("/");
      }
    };

    fetchPost();
  }, [postId, navigate, location.state?.targetCommentId]);

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
        content: newComment,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL,
        parentId: null,
        createdAt: serverTimestamp(),
      });

      const newCommentObj = {
        id: commentRef.id,
        content: newComment,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL,
        parentId: null,
        createdAt: new Date(),
        replies: [],
      };

      // Create notification for post author if it's not their own comment
      if (post.authorId !== user.uid) {
        // Get user's notification preferences
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
    if (!user) return;

    try {
      // Find the parent comment to get the author's ID
      const parentComment = comments.find((comment) => comment.id === parentId);
      if (!parentComment) return;

      const replyRef = await addDoc(collection(db, "comments"), {
        postId,
        content,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL,
        parentId,
        createdAt: serverTimestamp(),
      });

      const newReply = {
        id: replyRef.id,
        content,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: user.photoURL,
        parentId,
        createdAt: new Date(),
      };

      // Create notification for comment author if it's not their own reply
      if (parentComment.authorId !== user.uid) {
        // Get user's notification preferences
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

      setComments(
        comments.map((comment) =>
          comment.id === parentId
            ? {
                ...comment,
                replies: [...(comment.replies || []), newReply],
              }
            : comment
        )
      );
    } catch (error) {
      console.error("Error adding reply:", error);
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
                  <div
                    className={`px-3 py-1 rounded-full text-sm ${
                      darkMode
                        ? "bg-gray-700 text-gray-300"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {post.platform}
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
              <div
                className={`prose max-w-none ${darkMode ? "prose-invert" : ""}`}
              >
                {post.content}
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
                  placeholder="Write a comment..."
                  className={`w-full p-4 rounded-lg ${
                    darkMode
                      ? "bg-gray-800 text-gray-200 border-gray-700"
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
              {comments.map((comment) => (
                <Comment
                  key={comment.id}
                  comment={comment}
                  darkMode={darkMode}
                  onReply={handleReply}
                  user={user}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PostDetail;
