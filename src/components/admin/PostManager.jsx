import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { db, storage } from "../../config/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import PropTypes from "prop-types";
import MarkdownToolbar from "../posts/MarkdownToolbar";

const PostManager = ({ darkMode }) => {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [postsLimit, setPostsLimit] = useState(10);
  const [currentPost, setCurrentPost] = useState({
    title: "",
    content: "",
    category: "news",
    platforms: [],
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const contentTextareaRef = useRef(null);

  // Add admin check
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const isUserAdmin =
            userDoc.exists() && userDoc.data().role === "admin";
          setIsAdmin(isUserAdmin);
        } catch (error) {
          console.error("Error checking admin status:", error);
          setIsAdmin(false);
        }
      }
    };
    checkAdminStatus();
  }, [user]);

  // Handle featured image selection
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle inline image insertion
  const handleInlineImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        setIsUploading(true);
        const imageData = await uploadImage(file);
        if (imageData?.url) {
          // Insert the image tag at cursor position with newlines
          const textarea = contentTextareaRef.current;
          const cursorPos = textarea.selectionStart;
          const content = currentPost.content;
          const newContent =
            content.substring(0, cursorPos) +
            `\n[img:${imageData.url}|${file.name}]\n` +
            content.substring(cursorPos);

          setCurrentPost({ ...currentPost, content: newContent });

          // Reset cursor position after the image tag and newline
          setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd =
              cursorPos + `\n[img:${imageData.url}|${file.name}]\n`.length;
          }, 0);
        }
      } catch (error) {
        console.error("Error uploading inline image:", error);
      } finally {
        setIsUploading(false);
      }
    }
  };

  // Upload image to Firebase Storage
  const uploadImage = async (file) => {
    if (!file) return null;

    const fileExtension = file.name.split(".").pop();
    const fileName = `${Date.now()}.${fileExtension}`;
    const storageRef = ref(storage, `post-images/${fileName}`);

    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);
    return { url: downloadURL, path: `post-images/${fileName}` };
  };

  // Fetch posts with vote counts
  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const postsCollection = collection(db, "posts");
        const postsSnapshot = await getDocs(postsCollection);
        const postsList = postsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          voteCount: 0, // Initialize vote count
        }));

        // Fetch all votes
        const votesQuery = query(collection(db, "votes"));
        const votesSnapshot = await getDocs(votesQuery);
        const postVoteCounts = {};

        votesSnapshot.docs.forEach((doc) => {
          const vote = doc.data();
          postVoteCounts[vote.postId] =
            (postVoteCounts[vote.postId] || 0) + (vote.type === "up" ? 1 : -1);
        });

        // Update posts with vote counts
        const postsWithVotes = postsList.map((post) => ({
          ...post,
          voteCount: postVoteCounts[post.id] || 0,
        }));

        // Sort by votes and date
        const sortedPosts = [...postsWithVotes].sort((a, b) => {
          const voteDiff = (b.voteCount || 0) - (a.voteCount || 0);
          if (voteDiff !== 0) return voteDiff;
          return b.createdAt?.toDate() - a.createdAt?.toDate();
        });

        setPosts(sortedPosts);
      } catch (error) {
        console.error("Error fetching posts:", error);
      }
    };

    fetchPosts();
  }, []);

  // Create new post
  const handleCreatePost = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      let imageData = null;
      if (imageFile) {
        imageData = await uploadImage(imageFile);
      }

      const postData = {
        ...currentPost,
        authorId: user.uid,
        authorName: user.displayName || user.email.split("@")[0],
        authorEmail: user.email,
        authorPhotoURL: user.photoURL,
        imageUrl: imageData?.url || null,
        imagePath: imageData?.path || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        usersThatLiked: [],
        usersThatDisliked: [],
        totalVotes: 0,
        status: isAdmin ? "published" : "pending",
      };

      const postsCollection = collection(db, "posts");
      await addDoc(postsCollection, postData);

      // Reset form and refresh posts
      setCurrentPost({
        title: "",
        content: "",
        category: "news",
        platforms: [],
      });
      setImageFile(null);
      setImagePreview(null);
      const postsSnapshot = await getDocs(postsCollection);
      const postsList = postsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setPosts(postsList);
    } catch (error) {
      console.error("Error creating post:", error);
    } finally {
      setIsUploading(false);
    }
  };

  // Update post
  const handleUpdatePost = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      let imageData = null;

      // If there's a new image, upload it and delete the old one
      if (imageFile) {
        // Delete old image if it exists
        if (currentPost.imagePath) {
          const oldImageRef = ref(storage, currentPost.imagePath);
          try {
            await deleteObject(oldImageRef);
          } catch (error) {
            console.error("Error deleting old image:", error);
          }
        }
        imageData = await uploadImage(imageFile);
      }

      const updateData = {
        title: currentPost.title,
        content: currentPost.content,
        category: currentPost.category || "news",
        platforms: currentPost.platforms || [],
        updatedAt: serverTimestamp(),
        lastEditedBy: user.displayName || user.email.split("@")[0],
        lastEditedById: user.uid,
      };

      // Only add image data if there's a new image
      if (imageData) {
        updateData.imageUrl = imageData.url;
        updateData.imagePath = imageData.path;
      }

      const postRef = doc(db, "posts", currentPost.id);
      await updateDoc(postRef, updateData);

      // Reset form and refresh posts
      setCurrentPost({
        title: "",
        content: "",
        category: "news",
        platforms: [],
      });
      setImageFile(null);
      setImagePreview(null);
      setIsEditing(false);
      const postsSnapshot = await getDocs(collection(db, "posts"));
      const postsList = postsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setPosts(postsList);
    } catch (error) {
      console.error("Error updating post:", error);
    } finally {
      setIsUploading(false);
    }
  };

  // Delete post
  const handleDeletePost = async (postId) => {
    if (window.confirm("Are you sure you want to delete this post?")) {
      try {
        const post = posts.find((p) => p.id === postId);

        // Delete image if it exists
        if (post.imagePath) {
          const imageRef = ref(storage, post.imagePath);
          try {
            await deleteObject(imageRef);
          } catch (error) {
            console.error("Error deleting image:", error);
          }
        }

        await deleteDoc(doc(db, "posts", postId));
        setPosts(posts.filter((post) => post.id !== postId));
      } catch (error) {
        console.error("Error deleting post:", error);
      }
    }
  };

  // Edit post
  const handleEditPost = (post) => {
    setCurrentPost({
      id: post.id,
      title: post.title,
      content: post.content,
      category: post.category || "news",
      platforms: Array.isArray(post.platforms)
        ? post.platforms
        : [post.platform || "Nintendo"],
      imageUrl: post.imageUrl,
      imagePath: post.imagePath,
    });
    setImagePreview(post.imageUrl);
    setIsEditing(true);
  };

  return (
    <div className={`p-4 ${darkMode ? "text-gray-200" : "text-gray-900"}`}>
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
            required
            className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              darkMode
                ? "bg-[#1C2128] border-gray-700 text-white"
                : "border-gray-300"
            }`}
          />
        </div>

        <div>
          <label
            htmlFor="platforms"
            className={`block text-sm font-medium ${
              darkMode ? "text-gray-200" : "text-gray-700"
            }`}
          >
            Platforms
          </label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {["Nintendo", "PlayStation", "Xbox", "PC", "VR", "Mobile"].map(
              (platform) => (
                <label
                  key={platform}
                  className={`flex items-center p-2 rounded-md cursor-pointer ${
                    darkMode
                      ? currentPost.platforms.includes(platform)
                        ? "bg-[#316DCA] text-white"
                        : "bg-[#1C2128] text-gray-200 hover:bg-[#2D333B]"
                      : currentPost.platforms.includes(platform)
                      ? "bg-blue-500 text-white"
                      : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={currentPost.platforms.includes(platform)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCurrentPost({
                          ...currentPost,
                          platforms: [...currentPost.platforms, platform],
                        });
                      } else {
                        setCurrentPost({
                          ...currentPost,
                          platforms: currentPost.platforms.filter(
                            (p) => p !== platform
                          ),
                        });
                      }
                    }}
                  />
                  <span className="ml-2">{platform}</span>
                </label>
              )
            )}
          </div>
          {currentPost.platforms.length === 0 && (
            <p
              className={`mt-1 text-sm ${
                darkMode ? "text-red-400" : "text-red-500"
              }`}
            >
              Please select at least one platform
            </p>
          )}
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
            htmlFor="image"
            className={`block text-sm font-medium ${
              darkMode ? "text-gray-200" : "text-gray-700"
            }`}
          >
            Featured Image
          </label>
          <input
            type="file"
            id="image"
            accept="image/*"
            onChange={handleImageChange}
            className={`mt-1 block w-full text-sm ${
              darkMode ? "text-gray-200" : "text-gray-700"
            } file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium ${
              darkMode
                ? "file:bg-gray-700 file:text-gray-200"
                : "file:bg-gray-100 file:text-gray-700"
            } hover:file:bg-opacity-80`}
          />
          {imagePreview && (
            <div className="mt-2">
              <img
                src={imagePreview}
                alt="Preview"
                className="h-32 w-auto object-cover rounded-md"
              />
            </div>
          )}
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
          <div className="mt-1 mb-2 flex items-center space-x-2">
            <label
              htmlFor="inlineImage"
              className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md cursor-pointer ${
                darkMode
                  ? "bg-gray-700 text-gray-200 hover:bg-gray-600"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <svg
                className="w-5 h-5 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              Insert Image
              <input
                type="file"
                id="inlineImage"
                accept="image/*"
                onChange={handleInlineImageUpload}
                className="hidden"
              />
            </label>
            {isUploading && (
              <span
                className={`text-sm ${
                  darkMode ? "text-gray-400" : "text-gray-500"
                }`}
              >
                Uploading...
              </span>
            )}
          </div>
          <MarkdownToolbar
            textareaRef={contentTextareaRef}
            darkMode={darkMode}
          />
          <textarea
            id="content"
            ref={contentTextareaRef}
            rows={6}
            value={currentPost.content}
            onChange={(e) =>
              setCurrentPost({ ...currentPost, content: e.target.value })
            }
            className={`block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
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
                setCurrentPost({
                  title: "",
                  content: "",
                  category: "news",
                  platforms: [],
                });
                setImageFile(null);
                setImagePreview(null);
                setIsEditing(false);
              }}
              className="mr-4 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isUploading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              darkMode
                ? "bg-[#316DCA] hover:bg-[#2760AA] focus:ring-[#316DCA]"
                : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
            } ${isUploading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {isUploading
              ? "Uploading..."
              : isEditing
              ? "Update Post"
              : "Create Post"}
          </button>
        </div>
      </form>

      <div className="mt-8 mb-4 flex items-center justify-between">
        <h2
          className={`text-xl font-semibold ${
            darkMode ? "text-gray-200" : "text-gray-900"
          }`}
        >
          Posts List
        </h2>
        <div className="flex items-center space-x-3">
          <label
            htmlFor="postsLimit"
            className={`text-sm ${
              darkMode ? "text-gray-300" : "text-gray-600"
            }`}
          >
            Show posts:
          </label>
          <select
            id="postsLimit"
            value={postsLimit}
            onChange={(e) => setPostsLimit(Number(e.target.value))}
            className={`w-20 rounded-md border px-2 py-1 text-sm ${
              darkMode
                ? "bg-gray-700 border-gray-600 text-gray-200"
                : "bg-white border-gray-300 text-gray-900"
            }`}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
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
                  Votes
                </th>
                <th
                  className={`px-6 py-3 text-left text-xs font-medium ${
                    darkMode ? "text-gray-200" : "text-gray-500"
                  } uppercase tracking-wider`}
                >
                  Image
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
              {posts.slice(0, postsLimit).map((post) => (
                <tr key={post.id}>
                  <td
                    className={`px-6 py-4 text-sm max-w-xs truncate ${
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
                    {post.voteCount || 0}
                  </td>
                  <td
                    className={`px-6 py-4 whitespace-nowrap text-sm ${
                      darkMode ? "text-gray-200" : "text-gray-900"
                    }`}
                  >
                    {post.imageUrl ? (
                      <img
                        src={post.imageUrl}
                        alt={post.title}
                        className="h-10 w-10 object-cover rounded"
                      />
                    ) : (
                      "No image"
                    )}
                  </td>
                  <td
                    className={`px-6 py-4 whitespace-nowrap text-sm ${
                      darkMode ? "text-gray-200" : "text-gray-900"
                    }`}
                  >
                    <div className="max-w-[150px] truncate">
                      {post.authorName || post.authorEmail}
                      {post.lastEditedBy && (
                        <span className="text-xs text-gray-500 block truncate">
                          Last edited by: {post.lastEditedBy}
                        </span>
                      )}
                    </div>
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
    </div>
  );
};

PostManager.propTypes = {
  darkMode: PropTypes.bool.isRequired,
};

export default PostManager;
