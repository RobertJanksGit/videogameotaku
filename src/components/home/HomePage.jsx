import { useState, useEffect, useMemo, useCallback } from "react";
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
} from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import VoteButtons from "../posts/VoteButtons";
import ShareButtons from "../common/ShareButtons";
import SEO from "../common/SEO";
import StructuredData from "../common/StructuredData";
import OptimizedImage from "../common/OptimizedImage";
import formatTimeAgo, {
  getTimestampDate,
} from "../../utils/formatTimeAgo";
import {
  FEED_TAB_KEYS,
  FEED_TAB_CONFIG,
  getFeedTabs,
  buildFeedQuery,
  mergePostsForTab,
  processPostsForTab,
} from "../../utils/feedQueries";

const createEmptyTabState = () => ({
  posts: [],
  lastVisible: null,
  hasMore: true,
  isLoading: false,
  error: null,
});

const buildInitialTabData = () =>
  Object.values(FEED_TAB_KEYS).reduce((acc, key) => {
    acc[key] = createEmptyTabState();
    return acc;
  }, {});

const HomePage = () => {
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [activeTab, setActiveTab] = useState(FEED_TAB_KEYS.NEW);
  const [tabData, setTabData] = useState(() => buildInitialTabData());

  const tabs = useMemo(() => getFeedTabs(), []);
  const currentTabState = tabData[activeTab] || createEmptyTabState();
  const postsToRender = currentTabState.posts;
  const firstPostId = postsToRender[0]?.id;

  // Migrate old voting system to new array-based system
  const migratePost = useCallback(async (post) => {
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
  }, [db]);

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
        orderBy("totalVotes", "desc"),
        orderBy("createdAt", "desc"),
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
          orderBy("totalVotes", "desc"),
          orderBy("createdAt", "desc"),
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

  const fetchPostsForTab = useCallback(
    async (tabKey, { isLoadMore = false } = {}) => {
      const existingState = tabData[tabKey] || createEmptyTabState();
      const effectiveLastVisible = isLoadMore ? existingState.lastVisible : null;

      setTabData((prev) => {
        const previous = prev[tabKey] || createEmptyTabState();
        return {
          ...prev,
          [tabKey]: {
            ...previous,
            posts: isLoadMore ? previous.posts : [],
            lastVisible: isLoadMore ? previous.lastVisible : null,
            hasMore: isLoadMore ? previous.hasMore : true,
            isLoading: true,
            error: null,
          },
        };
      });

      try {
        const { queryRef, config } = buildFeedQuery({
          db,
          tabKey,
          selectedCategory,
          selectedPlatform,
          lastVisible: effectiveLastVisible,
        });

        const postsSnapshot = await getDocs(queryRef);

        const fetchedPosts = await Promise.all(
          postsSnapshot.docs.map(async (docSnapshot) => {
            const post = { id: docSnapshot.id, ...docSnapshot.data() };
            const migratedPost = await migratePost(post);
            const commentsQuery = query(
              collection(db, "comments"),
              where("postId", "==", docSnapshot.id)
            );
            const commentsSnapshot = await getDocs(commentsQuery);
            const commentCount = commentsSnapshot.size;

            return { ...migratedPost, commentCount };
          })
        );

        const mergedPosts = mergePostsForTab(
          tabKey,
          isLoadMore ? existingState.posts : [],
          fetchedPosts
        );

        const newLastVisible =
          postsSnapshot.docs.length > 0
            ? postsSnapshot.docs[postsSnapshot.docs.length - 1]
            : effectiveLastVisible;

        const pageSize = config?.pageSize ?? 10;

        setTabData((prev) => {
          const previous = prev[tabKey] || createEmptyTabState();
          return {
            ...prev,
            [tabKey]: {
              ...previous,
              posts: mergedPosts,
              lastVisible: newLastVisible,
              hasMore: postsSnapshot.docs.length === pageSize,
              isLoading: false,
              error: null,
            },
          };
        });
      } catch (error) {
        console.error(`Error fetching ${tabKey} posts:`, error);
        setTabData((prev) => {
          const previous = prev[tabKey] || createEmptyTabState();
          return {
            ...prev,
            [tabKey]: {
              ...previous,
              isLoading: false,
              error:
                "Unable to load posts right now. Please refresh or try again shortly.",
            },
          };
        });
      }
    },
    [db, migratePost, selectedCategory, selectedPlatform, tabData]
  );

  // Effect for initial load and category/platform changes
  useEffect(() => {
    setTabData(buildInitialTabData());
  }, [selectedCategory, selectedPlatform]);

  useEffect(() => {
    const state = tabData[activeTab];

    if (!state) {
      return;
    }

    if (!state.posts.length && !state.isLoading) {
      fetchPostsForTab(activeTab);
    }
  }, [activeTab, fetchPostsForTab, tabData]);

  // Separate effect for featured posts
  useEffect(() => {
    fetchFeaturedPosts();
  }, [user]);

  // Infinite scroll handler
  const handleScroll = () => {
    const scrollPosition = window.innerHeight + window.pageYOffset;
    const threshold = document.documentElement.scrollHeight - 100; // 100px before bottom

    if (scrollPosition >= threshold) {
      if (currentTabState.hasMore && !currentTabState.isLoading) {
        fetchPostsForTab(activeTab, { isLoadMore: true });
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
  }, [activeTab, currentTabState.hasMore, currentTabState.isLoading, fetchPostsForTab]);

  const handleVoteChange = (updatedPost) => {
    setTabData((prev) => {
      const nextState = {};

      Object.entries(prev).forEach(([key, state]) => {
        if (!state.posts || state.posts.length === 0) {
          nextState[key] = state;
          return;
        }

        const hasPost = state.posts.some((post) => post.id === updatedPost.id);

        if (!hasPost) {
          nextState[key] = state;
          return;
        }

        const updatedPosts = state.posts.map((post) =>
          post.id === updatedPost.id ? { ...post, ...updatedPost } : post
        );

        nextState[key] = {
          ...state,
          posts: processPostsForTab(key, updatedPosts),
        };
      });

      return nextState;
    });

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

  const getAuthorInitials = (name = "") => {
    const trimmed = name.trim();

    if (!trimmed) return "??";

    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const renderAuthorHeader = (post) => {
    const authorName = post.authorName || "Community Member";
    const initials = getAuthorInitials(authorName);
    const publishedAt = getTimestampDate(post.createdAt);
    const relativeTime = formatTimeAgo(post.createdAt);
    const timeDisplay = relativeTime
      ? relativeTime === "just now"
        ? relativeTime
        : `· ${relativeTime}`
      : "";

    const TimeElement = publishedAt ? "time" : "span";
    const authorId = post.authorId;
    const profileUrl = authorId ? `/user/${authorId}` : null;

    const authorContent = (
      <>
        <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 text-sm font-semibold uppercase text-white shadow-sm transition group-hover/author:brightness-110">
          {post.authorPhotoURL ? (
            <img
              src={post.authorPhotoURL}
              alt={authorName}
              className="h-full w-full object-cover u-photo"
            />
          ) : (
            initials
          )}
        </span>
        <span
          className={`p-name text-sm font-semibold leading-tight transition group-hover/author:underline ${
            darkMode
              ? "text-white group-hover/author:text-gray-100"
              : "text-gray-900 group-hover/author:text-gray-700"
          }`}
        >
          {authorName}
        </span>
      </>
    );

    return (
      <div
        className={`flex items-center justify-between px-5 py-4 border-b ${
          darkMode ? "border-gray-700 bg-gray-900/40" : "border-gray-200 bg-gray-50"
        }`}
      >
        {profileUrl ? (
          <Link
            to={profileUrl}
            aria-label={`View ${authorName}'s profile`}
            className="group/author flex items-center gap-3 text-left h-card p-author focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            onClick={(event) => event.stopPropagation()}
          >
            {authorContent}
          </Link>
        ) : (
          <div className="group/author flex items-center gap-3 text-left h-card p-author">
            {authorContent}
          </div>
        )}
        {timeDisplay ? (
          <TimeElement
            dateTime={
              publishedAt ? publishedAt.toISOString() : undefined
            }
            className={`text-xs ${
              darkMode ? "text-gray-400" : "text-gray-500"
            }`}
          >
            {timeDisplay}
          </TimeElement>
        ) : null}
      </div>
    );
  };

  const renderCardFooter = (post) => (
    <div className="flex items-center justify-between pt-4">
      <div
        className={`flex items-center gap-2 text-sm ${
          darkMode ? "text-gray-400" : "text-gray-600"
        }`}
      >
        <svg
          className="h-4 w-4"
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
        <span className="font-semibold">
          {post.commentCount != null ? post.commentCount : 0}
        </span>
        <span className="text-xs uppercase tracking-wide opacity-70">
          comments
        </span>
      </div>
      <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
        {renderVoteButtons(post)}
      </div>
    </div>
  );

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
    <>
      <SEO
        title="Home"
        description="Discover the latest gaming news, reviews, and discussions. Join our community of video game enthusiasts and share your gaming experiences."
        keywords="video games, gaming, game reviews, gaming community, video game discussions"
        type="website"
      />
      <StructuredData
        type="WebSite"
        data={{
          name: "Video Game Otaku",
          description:
            "Your ultimate destination for gaming news, reviews, and community discussions.",
          url: "https://videogameotaku.com",
        }}
      />
      <StructuredData
        type="Organization"
        data={{
          name: "Video Game Otaku",
          url: "https://videogameotaku.com",
          logo: "https://videogameotaku.com/logo.svg",
          socialLinks: [
            "https://twitter.com/videogameotaku",
            "https://facebook.com/videogameotaku",
            "https://instagram.com/videogameotaku",
          ],
        }}
      />

      {/* Page Title - Adding h1 for main page title */}
      <header className="max-w-4xl mx-auto px-4 pt-8 pb-4">
        <h1 className="text-4xl font-bold mb-6 text-gray-900 dark:text-white">
          Video Game Otaku
        </h1>
        <p className="text-lg mb-4 text-gray-700 dark:text-gray-300">
          Your ultimate destination for gaming news, reviews, and community
          discussions.
        </p>
      </header>

      {/* Featured Posts Section - Full Width (outside the container) */}
      <section className="w-full px-4 py-8">
        <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white max-w-7xl mx-auto">
          Featured Posts
        </h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-7xl mx-auto">
          {featuredPosts.map((post) => (
            <div
              key={post.id}
              onClick={() => handlePostClick(post.id)}
              className={`group flex h-full flex-col overflow-hidden rounded-lg border shadow-lg transition-transform duration-300 hover:scale-[1.02] ${
                darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
              }`}
            >
              {renderAuthorHeader(post)}
              {post.imageUrl ? (
                <div className="aspect-w-16 aspect-h-9 overflow-hidden">
                  <OptimizedImage
                    src={post.imageUrl}
                    alt={post.title}
                    className="w-full h-auto object-contain"
                    sizes="(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 100vw"
                    loading={featuredPosts.indexOf(post) < 2 ? "eager" : "lazy"}
                    objectFit="contain"
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
              <div className="flex flex-1 flex-col p-6">
                {/* Platforms Section */}
                <div className="mb-3 flex flex-wrap gap-1">
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

                {/* Category */}
                <div className="mb-4">
                  <span
                    className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${
                      darkMode
                        ? "bg-gray-700 text-gray-300"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {post.category}
                  </span>
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
                <div
                  className={`mt-auto border-t ${
                    darkMode ? "border-gray-700" : "border-gray-200"
                  }`}
                >
                  {renderCardFooter(post)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main content with restricted width */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Latest Posts Section */}
        <section className="w-full">
          <div className="mb-6 flex flex-col gap-4">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
              Community Feed
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <select
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                className={`w-full sm:w-auto px-3 py-2 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base ${
                  darkMode
                    ? "bg-[#1C2128] border-gray-700 text-white"
                    : "border-gray-300"
                }`}
              >
                <option value="all">All Platforms</option>
                <option value="Nintendo">Nintendo</option>
                <option value="PlayStation">PlayStation</option>
                <option value="Xbox">Xbox</option>
                <option value="PC">PC</option>
                <option value="VR">VR</option>
                <option value="Mobile">Mobile</option>
              </select>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className={`w-full sm:w-auto px-3 py-2 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base ${
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
              <select
                value={activeTab}
                onChange={(e) => setActiveTab(e.target.value)}
                className={`w-full sm:w-auto px-3 py-2 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base ${
                  darkMode
                    ? "bg-[#1C2128] border-gray-700 text-white"
                    : "border-gray-300"
                }`}
              >
                {[FEED_TAB_KEYS.NEW, ...tabs.map((tab) => tab.key).filter((key) => key !== FEED_TAB_KEYS.NEW)].map((key) => (
                  <option key={key} value={key}>
                    {FEED_TAB_CONFIG[key]?.label || key}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-8">
            {postsToRender.map((post) => (
              <article
                key={post.id}
                onClick={() => handlePostClick(post.id)}
                className={`h-entry group flex h-full flex-col overflow-hidden rounded-lg border shadow-lg cursor-pointer transition-transform hover:scale-[1.01] ${
                  darkMode
                    ? "bg-gray-800 border-gray-700"
                    : "bg-white border-gray-200"
                }`}
              >
                {renderAuthorHeader(post)}
                {post.imageUrl && (
                  <div className="w-full aspect-w-16 aspect-h-9 overflow-hidden">
                    <OptimizedImage
                      src={post.imageUrl}
                      alt={post.title}
                      className="w-full h-auto object-contain u-photo"
                      sizes="(min-width: 1024px) 896px, 100vw"
                      loading={post.id === firstPostId ? "eager" : "lazy"}
                      objectFit="contain"
                    />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-6">
                  <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Platform tags */}
                      {(Array.isArray(post.platforms)
                        ? post.platforms
                        : [post.platform]
                      ).map((platform) => (
                        <span
                          key={platform}
                          className={`inline-block rounded-full px-3 py-1 text-sm font-semibold p-category ${
                            darkMode
                              ? "bg-gray-700 text-gray-300"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {platform}
                        </span>
                      ))}
                      {/* Category tag */}
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-sm font-semibold p-category ${
                          darkMode
                            ? "bg-gray-700 text-gray-300"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {post.category}
                      </span>
                    </div>
                    <div
                      className="flex w-full items-center justify-start gap-3 sm:w-auto sm:justify-end"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ShareButtons
                        url={`${window.location.origin}/post/${post.id}`}
                        title={post.title}
                        darkMode={darkMode}
                      />
                    </div>
                  </div>
                  <h3
                    className={`mb-4 text-2xl font-bold p-name ${
                      darkMode ? "text-white" : "text-gray-900"
                    }`}
                  >
                    {post.title}
                  </h3>
                  <p
                    className={`mb-4 text-base line-clamp-3 p-summary ${
                      darkMode ? "text-gray-300" : "text-gray-600"
                    }`}
                  >
                    {getPreviewContent(post.content)}
                  </p>
                  <div
                    className={`mt-auto border-t ${
                      darkMode ? "border-gray-700" : "border-gray-200"
                    }`}
                  >
                    {renderCardFooter(post)}
                  </div>
                  <a href={`/post/${post.id}`} className="u-url hidden">
                    Permalink
                  </a>
                </div>
              </article>
            ))}

            {!currentTabState.isLoading && postsToRender.length === 0 && (
              <div
                className={`rounded-lg border p-6 text-center text-sm ${
                  darkMode
                    ? "border-gray-700 bg-gray-900 text-gray-300"
                    : "border-gray-200 bg-gray-50 text-gray-600"
                }`}
              >
                {currentTabState.error ||
                  "No posts found for this tab yet. Check back soon!"}
              </div>
            )}

            <div className="flex flex-col items-center py-4 space-y-4">
              {currentTabState.isLoading && (
                <div
                  className={`animate-spin rounded-full h-8 w-8 border-b-2 ${
                    darkMode ? "border-white" : "border-gray-900"
                  }`}
                ></div>
              )}

              {!currentTabState.isLoading && currentTabState.hasMore && (
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">
                    More Content Available
                  </h3>
                  <button
                    onClick={() => fetchPostsForTab(activeTab, { isLoadMore: true })}
                    className={`px-6 py-2 text-sm rounded-md ${
                      darkMode
                        ? "bg-[#1C2128] text-blue-400 hover:bg-[#22272E]"
                        : "bg-gray-100 text-blue-500 hover:bg-gray-200"
                    }`}
                  >
                    Load More
                  </button>
                </div>
              )}

              {!currentTabState.hasMore && postsToRender.length > 0 && (
                <div
                  className={`text-center ${
                    darkMode ? "text-gray-400" : "text-gray-600"
                  }`}
                >
                  No more posts to load
                </div>
              )}

              {currentTabState.error && postsToRender.length > 0 && (
                <div
                  className={`text-center text-sm ${
                    darkMode ? "text-red-400" : "text-red-600"
                  }`}
                >
                  {currentTabState.error}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

export default HomePage;
