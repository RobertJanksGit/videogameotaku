import {
  collection,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
} from "firebase/firestore";

const DEFAULT_PAGE_SIZE = 10;
const TRENDING_LOOKBACK_HOURS = 48;
const RISING_LOOKBACK_HOURS = 24;
const RISING_MIN_VOTES = 1;
const DISCUSSIONS_MIN_COMMENTS = 1;

export const FEED_TAB_KEYS = Object.freeze({
  TRENDING: "trending",
  RISING: "rising",
  NEW: "new",
  DISCUSSIONS: "discussions",
});

export const FEED_TAB_CONFIG = {
  [FEED_TAB_KEYS.TRENDING]: {
    label: "Trending",
    pageSize: 20,
    lookbackHours: TRENDING_LOOKBACK_HOURS,
    sort: "trending",
  },
  [FEED_TAB_KEYS.RISING]: {
    label: "Rising",
    pageSize: 20,
    lookbackHours: RISING_LOOKBACK_HOURS,
    minVotes: RISING_MIN_VOTES,
    sort: "rising",
  },
  [FEED_TAB_KEYS.NEW]: {
    label: "New",
    pageSize: DEFAULT_PAGE_SIZE,
    sort: "new",
  },
  [FEED_TAB_KEYS.DISCUSSIONS]: {
    label: "Discussions",
    pageSize: 15,
    sort: "discussions",
    discussionFilter: true,
    minComments: DISCUSSIONS_MIN_COMMENTS,
  },
};

const SORT_COMPARATORS = {
  trending: (a, b) => {
    const voteDiff = (b.totalVotes || 0) - (a.totalVotes || 0);
    if (voteDiff !== 0) return voteDiff;
    return getCreatedAtMillis(b) - getCreatedAtMillis(a);
  },
  rising: (a, b) => {
    const voteDiff = (b.totalVotes || 0) - (a.totalVotes || 0);
    if (voteDiff !== 0) return voteDiff;
    return getCreatedAtMillis(b) - getCreatedAtMillis(a);
  },
  discussions: (a, b) => {
    const commentDiff = (b.commentCount || 0) - (a.commentCount || 0);
    if (commentDiff !== 0) return commentDiff;
    return getCreatedAtMillis(b) - getCreatedAtMillis(a);
  },
  new: (a, b) => getCreatedAtMillis(b) - getCreatedAtMillis(a),
};

const DISCUSSION_KEYWORDS = [
  "discussion",
  "discussions",
  "thread",
  "threads",
  "forum",
  "forums",
  "community",
];

/**
 * @param {object} options
 * @param {boolean} [options.includeDiscussions=true]
 * @returns {Array<{ key: string, label: string, disabled?: boolean }>}
 */
export const getFeedTabs = ({ includeDiscussions = true } = {}) => {
  const tabs = [
    {
      key: FEED_TAB_KEYS.TRENDING,
      label: FEED_TAB_CONFIG[FEED_TAB_KEYS.TRENDING].label,
    },
    {
      key: FEED_TAB_KEYS.RISING,
      label: FEED_TAB_CONFIG[FEED_TAB_KEYS.RISING].label,
    },
    {
      key: FEED_TAB_KEYS.NEW,
      label: FEED_TAB_CONFIG[FEED_TAB_KEYS.NEW].label,
    },
  ];

  if (includeDiscussions) {
    tabs.push({
      key: FEED_TAB_KEYS.DISCUSSIONS,
      label: FEED_TAB_CONFIG[FEED_TAB_KEYS.DISCUSSIONS].label,
    });
  }

  return tabs;
};

/**
 * Builds a Firestore query for the feed based on the active tab and filters.
 *
 * @param {object} params
 * @param {import("firebase/firestore").Firestore} params.db
 * @param {string} params.tabKey
 * @param {string} params.selectedCategory
 * @param {string} params.selectedPlatform
 * @param {import("firebase/firestore").QueryDocumentSnapshot | null} params.lastVisible
 */
export const buildFeedQuery = ({
  db,
  tabKey,
  selectedCategory,
  selectedPlatform,
  lastVisible,
}) => {
  const config = FEED_TAB_CONFIG[tabKey] || FEED_TAB_CONFIG[FEED_TAB_KEYS.NEW];
  const constraints = [where("status", "==", "published")];

  if (selectedCategory && selectedCategory !== "all") {
    constraints.push(where("category", "==", selectedCategory));
  }

  if (selectedPlatform && selectedPlatform !== "all") {
    constraints.push(where("platforms", "array-contains", selectedPlatform));
  }

  if (config.lookbackHours) {
    const now = Date.now();
    const lookbackMillis = now - config.lookbackHours * 60 * 60 * 1000;
    const lookbackDate = new Date(lookbackMillis);
    constraints.push(
      where("createdAt", ">=", Timestamp.fromDate(lookbackDate))
    );
  }

  constraints.push(orderBy("createdAt", "desc"));

  if (lastVisible) {
    constraints.push(startAfter(lastVisible));
  }

  const pageSize = config.pageSize || DEFAULT_PAGE_SIZE;
  constraints.push(limit(pageSize));

  return {
    queryRef: query(collection(db, "posts"), ...constraints),
    config,
  };
};

/**
 * Sorts and filters posts for a given feed tab.
 *
 * @param {string} tabKey
 * @param {Array<object>} posts
 * @returns {Array<object>}
 */
export const processPostsForTab = (tabKey, posts) => {
  const config = FEED_TAB_CONFIG[tabKey] || FEED_TAB_CONFIG[FEED_TAB_KEYS.NEW];
  const comparator = SORT_COMPARATORS[config.sort] || SORT_COMPARATORS.new;

  let workingPosts = Array.isArray(posts) ? [...posts] : [];

  if (typeof config.minComments === "number") {
    workingPosts = workingPosts.filter(
      (post) => getCommentCount(post) >= config.minComments
    );
  }

  if (config.discussionFilter) {
    workingPosts = workingPosts.filter((post) =>
      isDiscussionPost(post, config)
    );
  }

  if (typeof config.minVotes === "number") {
    workingPosts = workingPosts.filter(
      (post) =>
        typeof post?.totalVotes === "number" &&
        post.totalVotes >= config.minVotes
    );
  }

  return workingPosts.sort(comparator);
};

/**
 * Merges two lists of posts, removing duplicates and applying tab-specific processing.
 *
 * @param {string} tabKey
 * @param {Array<object>} existingPosts
 * @param {Array<object>} incomingPosts
 * @returns {Array<object>}
 */
export const mergePostsForTab = (tabKey, existingPosts, incomingPosts) => {
  const postMap = new Map();

  (existingPosts || []).forEach((post) => {
    if (post?.id) {
      postMap.set(post.id, post);
    }
  });

  (incomingPosts || []).forEach((post) => {
    if (post?.id) {
      postMap.set(post.id, post);
    }
  });

  return processPostsForTab(tabKey, Array.from(postMap.values()));
};

const getCreatedAtMillis = (post) => {
  const value = post?.createdAt;

  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
};

const isDiscussionPost = (post) => {
  const matchesKeyword = (value) => {
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    return DISCUSSION_KEYWORDS.some((keyword) => normalized.includes(keyword));
  };

  if (matchesKeyword(post?.category)) return true;
  if (matchesKeyword(post?.type)) return true;

  if (Array.isArray(post?.tags)) {
    return post.tags.some(matchesKeyword);
  }

  return getCommentCount(post) > 0;
};

const getCommentCount = (post) => {
  const count = post?.commentCount;
  if (typeof count === "number" && !Number.isNaN(count)) {
    return count;
  }

  if (typeof count === "string") {
    const parsed = Number(count);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};
