import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";

/**
 * Fetches additional posts from the same calendar day as the current post.
 *
 * - Only includes published posts.
 * - Excludes the current post.
 * - Prefers posts that share at least one platform, tag, or category.
 * - Sorted by newest first and limited to the requested size.
 *
 * @param {object} params
 * @param {import("firebase/firestore").Firestore} params.db
 * @param {object} params.currentPost
 * @param {number} [params.limitSize=4]
 * @returns {Promise<Array<object>>}
 */
export async function fetchMoreStoriesFromToday({
  db,
  currentPost,
  limitSize = 4,
}) {
  if (!db || !currentPost || !currentPost.createdAt) {
    return [];
  }

  const resolveCreatedAtDate = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    return new Date(value);
  };

  const createdAtDate = resolveCreatedAtDate(currentPost.createdAt);
  if (!createdAtDate || Number.isNaN(createdAtDate.getTime())) {
    return [];
  }

  // Calculate local calendar day bounds based on the post's date
  const startOfDay = new Date(
    createdAtDate.getFullYear(),
    createdAtDate.getMonth(),
    createdAtDate.getDate()
  );
  const endOfDay = new Date(
    createdAtDate.getFullYear(),
    createdAtDate.getMonth(),
    createdAtDate.getDate() + 1
  );

  const constraints = [
    where("status", "==", "published"),
    where("createdAt", ">=", Timestamp.fromDate(startOfDay)),
    where("createdAt", "<", Timestamp.fromDate(endOfDay)),
    orderBy("createdAt", "desc"),
    // Fetch a few extra so we can exclude the current post and prefer similar posts
    limit(limitSize * 3),
  ];

  const q = query(collection(db, "posts"), ...constraints);
  const snapshot = await getDocs(q);

  if (snapshot.empty) return [];

  const rawPosts = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  const currentId = currentPost.id;
  const currentCategory = (currentPost.category || "").toString().toLowerCase();
  const currentPlatforms = Array.isArray(currentPost.platforms)
    ? currentPost.platforms
    : currentPost.platform
    ? [currentPost.platform]
    : [];
  const currentTags = Array.isArray(currentPost.tags) ? currentPost.tags : [];

  const normalize = (value) =>
    value == null ? "" : value.toString().trim().toLowerCase();

  const platformSet = new Set(currentPlatforms.map(normalize));
  const tagSet = new Set(currentTags.map(normalize));

  const sharesCategory = (post) =>
    currentCategory &&
    normalize(post.category) &&
    normalize(post.category) === currentCategory;

  const sharesPlatform = (post) => {
    const platforms = Array.isArray(post.platforms)
      ? post.platforms
      : post.platform
      ? [post.platform]
      : [];
    return platforms
      .map(normalize)
      .some((platform) => platform && platformSet.has(platform));
  };

  const sharesTag = (post) => {
    const tags = Array.isArray(post.tags) ? post.tags : [];
    return tags
      .map(normalize)
      .some((tag) => tag && tagSet.has(tag));
  };

  const isSimilar = (post) =>
    sharesPlatform(post) || sharesTag(post) || sharesCategory(post);

  // Drop the current post and separate into similar vs. others
  const candidates = rawPosts.filter((post) => post.id !== currentId);

  if (!candidates.length) return [];

  const similar = [];
  const others = [];

  candidates.forEach((post) => {
    if (isSimilar(post)) {
      similar.push(post);
    } else {
      others.push(post);
    }
  });

  const combined = [...similar, ...others];
  return combined.slice(0, limitSize);
}


