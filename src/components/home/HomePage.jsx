import { useState, useEffect } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../config/firebase";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  where,
  startAfter,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import VoteButtons from "../posts/VoteButtons";
import ShareButtons from "../common/ShareButtons";
import RichContent from "../posts/RichContent";

const HomePage = () => {
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [latestPosts, setLatestPosts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [lastVisible, setLastVisible] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Migrate old voting system to new array-based system
  const migratePost = async (post) => {
    if (
      Array.isArray(post.usersThatLiked) &&
      Array.isArray(post.usersThatDisliked)
    ) {
      return post; // Already migrated
    }

    const usersThatLiked = [];
    const usersThatDisliked = [];

    // Convert old object format to arrays
    if (post.usersThatLiked && typeof post.usersThatLiked === "object") {
      Object.entries(post.usersThatLiked).forEach(([userId, voteType]) => {
        if (voteType === "upvote") {
          usersThatLiked.push(userId);
        } else if (voteType === "downvote") {
          usersThatDisliked.push(userId);
        }
      });
    }

    // Update the post in Firestore
    const postRef = doc(db, "posts", post.id);
    await updateDoc(postRef, {
      usersThatLiked,
      usersThatDisliked,
      totalVotes: usersThatLiked.length - usersThatDisliked.length,
    });

    return {
      ...post,
      usersThatLiked,
      usersThatDisliked,
      totalVotes: usersThatLiked.length - usersThatDisliked.length,
    };
  };

  // Separate function to fetch featured posts
  const fetchFeaturedPosts = async () => {
    try {
      // Calculate start of current day in user's timezone
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );

      const featuredQuery = query(
        collection(db, "posts"),
        where("status", "==", "published"),
        where("createdAt", ">=", startOfDay),
        orderBy("createdAt", "desc"),
        orderBy("totalVotes", "desc"),
        limit(4)
      );

      const featuredSnapshot = await getDocs(featuredQuery);
      const featuredPosts = await Promise.all(
        featuredSnapshot.docs.map(async (doc) => {
          const post = { id: doc.id, ...doc.data() };
          const commentsQuery = query(
            collection(db, "comments"),
            where("postId", "==", doc.id)
          );
          const commentsSnapshot = await getDocs(commentsQuery);
          const commentCount = commentsSnapshot.size;

          return { ...(await migratePost(post)), commentCount };
        })
      );

      // If we don't have enough posts from today, fetch from the last 7 days
      if (featuredPosts.length < 4) {
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const extendedQuery = query(
          collection(db, "posts"),
          where("status", "==", "published"),
          where("createdAt", ">=", sevenDaysAgo),
          orderBy("createdAt", "desc"),
          orderBy("totalVotes", "desc"),
          limit(4)
        );

        const extendedSnapshot = await getDocs(extendedQuery);
        const extendedPosts = await Promise.all(
          extendedSnapshot.docs.map(async (doc) => {
            const post = { id: doc.id, ...doc.data() };
            const commentsQuery = query(
              collection(db, "comments"),
              where("postId", "==", doc.id)
            );
            const commentsSnapshot = await getDocs(commentsQuery);
            const commentCount = commentsSnapshot.size;

            return { ...(await migratePost(post)), commentCount };
          })
        );

        setFeaturedPosts(extendedPosts);
      } else {
        setFeaturedPosts(featuredPosts);
      }
    } catch (error) {
      console.error("Error fetching featured posts:", error);
    }
  };

  // Function to fetch latest posts
  const fetchLatestPosts = async (isLoadingMore = false) => {
    try {
      setIsLoading(true);

      // Create base query conditions
      let queryConditions = [
        where("status", "==", "published"),
        orderBy("createdAt", "desc"),
        limit(10),
      ];

      // Add category filter if a specific category is selected
      if (selectedCategory !== "all") {
        queryConditions.unshift(where("category", "==", selectedCategory));
      }

      // Add startAfter if loading more
      if (isLoadingMore && lastVisible) {
        queryConditions.push(startAfter(lastVisible));
      }

      // Create the query with all conditions
      const postsQuery = query(collection(db, "posts"), ...queryConditions);

      const postsSnapshot = await getDocs(postsQuery);

      // Update lastVisible
      if (postsSnapshot.docs.length > 0) {
        setLastVisible(postsSnapshot.docs[postsSnapshot.docs.length - 1]);
        setHasMore(postsSnapshot.docs.length === 10);
      } else {
        setHasMore(false);
      }

      const newPosts = await Promise.all(
        postsSnapshot.docs.map(async (doc) => {
          const post = { id: doc.id, ...doc.data() };
          const commentsQuery = query(
            collection(db, "comments"),
            where("postId", "==", doc.id)
          );
          const commentsSnapshot = await getDocs(commentsQuery);
          const commentCount = commentsSnapshot.size;

          return { ...(await migratePost(post)), commentCount };
        })
      );

      // Update posts list
      setLatestPosts((prev) =>
        isLoadingMore ? [...prev, ...newPosts] : newPosts
      );
    } catch (error) {
      console.error("Error fetching latest posts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Effect for initial load and category changes
  useEffect(() => {
    setLastVisible(null);
    setHasMore(true);
    fetchLatestPosts();
  }, [selectedCategory]);

  // Separate effect for featured posts
  useEffect(() => {
    fetchFeaturedPosts();
  }, [user]);

  // Infinite scroll handler
  const handleScroll = () => {
    const scrollPosition = window.innerHeight + window.pageYOffset;
    const threshold = document.documentElement.scrollHeight - 100; // 100px before bottom

    if (scrollPosition >= threshold) {
      if (hasMore && !isLoading) {
        fetchLatestPosts(true);
      }
    }
  };

  // Add scroll event listener with debounce
  useEffect(() => {
    let timeoutId;
    const debouncedScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleScroll, 100);
    };

    window.addEventListener("scroll", debouncedScroll);
    return () => {
      window.removeEventListener("scroll", debouncedScroll);
      clearTimeout(timeoutId);
    };
  }, [lastVisible, hasMore, isLoading, selectedCategory]);

  const handleVoteChange = (updatedPost) => {
    // Update latest posts without re-sorting
    setLatestPosts((posts) =>
      posts.map((post) => (post.id === updatedPost.id ? updatedPost : post))
    );

    // Update and re-sort featured posts
    setFeaturedPosts((posts) => {
      const updatedPosts = posts.map((post) =>
        post.id === updatedPost.id ? updatedPost : post
      );
      return [...updatedPosts].sort((a, b) => {
        const voteDiff = (b.totalVotes || 0) - (a.totalVotes || 0);
        if (voteDiff !== 0) return voteDiff;
        return b.createdAt?.toMillis() - a.createdAt?.toMillis();
      });
    });
  };

  const renderVoteButtons = (post) => {
    return (
      <VoteButtons
        post={post}
        darkMode={darkMode}
        onVoteChange={handleVoteChange}
      />
    );
  };

  const handlePostClick = (postId) => {
    navigate(`/post/${postId}`);
  };

  const getPreviewContent = (content) => {
    // Remove image tags first
    let cleanContent = content.replace(/\[img:[^\]]+\]/g, "");

    // Remove Markdown syntax
    cleanContent = cleanContent
      .replace(/#{1,6}\s/g, "") // Remove headers
      .replace(/(\*\*|__)(.*?)\1/g, "$2") // Remove bold
      .replace(/(\*|_)(.*?)\1/g, "$2") // Remove italic
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Remove links
      .replace(/`{1,3}[^`]*`{1,3}/g, "") // Remove code blocks
      .replace(/^\s*[-*+]\s+/gm, "") // Remove list markers
      .replace(/^\s*\d+\.\s+/gm, "") // Remove numbered lists
      .replace(/^\s*>\s+/gm, "") // Remove blockquotes
      .trim();

    // Limit to ~200 characters
    if (cleanContent.length > 200) {
      return cleanContent.substring(0, 200) + "...";
    }
    return cleanContent;
  };

  return (
    <div className="w-full space-y-8">
      {/* Featured Posts Section */}
      <section className="w-full">
        <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
          Featured Posts
        </h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 relative">
          {featuredPosts.map((post) => (
            <div
              key={post.id}
              onClick={() => handlePostClick(post.id)}
              className={`rounded-lg overflow-hidden ${
                darkMode
                  ? "bg-gray-800 border-gray-700"
                  : "bg-white border-gray-200"
              } shadow-lg border cursor-pointer transition-all duration-1000 ease-in-out transform hover:scale-[1.02]`}
              style={{
                gridColumn: "auto",
                gridRow: "auto",
                transition: "all 1s ease-in-out",
              }}
            >
              {post.imageUrl ? (
                <div className="aspect-w-16 aspect-h-9">
                  <img
                    src={post.imageUrl}
                    alt={post.title}
                    className="w-full h-48 object-cover"
                  />
                </div>
              ) : (
                <div
                  className={`w-full h-48 flex items-center justify-center ${
                    darkMode ? "bg-gray-700" : "bg-gray-100"
                  }`}
                >
                  <span
                    className={`text-4xl ${
                      darkMode ? "text-gray-600" : "text-gray-400"
                    }`}
                  >
                    📰
                  </span>
                </div>
              )}
              <div className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
                        darkMode
                          ? "bg-gray-700 text-gray-300"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {post.category}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(post.platforms)
                        ? post.platforms
                        : [post.platform]
                      ).map((platform) => (
                        <span
                          key={platform}
                          className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
                            darkMode
                              ? "bg-gray-700 text-gray-300"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {platform}
                        </span>
                      ))}
                    </div>
                  </div>
                  {renderVoteButtons(post)}
                </div>
                <h3
                  className={`text-xl font-semibold mb-2 ${
                    darkMode ? "text-white" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </h3>
                <p
                  className={`text-sm mb-4 line-clamp-2 ${
                    darkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  {getPreviewContent(post.content)}
                </p>
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs ${
                      darkMode ? "text-gray-400" : "text-gray-500"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center overflow-hidden ${
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
                            className={`text-xs font-medium ${
                              darkMode ? "text-gray-300" : "text-gray-600"
                            }`}
                          >
                            {post.authorName?.[0]?.toUpperCase() || "A"}
                          </span>
                        )}
                      </div>
                      <span>{post.authorName}</span>
                    </div>
                  </span>
                  <div className="flex items-center space-x-6">
                    <span
                      className={`text-xs flex items-center space-x-2 ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                        />
                      </svg>
                      <span>{post.commentCount || 0}</span>
                    </span>
                    <span
                      className={`text-xs ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      {post.createdAt?.toDate().toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Latest Posts Section */}
      <section className="w-full">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
            Latest Posts
          </h2>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className={`rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
              darkMode
                ? "bg-[#1C2128] border-gray-700 text-white"
                : "border-gray-300"
            }`}
          >
            <option value="all">All Categories</option>
            <option value="news">News</option>
            <option value="review">Review</option>
            <option value="guide">Guide</option>
            <option value="opinion">Opinion</option>
          </select>
        </div>
        <div className="space-y-8">
          {latestPosts.map((post) => (
            <article
              key={post.id}
              onClick={() => handlePostClick(post.id)}
              className={`rounded-lg overflow-hidden ${
                darkMode
                  ? "bg-gray-800 border-gray-700"
                  : "bg-white border-gray-200"
              } shadow-lg border cursor-pointer transition-transform hover:scale-[1.01]`}
            >
              {post.imageUrl && (
                <div className="aspect-w-16 aspect-h-9">
                  <img
                    src={post.imageUrl}
                    alt={post.title}
                    className="w-full h-64 object-cover"
                  />
                </div>
              )}
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
                          darkMode
                            ? "bg-gray-700 text-gray-300"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {post.category}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray(post.platforms)
                          ? post.platforms
                          : [post.platform]
                        ).map((platform) => (
                          <span
                            key={platform}
                            className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
                              darkMode
                                ? "bg-gray-700 text-gray-300"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {platform}
                          </span>
                        ))}
                      </div>
                    </div>
                    {renderVoteButtons(post)}
                  </div>
                  <ShareButtons
                    url={`${window.location.origin}/post/${post.id}`}
                    title={post.title}
                    darkMode={darkMode}
                  />
                </div>
                <h3
                  className={`text-2xl font-bold mb-4 ${
                    darkMode ? "text-white" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </h3>
                <p
                  className={`text-base mb-4 line-clamp-3 ${
                    darkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  {getPreviewContent(post.content)}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
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
                          className={`text-sm font-medium ${
                            darkMode ? "text-gray-300" : "text-gray-600"
                          }`}
                        >
                          {post.authorName?.[0]?.toUpperCase() || "A"}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-sm ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      {post.authorName}
                    </span>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span
                      className={`text-sm flex items-center space-x-1 ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                        />
                      </svg>
                      <span>{post.commentCount || 0}</span>
                    </span>
                    <span
                      className={`text-xs ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      {post.createdAt?.toDate().toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          ))}

          <div className="flex flex-col items-center py-4 space-y-4">
            {isLoading && (
              <div
                className={`animate-spin rounded-full h-8 w-8 border-b-2 ${
                  darkMode ? "border-white" : "border-gray-900"
                }`}
              ></div>
            )}

            {!isLoading && hasMore && (
              <button
                onClick={() => fetchLatestPosts(true)}
                className={`px-6 py-2 text-sm rounded-md ${
                  darkMode
                    ? "bg-[#1C2128] text-blue-400 hover:bg-[#22272E]"
                    : "bg-gray-100 text-blue-500 hover:bg-gray-200"
                }`}
              >
                Load More
              </button>
            )}

            {!hasMore && latestPosts.length > 0 && (
              <div
                className={`text-center ${
                  darkMode ? "text-gray-400" : "text-gray-600"
                }`}
              >
                No more posts to load
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
