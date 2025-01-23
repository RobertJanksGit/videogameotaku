import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../config/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import PropTypes from "prop-types";

const PostManager = ({ darkMode }) => {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [currentPost, setCurrentPost] = useState({
    title: "",
    content: "",
    category: "news", // Default category
  });

  // Fetch posts
  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const postsCollection = collection(db, "posts");
        const postsSnapshot = await getDocs(postsCollection);
        const postsList = postsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setPosts(postsList);
      } catch (error) {
        console.error("Error fetching posts:", error);
      }
    };

    fetchPosts();
  }, []);

  // Create new post
  const handleCreatePost = async (e) => {
    e.preventDefault();
    try {
      const postsCollection = collection(db, "posts");
      await addDoc(postsCollection, {
        ...currentPost,
        authorId: user.uid,
        authorName: user.name || user.displayName,
        authorEmail: user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Reset form and refresh posts
      setCurrentPost({ title: "", content: "", category: "news" });
      const postsSnapshot = await getDocs(postsCollection);
      const postsList = postsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setPosts(postsList);
    } catch (error) {
      console.error("Error creating post:", error);
    }
  };

  // Update post
  const handleUpdatePost = async (e) => {
    e.preventDefault();
    try {
      const postRef = doc(db, "posts", currentPost.id);
      await updateDoc(postRef, {
        title: currentPost.title,
        content: currentPost.content,
        category: currentPost.category,
        updatedAt: serverTimestamp(),
        lastEditedBy: user.name || user.displayName,
        lastEditedById: user.uid,
      });

      // Reset form and refresh posts
      setCurrentPost({ title: "", content: "", category: "news" });
      setIsEditing(false);
      const postsSnapshot = await getDocs(collection(db, "posts"));
      const postsList = postsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setPosts(postsList);
    } catch (error) {
      console.error("Error updating post:", error);
    }
  };

  // Delete post
  const handleDeletePost = async (postId) => {
    if (window.confirm("Are you sure you want to delete this post?")) {
      try {
        await deleteDoc(doc(db, "posts", postId));
        setPosts(posts.filter((post) => post.id !== postId));
      } catch (error) {
        console.error("Error deleting post:", error);
      }
    }
  };

  // Edit post
  const handleEditPost = (post) => {
    setCurrentPost(post);
    setIsEditing(true);
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={isEditing ? handleUpdatePost : handleCreatePost}
        className="space-y-4"
      >
        <div>
          <label
            htmlFor="title"
            className={`block text-sm font-medium ${
              darkMode ? "text-gray-200" : "text-gray-700"
            }`}
          >
            Title
          </label>
          <input
            type="text"
            id="title"
            value={currentPost.title}
            onChange={(e) =>
              setCurrentPost({ ...currentPost, title: e.target.value })
            }
            className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              darkMode
                ? "bg-[#1C2128] border-gray-700 text-white"
                : "border-gray-300"
            }`}
            required
          />
        </div>

        <div>
          <label
            htmlFor="category"
            className={`block text-sm font-medium ${
              darkMode ? "text-gray-200" : "text-gray-700"
            }`}
          >
            Category
          </label>
          <select
            id="category"
            value={currentPost.category}
            onChange={(e) =>
              setCurrentPost({ ...currentPost, category: e.target.value })
            }
            className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              darkMode
                ? "bg-[#1C2128] border-gray-700 text-white"
                : "border-gray-300"
            }`}
          >
            <option value="news">News</option>
            <option value="review">Review</option>
            <option value="guide">Guide</option>
            <option value="opinion">Opinion</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="content"
            className={`block text-sm font-medium ${
              darkMode ? "text-gray-200" : "text-gray-700"
            }`}
          >
            Content
          </label>
          <textarea
            id="content"
            rows={6}
            value={currentPost.content}
            onChange={(e) =>
              setCurrentPost({ ...currentPost, content: e.target.value })
            }
            className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              darkMode
                ? "bg-[#1C2128] border-gray-700 text-white"
                : "border-gray-300"
            }`}
            required
          />
        </div>

        <div className="flex justify-end">
          {isEditing && (
            <button
              type="button"
              onClick={() => {
                setCurrentPost({ title: "", content: "", category: "news" });
                setIsEditing(false);
              }}
              className="mr-4 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              darkMode
                ? "bg-[#316DCA] hover:bg-[#2760AA] focus:ring-[#316DCA]"
                : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
            }`}
          >
            {isEditing ? "Update Post" : "Create Post"}
          </button>
        </div>
      </form>

      <div
        className={`rounded-md border ${
          darkMode ? "border-gray-700" : "border-gray-200"
        }`}
      >
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className={darkMode ? "bg-[#1C2128]" : "bg-gray-50"}>
            <tr>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Title
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Category
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Author
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Created At
              </th>
              <th
                className={`px-6 py-3 text-left text-xs font-medium ${
                  darkMode ? "text-gray-200" : "text-gray-500"
                } uppercase tracking-wider`}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody
            className={`divide-y ${
              darkMode ? "divide-gray-700" : "divide-gray-200"
            }`}
          >
            {posts.map((post) => (
              <tr key={post.id}>
                <td
                  className={`px-6 py-4 whitespace-nowrap text-sm ${
                    darkMode ? "text-gray-200" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </td>
                <td
                  className={`px-6 py-4 whitespace-nowrap text-sm ${
                    darkMode ? "text-gray-200" : "text-gray-900"
                  }`}
                >
                  {post.category}
                </td>
                <td
                  className={`px-6 py-4 whitespace-nowrap text-sm ${
                    darkMode ? "text-gray-200" : "text-gray-900"
                  }`}
                >
                  {post.authorName || post.authorEmail}
                  {post.lastEditedBy && (
                    <span className="text-xs text-gray-500 block">
                      Last edited by: {post.lastEditedBy}
                    </span>
                  )}
                </td>
                <td
                  className={`px-6 py-4 whitespace-nowrap text-sm ${
                    darkMode ? "text-gray-200" : "text-gray-900"
                  }`}
                >
                  {post.createdAt?.toDate().toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => handleEditPost(post)}
                    className={`text-sm ${
                      darkMode ? "text-blue-400" : "text-blue-600"
                    } hover:underline mr-4`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeletePost(post.id)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

PostManager.propTypes = {
  darkMode: PropTypes.bool.isRequired,
};

export default PostManager;
