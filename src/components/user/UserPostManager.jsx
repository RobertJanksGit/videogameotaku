import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { db, storage } from "../../config/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp,
  getDoc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { increment } from "firebase/firestore";
import PropTypes from "prop-types";

const UserPostManager = ({ darkMode }) => {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [currentPost, setCurrentPost] = useState({
    title: "",
    content: "",
    category: "news",
    platforms: [],
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState("");
  const [cooldownEnd, setCooldownEnd] = useState(null);
  const [recentRejections, setRecentRejections] = useState(0);
  const contentTextareaRef = useRef(null);

  // Add admin check
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          setIsAdmin(userDoc.exists() && userDoc.data().role === "admin");
        } catch (error) {
          console.error("Error checking admin status:", error);
          setIsAdmin(false);
        }
      }
    };
    checkAdminStatus();
  }, [user]);

  // Add countdown timer effect
  useEffect(() => {
    if (!cooldownEnd) return;

    const timer = setInterval(() => {
      const now = Date.now();
      if (now >= cooldownEnd) {
        setIsRateLimited(false);
        setRateLimitMessage("");
        setCooldownEnd(null);
        return;
      }

      const timeLeft = cooldownEnd - now;
      const minutesLeft = Math.floor(timeLeft / (60 * 1000));
      const secondsLeft = Math.floor((timeLeft % (60 * 1000)) / 1000);

      let message;
      if (minutesLeft > 0) {
        message = `Please wait ${minutesLeft} minute${
          minutesLeft !== 1 ? "s" : ""
        } and ${secondsLeft} second${
          secondsLeft !== 1 ? "s" : ""
        } before creating another post.`;
      } else {
        message = `Please wait ${secondsLeft} second${
          secondsLeft !== 1 ? "s" : ""
        } before creating another post.`;
      }

      setRateLimitMessage(message);
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownEnd]);

  // Add rate limit listener and track rejections
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      doc(db, "rateLimits", user.uid),
      async (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          const now = Date.now();

          // Check if it's been 6 hours since last rejection and reset if needed
          if (data.lastRejectionTime && data.recentRejections > 0) {
            const sixHoursInMs = 6 * 60 * 60 * 1000;
            const timeSinceLastRejection =
              now - data.lastRejectionTime.toMillis();

            if (timeSinceLastRejection >= sixHoursInMs) {
              // Reset rejection count
              await updateDoc(doc.ref, {
                recentRejections: 0,
                lastRejectionTime: null,
              });
              setRecentRejections(0);
              return;
            }
          }

          // Track recent rejections
          setRecentRejections(data.recentRejections || 0);

          // Check if user is banned
          if (data.bannedUntil && now < data.bannedUntil) {
            const hoursLeft = Math.ceil(
              (data.bannedUntil - now) / (1000 * 60 * 60)
            );
            setRateLimitMessage(
              `You are temporarily banned from posting for ${hoursLeft} hours due to multiple rejected posts.`
            );
            setIsRateLimited(true);
            setCooldownEnd(data.bannedUntil);
            return;
          }

          // Check cooldown periods
          if (data.lastPostTime) {
            const cooldownMinutes = data.lastPostStatus === "rejected" ? 3 : 10;
            const cooldownEndTime =
              data.lastPostTime.toMillis() + cooldownMinutes * 60 * 1000;

            if (now < cooldownEndTime) {
              setCooldownEnd(cooldownEndTime);
              setIsRateLimited(true);
              // Initial message will be set by the countdown timer
              return;
            }
          }

          // Check rate limits
          if (data.count >= 50 && data.resetTime > now) {
            setCooldownEnd(data.resetTime);
            setIsRateLimited(true);
            // Initial message will be set by the countdown timer
            return;
          }

          // If we get here, user is not rate limited
          setIsRateLimited(false);
          setRateLimitMessage("");
          setCooldownEnd(null);
        } else {
          // No rate limit document exists yet
          setIsRateLimited(false);
          setRateLimitMessage("");
          setCooldownEnd(null);
        }
      }
    );

    return () => unsubscribe();
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

    // Add metadata including user ID
    const metadata = {
      customMetadata: {
        userId: user.uid,
      },
    };

    await uploadBytes(storageRef, file, metadata);
    const downloadURL = await getDownloadURL(storageRef);
    return { url: downloadURL, path: `post-images/${fileName}` };
  };

  // Fetch user's posts with vote counts
  useEffect(() => {
    let unsubscribePosts = null;
    let unsubscribeVotes = null;

    const setupRealtimeListeners = () => {
      try {
        const postsCollection = collection(db, "posts");
        const userPostsQuery = query(
          postsCollection,
          where("authorId", "==", user.uid)
        );

        // Listen to posts changes
        unsubscribePosts = onSnapshot(userPostsQuery, (postsSnapshot) => {
          const postsList = postsSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            voteCount: 0,
          }));

          // Listen to votes changes
          const votesCollection = collection(db, "votes");
          unsubscribeVotes = onSnapshot(votesCollection, (votesSnapshot) => {
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
          });
        });
      } catch (error) {
        console.error("Error setting up real-time listeners:", error);
      }
    };

    if (user) {
      setupRealtimeListeners();
    }

    // Cleanup function
    return () => {
      if (unsubscribePosts) unsubscribePosts();
      if (unsubscribeVotes) unsubscribeVotes();
    };
  }, [user]);

  // Create new post
  const handleCreatePost = async (e) => {
    e.preventDefault();

    if (isRateLimited) {
      setValidationError(rateLimitMessage);
      return;
    }

    // Add character count validation
    if (currentPost.title.length < 3 || currentPost.title.length > 100) {
      setValidationError("Title must be between 3 and 100 characters");
      return;
    }

    if (
      currentPost.content.length < 200 ||
      currentPost.content.length > 10000
    ) {
      setValidationError("Content must be between 200 and 10,000 characters");
      return;
    }

    setIsUploading(true);
    setValidationError(null);

    try {
      // Check rate limits first
      const now = Date.now();
      const rateLimitRef = doc(db, "rateLimits", user.uid);
      const rateLimitDoc = await getDoc(rateLimitRef);

      // Initialize rate limit document if it doesn't exist
      if (!rateLimitDoc.exists()) {
        await setDoc(rateLimitRef, {
          count: 0,
          resetTime: now + 60000, // 1 minute
          lastPostTime: null,
          lastPostStatus: null,
          recentRejections: 0,
          bannedUntil: null,
        });
      }

      // First upload the image if exists
      let imageData = null;
      if (imageFile) {
        imageData = await uploadImage(imageFile);
      }

      // Create the post document
      const postsCollection = collection(db, "posts");
      const newPost = {
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

      // Create the post
      await addDoc(postsCollection, newPost);

      // Update rate limit after successful post creation
      await updateDoc(rateLimitRef, {
        count: increment(1),
        lastPostTime: serverTimestamp(),
        lastPostStatus: "pending",
      });

      // Reset form
      setCurrentPost({
        title: "",
        content: "",
        category: "news",
        platforms: [],
      });
      setImageFile(null);
      setImagePreview(null);
      setIsUploading(false);
    } catch (error) {
      console.error("Error creating post:", error);
      setValidationError(error.message);
      setIsUploading(false);
    }
  };

  // Delete post
  const handleDeletePost = async (postId) => {
    if (window.confirm("Are you sure you want to delete this post?")) {
      try {
        const post = posts.find((p) => p.id === postId);

        // First delete the document from Firestore
        await deleteDoc(doc(db, "posts", postId));

        // Then attempt to delete the image if it exists
        if (post.imagePath) {
          const imageRef = ref(storage, post.imagePath);
          try {
            await deleteObject(imageRef);
          } catch (error) {
            // Log the error but don't throw it since the post is already deleted
            console.error("Error deleting image:", error);
            // Continue with the UI update even if image deletion fails
          }
        }

        // Update the UI
        setPosts(posts.filter((post) => post.id !== postId));
      } catch (error) {
        console.error("Error deleting post:", error);
        alert("Error deleting post. Please try again.");
      }
    }
  };

  // Edit post
  const handleEditPost = (post) => {
    setCurrentPost(post);
    setImagePreview(post.imageUrl);
  };

  return (
    <div className="space-y-6">
      {rateLimitMessage && (
        <div
          className={`p-4 rounded-md ${
            darkMode
              ? "bg-yellow-900/20 border border-yellow-800"
              : "bg-yellow-50 border border-yellow-200"
          }`}
        >
          <p
            className={`text-sm ${
              darkMode ? "text-yellow-200" : "text-yellow-800"
            }`}
          >
            {rateLimitMessage}
          </p>
        </div>
      )}

      <form onSubmit={handleCreatePost} className="space-y-4">
        {validationError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <p
                  className={`text-sm ${
                    darkMode ? "text-red-200" : "text-red-800"
                  }`}
                >
                  {validationError}
                </p>
              </div>
            </div>
          </div>
        )}

        {recentRejections > 0 && (
          <div
            className={`p-4 rounded-md ${
              darkMode
                ? "bg-yellow-900/20 border border-yellow-800"
                : "bg-yellow-50 border border-yellow-200"
            }`}
          >
            <p
              className={`text-sm ${
                darkMode ? "text-yellow-200" : "text-yellow-800"
              }`}
            >
              {recentRejections === 1
                ? "Warning: Your last post was rejected. Multiple rejected posts may result in a 24-hour posting ban."
                : recentRejections === 2
                ? "Warning: You have had 2 posts rejected. A 24-hour posting ban will occur after 5 rejected posts."
                : recentRejections === 3
                ? "Warning: You have had 3 posts rejected. Two more rejections will result in a 24-hour posting ban."
                : recentRejections === 4
                ? "Warning: You have had 4 posts rejected. One more rejection will result in a 24-hour posting ban."
                : "Warning: Due to multiple rejected posts, your next rejection will result in a 24-hour posting ban."}
            </p>
          </div>
        )}

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
          <p
            className={`mt-1 text-sm ${
              darkMode ? "text-gray-400" : "text-gray-500"
            }`}
          >
            {currentPost.title.length}/100 characters (minimum 3)
          </p>
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
            {["Nintendo", "Sony", "Microsoft", "PC"].map((platform) => (
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
            ))}
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
          <p
            className={`mt-1 text-sm ${
              darkMode ? "text-gray-400" : "text-gray-500"
            } ${
              currentPost.content.length < 200 ||
              currentPost.content.length > 10000
                ? "text-red-500 dark:text-red-400"
                : ""
            }`}
          >
            {currentPost.content.length}/10,000 characters (minimum 200)
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isUploading || isRateLimited}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              darkMode
                ? "bg-[#316DCA] hover:bg-[#2760AA] focus:ring-[#316DCA]"
                : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
            } ${
              isUploading || isRateLimited
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            {isUploading ? "Uploading..." : "Create Post"}
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
                  Status
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
                    {post.status === "rejected" && post.moderationMessage && (
                      <>
                        <div className="text-xs text-red-500 mt-1">
                          {post.moderationMessage}
                        </div>
                        <div className="text-xs text-yellow-500 mt-1">
                          Warning: Multiple rejected posts may result in a
                          24-hour posting ban.
                        </div>
                      </>
                    )}
                  </td>
                  <td
                    className={`px-6 py-4 whitespace-nowrap text-sm ${
                      darkMode ? "text-gray-200" : "text-gray-900"
                    }`}
                  >
                    {post.category}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm`}>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        (post.status || "pending") === "published"
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : (post.status || "pending") === "rejected"
                          ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                      }`}
                    >
                      {(post.status || "pending").charAt(0).toUpperCase() +
                        (post.status || "pending").slice(1)}
                    </span>
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
                    {post.createdAt &&
                    typeof post.createdAt.toDate === "function"
                      ? post.createdAt.toDate().toLocaleDateString()
                      : new Date(post.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {isAdmin && (
                      <button
                        onClick={() => handleEditPost(post)}
                        className={`text-sm ${
                          darkMode ? "text-blue-400" : "text-blue-600"
                        } hover:underline mr-4`}
                      >
                        Edit
                      </button>
                    )}
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
