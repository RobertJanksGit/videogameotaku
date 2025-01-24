import { useState, useEffect } from "react";
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
  where,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import PropTypes from "prop-types";

const UserPostManager = ({ darkMode }) => {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [currentPost, setCurrentPost] = useState({
    title: "",
    content: "",
    category: "news",
    platform: "Nintendo",
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // Handle image selection
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

  // Fetch user's posts with vote counts
  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const postsCollection = collection(db, "posts");
        const userPostsQuery = query(
          postsCollection,
          where("authorId", "==", user.uid)
        );
        const postsSnapshot = await getDocs(userPostsQuery);
        const postsList = postsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          voteCount: 0,
        }));

        // Fetch all votes for user's posts
        const votesQuery = query(collection(db, "votes"));
        const votesSnapshot = await getDocs(votesQuery);
        const postVoteCounts = {};

        votesSnapshot.docs.forEach((doc) => {
          const vote = doc.data();
          if (postsList.some((post) => post.id === vote.postId)) {
            postVoteCounts[vote.postId] =
              (postVoteCounts[vote.postId] || 0) +
              (vote.type === "up" ? 1 : -1);
          }
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

    if (user) {
      fetchPosts();
    }
  }, [user]);

  // Create new post
  const handleCreatePost = async (e) => {
    e.preventDefault();
    setIsUploading(true);
    try {
      let imageData = null;
      if (imageFile) {
        imageData = await uploadImage(imageFile);
      }

      const postsCollection = collection(db, "posts");
      await addDoc(postsCollection, {
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
      });

      // Reset form
      setCurrentPost({
        title: "",
        content: "",
        category: "news",
        platform: "Nintendo",
      });
      setImageFile(null);
      setImagePreview(null);

      // Refresh posts
      const userPostsQuery = query(
        postsCollection,
        where("authorId", "==", user.uid)
      );
      const postsSnapshot = await getDocs(userPostsQuery);
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

      if (imageFile) {
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

      const postRef = doc(db, "posts", currentPost.id);
      await updateDoc(postRef, {
        title: currentPost.title,
        content: currentPost.content,
        category: currentPost.category,
        platform: currentPost.platform,
        ...(imageData && {
          imageUrl: imageData.url,
          imagePath: imageData.path,
        }),
        updatedAt: serverTimestamp(),
      });

      // Reset form
      setCurrentPost({
        title: "",
        content: "",
        category: "news",
        platform: "Nintendo",
      });
      setImageFile(null);
      setImagePreview(null);
      setIsEditing(false);

      // Refresh posts
      const postsCollection = collection(db, "posts");
      const userPostsQuery = query(
        postsCollection,
        where("authorId", "==", user.uid)
      );
      const postsSnapshot = await getDocs(userPostsQuery);
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
    setCurrentPost(post);
    setImagePreview(post.imageUrl);
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
            htmlFor="platform"
            className={`block text-sm font-medium ${
              darkMode ? "text-gray-200" : "text-gray-700"
            }`}
          >
            Platform
          </label>
          <select
            id="platform"
            value={currentPost.platform}
            onChange={(e) =>
              setCurrentPost({ ...currentPost, platform: e.target.value })
            }
            required
            className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              darkMode
                ? "bg-[#1C2128] border-gray-700 text-white"
                : "border-gray-300"
            }`}
          >
            <option value="Nintendo">Nintendo</option>
            <option value="Sony">Sony</option>
            <option value="Microsoft">Microsoft</option>
            <option value="PC">PC</option>
          </select>
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
                setCurrentPost({
                  title: "",
                  content: "",
                  category: "news",
                  platform: "Nintendo",
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

UserPostManager.propTypes = {
  darkMode: PropTypes.bool.isRequired,
};

export default UserPostManager;
