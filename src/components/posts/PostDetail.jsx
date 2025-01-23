import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
} from "firebase/firestore";
import PropTypes from "prop-types";

const Comment = ({ comment, darkMode, onReply, user, level = 0 }) => {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const maxLevel = 2; // Maximum nesting level

  const handleSubmitReply = async (e) => {
    e.preventDefault();
    if (replyContent.trim()) {
      await onReply(comment.id, replyContent);
      setReplyContent("");
      setShowReplyForm(false);
    }
  };

  return (
    <div
      className={`${level > 0 ? "ml-8" : ""} mb-4`}
      style={{ marginLeft: `${level * 2}rem` }}
    >
      <div
        className={`p-4 rounded-lg ${
          darkMode ? "bg-gray-800" : "bg-white"
        } border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
      >
        <div className="flex items-center mb-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              darkMode ? "bg-gray-700" : "bg-gray-100"
            }`}
          >
            <span
              className={`text-sm font-medium ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              {comment.authorName?.[0]?.toUpperCase() || "A"}
            </span>
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
              {comment.createdAt?.toDate().toLocaleDateString()}
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
        {user && level < maxLevel && (
          <div>
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
        )}
      </div>
      {comment.replies?.map((reply) => (
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
  );
};

Comment.propTypes = {
  comment: PropTypes.shape({
    id: PropTypes.string.isRequired,
    content: PropTypes.string.isRequired,
    authorName: PropTypes.string.isRequired,
    createdAt: PropTypes.shape({
      toDate: PropTypes.func.isRequired,
    }),
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
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);

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
          where("parentId", "==", null), // Only fetch top-level comments
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
      } catch (error) {
        console.error("Error fetching post:", error);
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    fetchPost();
  }, [postId, navigate]);

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
        parentId: null,
        createdAt: serverTimestamp(),
      });

      const newCommentObj = {
        id: commentRef.id,
        content: newComment,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        parentId: null,
        createdAt: new Date(),
        replies: [],
      };

      setComments([newCommentObj, ...comments]);
      setNewComment("");
    } catch (error) {
      console.error("Error adding comment:", error);
    }
  };

  const handleReply = async (parentId, content) => {
    if (!user) return;

    try {
      const replyRef = await addDoc(collection(db, "comments"), {
        postId,
        content,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        parentId,
        createdAt: serverTimestamp(),
      });

      const newReply = {
        id: replyRef.id,
        content,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        parentId,
        createdAt: new Date(),
      };

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
    <div className="max-w-4xl mx-auto">
      {/* Post Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <span
            className={`px-3 py-1 text-sm font-semibold rounded-full ${
              darkMode
                ? "bg-gray-700 text-gray-300"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {post.category}
          </span>
          <span
            className={`text-sm ${
              darkMode ? "text-gray-400" : "text-gray-500"
            }`}
          >
            {post.createdAt?.toDate().toLocaleDateString()}
          </span>
        </div>
        <h1
          className={`text-4xl font-bold mb-4 ${
            darkMode ? "text-white" : "text-gray-900"
          }`}
        >
          {post.title}
        </h1>
        <div className="flex items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              darkMode ? "bg-gray-700" : "bg-gray-100"
            }`}
          >
            <span
              className={`text-lg font-medium ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              {post.authorName?.[0]?.toUpperCase() || "A"}
            </span>
          </div>
          <div className="ml-3">
            <span
              className={`font-medium ${
                darkMode ? "text-gray-200" : "text-gray-900"
              }`}
            >
              {post.authorName}
            </span>
          </div>
        </div>
      </div>

      {/* Post Image */}
      {post.imageUrl && (
        <div className="mb-8">
          <img
            src={post.imageUrl}
            alt={post.title}
            className="w-full h-auto rounded-lg"
          />
        </div>
      )}

      {/* Post Content */}
      <div
        className={`prose max-w-none mb-12 ${
          darkMode ? "text-gray-300" : "text-gray-800"
        }`}
      >
        <p className="whitespace-pre-wrap">{post.content}</p>
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
  );
};

export default PostDetail;
