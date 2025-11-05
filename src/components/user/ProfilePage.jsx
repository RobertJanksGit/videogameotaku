import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../config/firebase";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import SEO from "../common/SEO";
import OptimizedImage from "../common/OptimizedImage";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";
import VoteButtons from "../posts/VoteButtons";
import formatTimeAgo, { getTimestampDate } from "../../utils/formatTimeAgo";
import getRankFromKarma from "../../utils/karma";
import CommunityActivityWidget from "../activity/CommunityActivityWidget";

const PROFILE_POST_LIMIT = 25;

const getPreviewContent = (content = "") => {
  let cleanContent = content.replace(/\[img:[^\]]+\]/g, "");

  cleanContent = cleanContent
    .replace(/#{1,6}\s/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .trim();

  if (cleanContent.length > 200) {
    return `${cleanContent.substring(0, 200)}...`;
  }

  return cleanContent;
};

const ProfilePage = () => {
  const { userId } = useParams();
  const { darkMode } = useTheme();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [userData, setUserData] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ totalPosts: 0, totalUpvotes: 0 });

  const isOwnProfile = currentUser?.uid === userId;

  useEffect(() => {
    let isSubscribed = true;

    const loadProfile = async () => {
      if (!userId) {
        setError("Profile not found");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const profileRef = doc(db, "profiles", userId);
        const userRef = doc(db, "users", userId);

        const userSnap = await getDoc(userRef);
        const userDocData = userSnap.exists() ? userSnap.data() : null;

        let profileData = null;
        let fallbackProfile = null;

        try {
          const profileSnap = await getDoc(profileRef);
          if (profileSnap.exists()) {
            const data = profileSnap.data() || {};
            profileData = {
              ...data,
              karma: Number.isFinite(data.karma) ? data.karma : 0,
            };
          }
        } catch (profileError) {
          if (profileError.code === "permission-denied") {
            console.warn("Profile read denied, falling back to user document.");
          } else {
            throw profileError;
          }
        }

        if (!profileData && userDocData) {
          const fallbackName =
            userDocData.name ||
            userDocData.displayName ||
            userDocData.email?.split("@")[0] ||
            "Community Member";
          fallbackProfile = {
            displayName: fallbackName,
            avatarUrl: userDocData.photoURL || "",
            bio: userDocData.bio || "",
            createdAt: userDocData.createdAt || null,
            karma: Number.isFinite(userDocData.karma) ? userDocData.karma : 0,
          };
        }

        const resolvedProfile = profileData || fallbackProfile;

      if (!resolvedProfile) {
          throw new Error("profile/not-found");
        }

        if (isSubscribed) {
          setProfile(resolvedProfile);
          setUserData(userDocData);
        }
      } catch (err) {
        console.error("Error loading profile:", err);
        if (isSubscribed) {
          setError(
            err.message === "profile/not-found"
              ? "We couldn't find that profile."
              : "Failed to load profile. Please try again later."
          );
          setProfile(null);
          setUserData(null);
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      isSubscribed = false;
    };
  }, [userId]);

  const computeUpvotes = useCallback((post) => {
    if (typeof post.upvoteCount === "number") {
      return post.upvoteCount;
    }

    if (Array.isArray(post.usersThatLiked)) {
      return post.usersThatLiked.length;
    }

    if (typeof post.totalVotes === "number") {
      return Math.max(post.totalVotes, 0);
    }

    return 0;
  }, []);

  useEffect(() => {
    let isSubscribed = true;

    const loadPosts = async () => {
      if (!userId) {
        if (isSubscribed) {
          setPosts([]);
          setStats({ totalPosts: 0, totalUpvotes: 0 });
          setPostsLoading(false);
        }
        return;
      }

      if (isSubscribed) {
        setPostsLoading(true);
      }

      try {
        const baseQuery = query(
          collection(db, "posts"),
          where("authorId", "==", userId)
        );
        const snapshot = await getDocs(baseQuery);

        const fetchedPosts = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

        const publishedPosts = fetchedPosts
          .filter((post) => (post?.status ?? "published") === "published")
          .sort((a, b) => {
            const dateA = getTimestampDate(a.createdAt)?.getTime() || 0;
            const dateB = getTimestampDate(b.createdAt)?.getTime() || 0;
            return dateB - dateA;
          });

        if (!isSubscribed) {
          return;
        }

        const recentPosts = publishedPosts.slice(0, PROFILE_POST_LIMIT);
        setPosts(recentPosts);

        const totalPosts = publishedPosts.length;
        const totalUpvotes = publishedPosts.reduce(
          (total, post) => total + computeUpvotes(post),
          0
        );

        setStats({ totalPosts, totalUpvotes });
      } catch (err) {
        console.error("Error loading posts for profile:", err);
        if (isSubscribed) {
          setError((prev) => prev || "Failed to load posts.");
        }
      } finally {
        if (isSubscribed) {
          setPostsLoading(false);
        }
      }
    };

    loadPosts();

    return () => {
      isSubscribed = false;
    };
  }, [userId, computeUpvotes]);

  const profileInitials = useMemo(() => {
    const name = profile?.displayName?.trim();
    if (!name) return "??";
    const parts = name.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [profile?.displayName]);

  const joinDate = useMemo(
    () => getTimestampDate(userData?.createdAt),
    [userData?.createdAt]
  );

  const joinDateLabel = joinDate
    ? joinDate.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const handlePostClick = (postId) => {
    navigate(`/post/${postId}`);
  };

  const handleVoteChange = (updatedPost) => {
    setPosts((prev) => {
      const nextPosts = prev
        .map((post) => (post.id === updatedPost.id ? { ...post, ...updatedPost } : post))
        .sort((a, b) => {
          const dateA = getTimestampDate(a.createdAt)?.getTime() || 0;
          const dateB = getTimestampDate(b.createdAt)?.getTime() || 0;
          return dateB - dateA;
        });

      const previousPost = prev.find((post) => post.id === updatedPost.id);
      const previousUpvotes = previousPost ? computeUpvotes(previousPost) : 0;
      const nextUpvotes = computeUpvotes(updatedPost);
      const upvoteDelta = nextUpvotes - previousUpvotes;

      if (upvoteDelta !== 0) {
        setStats((statsState) => ({
          totalPosts: statsState.totalPosts,
          totalUpvotes: Math.max(0, statsState.totalUpvotes + upvoteDelta),
        }));

        setProfile((prevProfile) => {
          if (!prevProfile) {
            return prevProfile;
          }

          const currentKarma = Number.isFinite(prevProfile.karma)
            ? prevProfile.karma
            : 0;

          return {
            ...prevProfile,
            karma: Math.max(0, currentKarma + upvoteDelta),
          };
        });

        setUserData((prevUserData) => {
          if (!prevUserData) {
            return prevUserData;
          }

          const currentKarma = Number.isFinite(prevUserData.karma)
            ? prevUserData.karma
            : 0;

          return {
            ...prevUserData,
            karma: Math.max(0, currentKarma + upvoteDelta),
          };
        });
      }

      return nextPosts;
    });
  };

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-16" role="main">
        <p className={`text-center ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
          Loading profile...
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16" role="main">
        <div
          className={`rounded-lg border p-8 text-center shadow-sm ${
            darkMode ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"
          }`}
        >
          <h1
            className={`text-2xl font-semibold mb-4 ${
              darkMode ? "text-white" : "text-gray-900"
            }`}
          >
            Profile Unavailable
          </h1>
          <p className={`mb-6 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>{error}</p>
          <Link
            to="/"
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
              darkMode
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            Return Home
          </Link>
        </div>
      </main>
    );
  }

  const avatarSource = profile?.avatarUrl || userData?.photoURL || "";
  const normalizedAvatar = normalizeProfilePhoto(avatarSource, 224);
  const normalizedAvatar2x = normalizedAvatar
    ? normalizeProfilePhoto(avatarSource, 448)
    : "";
  const avatarSrcSet =
    normalizedAvatar &&
    normalizedAvatar2x &&
    normalizedAvatar2x !== normalizedAvatar
      ? `${normalizedAvatar2x} 2x`
      : undefined;

  const seoTitle = profile?.displayName
    ? `${profile.displayName}'s Profile`
    : "User Profile";
  const seoDescription = profile?.bio
    ? profile.bio
    : `${profile?.displayName || "Community member"} on Video Game Otaku.`;

  const karma = Number.isFinite(profile?.karma)
    ? profile.karma
    : Number.isFinite(userData?.karma)
    ? userData.karma
    : 0;
  const rank = getRankFromKarma(karma);
  const activityTitle = profile?.displayName
    ? `${profile.displayName}'s Activity`
    : "Community Activity";

  return (
    <>
      <SEO
        title={seoTitle}
        description={seoDescription}
        image={normalizedAvatar}
        url={`/user/${userId}`}
        type="profile"
      />

      <main className="mx-auto px-4 py-10 space-y-8 max-w-4xl md:max-w-6xl" role="main">
        <section
          className={`rounded-2xl border shadow-lg p-8 ${
            darkMode ? "border-gray-700 bg-gray-900/60" : "border-gray-200 bg-white"
          }`}
        >
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
            <div className="relative">
            {normalizedAvatar ? (
                <img
                  src={normalizedAvatar}
                  srcSet={avatarSrcSet}
                  alt={profile.displayName}
                  className="h-24 w-24 md:h-28 md:w-28 rounded-full object-cover ring-4 ring-blue-500/40"
                />
              ) : (
                <div
                  className={`h-24 w-24 md:h-28 md:w-28 rounded-full flex items-center justify-center text-3xl font-semibold ring-4 ring-blue-500/40 ${
                    darkMode ? "bg-gray-800 text-gray-200" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {profileInitials}
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className={`text-3xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
                    {profile?.displayName}
                  </h1>
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-slate-700/70 px-2 py-0.5 text-xs font-medium text-white"
                    title="Rank based on total upvotes across posts"
                  >
                    <span aria-hidden="true">{rank.emoji}</span>
                    <span>{rank.label}</span>
                  </span>
                </div>
                {joinDateLabel && (
                  <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                    Joined {joinDateLabel}
                  </p>
                )}
                <p
                  className={`text-sm font-medium ${
                    darkMode ? "text-gray-300" : "text-gray-700"
                  }`}
                >
                  XP: {karma} • Rank: {rank.label}
                </p>
              </div>

              {profile?.bio && (
                <p className={`text-base ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  {profile.bio}
                </p>
              )}

              <div className="flex flex-wrap gap-4">
                <div
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    darkMode ? "bg-gray-800 text-gray-200" : "bg-gray-100 text-gray-700"
                  }`}
                >
                  <span className="block text-xs uppercase tracking-wide text-gray-500">
                    Posts
                  </span>
                  <span className="text-xl font-semibold">{stats.totalPosts}</span>
                </div>
                <div
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    darkMode ? "bg-gray-800 text-gray-200" : "bg-gray-100 text-gray-700"
                  }`}
                >
                  <span className="block text-xs uppercase tracking-wide text-gray-500">
                    Total Upvotes
                  </span>
                  <span className="text-xl font-semibold">{stats.totalUpvotes}</span>
                </div>
              </div>

              {isOwnProfile && (
                <Link
                  to="/settings"
                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
                    darkMode
                      ? "bg-blue-600 text-white hover:bg-blue-500"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  Edit Profile
                </Link>
              )}
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-8 md:flex-row md:items-start">
          <section className="w-full space-y-6 md:flex-1">
            <header className="flex items-center justify-between">
              <h2 className={`text-2xl font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
                Recent Posts
              </h2>
              {posts.length > 0 && !postsLoading && (
                <span className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                  Showing {Math.min(posts.length, PROFILE_POST_LIMIT)} most recent posts
                </span>
              )}
            </header>

            {postsLoading ? (
              <div className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                Loading posts...
              </div>
            ) : posts.length === 0 ? (
              <div
                className={`rounded-xl border p-8 text-center ${
                  darkMode ? "border-gray-700 bg-gray-900/50" : "border-gray-200 bg-white"
                }`}
              >
                <p className={darkMode ? "text-gray-300" : "text-gray-600"}>
                  This user hasn&apos;t posted anything yet.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {posts.map((post) => {
                  const publishedAt = getTimestampDate(post.createdAt);
                  const relativeTime = publishedAt ? formatTimeAgo(publishedAt) : null;
                  const preview = getPreviewContent(post.content || "");

                  return (
                    <article
                      key={post.id}
                      onClick={() => handlePostClick(post.id)}
                      className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border shadow-md transition-transform hover:scale-[1.01] ${
                        darkMode ? "border-gray-700 bg-gray-900/70" : "border-gray-200 bg-white"
                      }`}
                    >
                      <div
                        className={`flex items-center justify-between px-5 py-4 border-b ${
                          darkMode ? "border-gray-700 bg-gray-900/40" : "border-gray-100 bg-gray-50"
                        }`}
                      >
                        <div className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                          {relativeTime ? `Published ${relativeTime}` : "Published"}
                        </div>
                        {publishedAt && (
                          <time
                            dateTime={publishedAt.toISOString()}
                            className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-500"}`}
                          >
                            {publishedAt.toLocaleDateString()}
                          </time>
                        )}
                      </div>

                      {post.imageUrl && (
                        <div className="w-full overflow-hidden">
                          <OptimizedImage
                            src={post.imageUrl}
                            alt={post.title}
                            className="w-full h-full max-h-72 object-cover"
                            sizes="(min-width: 1024px) 896px, 100vw"
                            loading="lazy"
                            objectFit="cover"
                          />
                        </div>
                      )}

                      <div className="flex flex-1 flex-col gap-4 p-6">
                        <div className="flex flex-wrap items-center gap-2">
                          {(Array.isArray(post.platforms)
                            ? post.platforms
                            : post.platform
                            ? [post.platform]
                            : []
                          ).map((platform) => (
                            <span
                              key={platform}
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                darkMode
                                  ? "bg-gray-800 text-gray-300"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {platform}
                            </span>
                          ))}
                          {post.category && (
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                darkMode
                                  ? "bg-blue-500/20 text-blue-300"
                                  : "bg-blue-50 text-blue-600"
                              }`}
                            >
                              {post.category}
                            </span>
                          )}
                        </div>

                        <h3
                          className={`text-2xl font-semibold leading-tight ${
                            darkMode ? "text-white" : "text-gray-900"
                          }`}
                        >
                          {post.title}
                        </h3>
                        {preview && (
                          <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                            {preview}
                          </p>
                        )}

                        <div className="mt-auto flex items-center justify-between border-t pt-4">
                          <div className={`flex items-center gap-2 text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
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
                          <div onClick={(event) => event.stopPropagation()}>
                            <VoteButtons
                              post={post}
                              darkMode={darkMode}
                              onVoteChange={handleVoteChange}
                            />
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="hidden md:block md:w-[320px] lg:w-[360px] md:sticky md:top-24 md:h-[calc(100vh-6rem)] md:max-h-[calc(100vh-6rem)] md:pb-6">
            <CommunityActivityWidget className="h-full" userId={userId} title={activityTitle} />
          </aside>
        </div>
      </main>
    </>
  );
};

export default ProfilePage;

