import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import { useTheme } from "../../contexts/ThemeContext";
import formatTimeAgo, { getTimestampDate } from "../../utils/formatTimeAgo";

const MAX_ITEMS = 10;
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

const useMediaQuery = (queryString) => {
  const getMatches = () => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return false;
    }
    return window.matchMedia(queryString).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const mediaQueryList = window.matchMedia(queryString);
    const listener = (event) => setMatches(event.matches);

    // Set initial value in case it changed since the first render
    setMatches(mediaQueryList.matches);

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", listener);

      return () => {
        mediaQueryList.removeEventListener("change", listener);
      };
    }

    mediaQueryList.addListener(listener);

    return () => {
      mediaQueryList.removeListener(listener);
    };
  }, [queryString]);

  return matches;
};

const buildActivityLabel = ({ type, authorName, postTitle }) => {
  const safeAuthor = authorName?.trim() || "Community Member";
  const formattedAuthor = `@${safeAuthor.replace(/\s+/g, "")}`;
  const safeTitle = postTitle?.trim() || "a post";

  if (type === "post") {
    return `${formattedAuthor} posted "${safeTitle}"`;
  }

  if (type === "comment") {
    return `${formattedAuthor} commented on "${safeTitle}"`;
  }

  return `${formattedAuthor} contributed to "${safeTitle}"`;
};

const CommunityActivityWidget = ({ className = "", userId = null }) => {
  const { darkMode } = useTheme();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [activityItems, setActivityItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isDesktop) {
      setActivityItems([]);
      return;
    }

    let isCancelled = false;

    const fetchActivity = async () => {
      setIsLoading(true);
      setError(null);
      setActivityItems([]);

      try {
        const postsCollection = collection(db, "posts");
        const commentsCollection = collection(db, "comments");

        const postsQuery = userId
          ? query(
              postsCollection,
              where("authorId", "==", userId),
              orderBy("createdAt", "desc"),
              limit(MAX_ITEMS)
            )
          : query(postsCollection, orderBy("createdAt", "desc"), limit(MAX_ITEMS));

        const commentsQuery = userId
          ? query(
              commentsCollection,
              where("authorId", "==", userId),
              orderBy("createdAt", "desc"),
              limit(MAX_ITEMS)
            )
          : query(commentsCollection, orderBy("createdAt", "desc"), limit(MAX_ITEMS));

        const [postsSnapshot, commentsSnapshot] = await Promise.all([
          getDocs(postsQuery),
          getDocs(commentsQuery),
        ]);

        const postActivities = postsSnapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data();
            if (data.status && data.status !== "published") {
              return null;
            }

            return {
              id: docSnapshot.id,
              type: "post",
              authorName: data.authorName,
              postTitle: data.title,
              postId: docSnapshot.id,
              createdAt: data.createdAt || null,
            };
          })
          .filter(Boolean);

        const postTitleCache = new Map();
        const resolvePostTitle = async (postId) => {
          if (!postId) {
            return null;
          }

          if (postTitleCache.has(postId)) {
            return postTitleCache.get(postId);
          }

          const postDoc = await getDoc(doc(db, "posts", postId));
          const title = postDoc.exists() ? postDoc.data().title : null;
          postTitleCache.set(postId, title);
          return title;
        };

        const commentActivities = await Promise.all(
          commentsSnapshot.docs.map(async (docSnapshot) => {
            const data = docSnapshot.data();
            const postTitle = data.postTitle || (await resolvePostTitle(data.postId));

            return {
              id: docSnapshot.id,
              type: "comment",
              authorName: data.authorName,
              postTitle,
              postId: data.postId,
              commentId: docSnapshot.id,
              createdAt: data.createdAt || null,
            };
          })
        );

        const merged = [...postActivities, ...commentActivities]
          .filter((item) => item.createdAt)
          .sort((a, b) => {
            const aDate = getTimestampDate(a.createdAt);
            const bDate = getTimestampDate(b.createdAt);
            const aTime = aDate ? aDate.getTime() : 0;
            const bTime = bDate ? bDate.getTime() : 0;
            return bTime - aTime;
          })
          .slice(0, MAX_ITEMS);

        if (!isCancelled) {
          setActivityItems(merged);
        }
      } catch (activityError) {
        console.error("Failed to load community activity:", activityError);
        if (!isCancelled) {
          setError("Unable to load community activity right now.");
          setActivityItems([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchActivity();

    return () => {
      isCancelled = true;
    };
  }, [isDesktop, userId]);

  const displayItems = useMemo(
    () =>
      activityItems.map((item) => {
        const createdAtDate = getTimestampDate(item.createdAt);
        let linkTarget = null;
        if (item.type === "post" && item.postId) {
          linkTarget = { pathname: `/post/${item.postId}` };
        }

        if (item.type === "comment" && item.postId) {
          linkTarget = {
            pathname: `/post/${item.postId}`,
            hash: item.commentId ? `#comment-${item.commentId}` : undefined,
            state: item.commentId
              ? { targetCommentId: item.commentId }
              : undefined,
          };
        }

        return {
          ...item,
          label: buildActivityLabel(item),
          createdAtDate,
          relativeTime: createdAtDate ? formatTimeAgo(createdAtDate) : "",
          linkTarget,
        };
      }),
    [activityItems]
  );

  if (!isDesktop) {
    return null;
  }

  return (
    <div
      className={`flex h-full flex-col rounded-2xl border shadow-sm transition-colors ${
        darkMode
          ? "border-gray-800 bg-gray-900/70"
          : "border-gray-200 bg-white"
      } ${className}`}
    >
      <div
        className={`border-b px-5 py-4 text-lg font-semibold ${
          darkMode ? "border-gray-800 text-white" : "border-gray-200 text-gray-900"
        }`}
      >
        Community Activity
      </div>
      <div className="activity-scroll flex-1 overflow-y-auto px-5 py-4 pr-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400">
            Loading activity...
          </div>
        ) : error ? (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        ) : displayItems.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No recent activity yet. Check back soon!
          </div>
        ) : (
          <ul className="space-y-4">
            {displayItems.map((item) => (
              <li key={`${item.type}-${item.id}`}>
                {item.linkTarget ? (
                  <Link
                    to={item.linkTarget}
                    className={`flex items-start gap-3 rounded-xl p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      darkMode
                        ? "focus-visible:ring-offset-gray-900 hover:bg-gray-800/70"
                        : "focus-visible:ring-offset-white hover:bg-gray-100/80"
                    }`}
                  >
                    <span
                      className={`mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        item.type === "post"
                          ? darkMode
                            ? "bg-blue-900 text-blue-200"
                            : "bg-blue-100 text-blue-600"
                          : darkMode
                          ? "bg-purple-900 text-purple-200"
                          : "bg-purple-100 text-purple-600"
                      }`}
                      aria-hidden="true"
                    >
                      {item.type === "post" ? "📝" : "💬"}
                    </span>
                    <div className="flex-1 space-y-1">
                      <p
                        className={`text-sm leading-snug ${
                          darkMode ? "text-gray-200" : "text-gray-800"
                        }`}
                      >
                        {item.label}
                      </p>
                      {item.createdAtDate && (
                        <time
                          dateTime={item.createdAtDate.toISOString()}
                          className={`text-xs ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                          }`}
                        >
                          {item.relativeTime || "just now"}
                        </time>
                      )}
                    </div>
                  </Link>
                ) : (
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        item.type === "post"
                          ? darkMode
                            ? "bg-blue-900 text-blue-200"
                            : "bg-blue-100 text-blue-600"
                          : darkMode
                          ? "bg-purple-900 text-purple-200"
                          : "bg-purple-100 text-purple-600"
                      }`}
                      aria-hidden="true"
                    >
                      {item.type === "post" ? "📝" : "💬"}
                    </span>
                    <div className="flex-1 space-y-1">
                      <p
                        className={`text-sm leading-snug ${
                          darkMode ? "text-gray-200" : "text-gray-800"
                        }`}
                      >
                        {item.label}
                      </p>
                      {item.createdAtDate && (
                        <time
                          dateTime={item.createdAtDate.toISOString()}
                          className={`text-xs ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                          }`}
                        >
                          {item.relativeTime || "just now"}
                        </time>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default CommunityActivityWidget;


