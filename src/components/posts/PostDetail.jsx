import { useState, useEffect, useMemo, useRef } from "react";
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
  getDocs,
  serverTimestamp,
  updateDoc,
  increment,
  writeBatch,
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

const findParentCommentId = (comment) => {
  if (comment.parentCommentId !== undefined && comment.parentCommentId !== null) {
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

  return parentComments.map((comment) => ({
    parent: comment,
    replies: (repliesByParent[comment.id] || []).sort(sortByCreatedAtAsc),
  }));
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
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const hasScrolledToComment = useRef(false);
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

      setCommentsLoading(true);
      try {
        const commentsQuery = query(
          collection(db, "comments"),
          where("postId", "==", postId),
          orderBy("createdAt", "asc")
        );

        const commentsSnapshot = await getDocs(commentsQuery);

        const fetchedComments = commentsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          replyCount: doc.data().replyCount ?? 0,
        }));

        setComments(fetchedComments);
      } catch (error) {
        console.error("Error fetching comments:", error);
      } finally {
        setCommentsLoading(false);
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
    if (isSubmittingComment) return;

    setIsSubmittingComment(true);

    try {
      const trimmedContent = newComment.trim();
      const normalizedPhotoURL = normalizeProfilePhoto(user.photoURL || "");

      const commentRef = await addDoc(collection(db, "comments"), {
        postId,
        content: trimmedContent,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: normalizedPhotoURL,
        parentId: null,
        parentCommentId: null,
        createdAt: serverTimestamp(),
        replyCount: 0,
      });

      const newCommentObj = {
        id: commentRef.id,
        postId,
        content: trimmedContent,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: normalizedPhotoURL,
        parentId: null,
        parentCommentId: null,
        createdAt: new Date(),
        replyCount: 0,
      };

      setComments((prev) => [...prev, newCommentObj]);
      setNewComment("");

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

      if (post.authorId !== user.uid) {
        try {
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
        } catch (notificationError) {
          console.error("Error sending comment notification:", notificationError);
        }
      }
    } catch (error) {
      console.error("Error adding comment:", error);
    } finally {
      setIsSubmittingComment(false);
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

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return;
      }

      // Create the reply data
      const replyData = {
        postId,
        content: trimmedContent,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorPhotoURL: normalizeProfilePhoto(user.photoURL || ""),
        parentId,
        parentCommentId: parentId,
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
      setComments((prevComments) => {
        const updatedComments = prevComments.map((comment) =>
          comment.id === parentId
            ? { ...comment, replyCount: (comment.replyCount || 0) + 1 }
            : comment
        );

        return [...updatedComments, newReply];
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

  const handleEditComment = async (commentId, updatedContent) => {
    if (!user) {
      console.warn("No user found - authentication error");
      return;
    }

    const commentToUpdate = comments.find((comment) => comment.id === commentId);
    if (!commentToUpdate) {
      console.warn("Comment not found:", commentId);
      return;
    }

    if (commentToUpdate.authorId !== user.uid) {
      console.warn("User attempted to edit a comment they do not own:", commentId);
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

    const commentToDelete = comments.find((comment) => comment.id === commentId);
    if (!commentToDelete) {
      console.warn("Comment not found:", commentId);
      return;
    }

    if (commentToDelete.authorId !== user.uid) {
      console.warn("User attempted to delete a comment they do not own:", commentId);
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
      const nextCount = Math.max((prevPost.commentCount || 0) - totalDeleted, 0);
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isSubmittingComment) {
        return;
      }
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
                        disabled={!newComment.trim() || isSubmittingComment}
                        className={`px-4 py-2 rounded-lg ${
                          darkMode
                            ? "bg-blue-600 hover:bg-blue-700"
                            : "bg-blue-500 hover:bg-blue-600"
                        } text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {isSubmittingComment ? "Posting..." : "Post Comment"}
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
                      onReply={handleReply}
                      onEdit={handleEditComment}
                      onDelete={handleDeleteComment}
                      currentUser={user}
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
