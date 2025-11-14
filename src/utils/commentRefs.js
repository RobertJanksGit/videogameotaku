import { collection, doc } from "firebase/firestore";

/**
 * Resolve the canonical posts/{postId} document reference.
 * Throws if postId is missing to surface programming errors early.
 */
export const postDocRef = (db, postId) => {
  if (!db) throw new Error("postDocRef: Firestore db instance required");
  if (!postId) throw new Error("postDocRef: postId is required");
  return doc(db, "posts", postId);
};

export const postCommentsCollection = (db, postId) =>
  collection(postDocRef(db, postId), "comments");

export const postCommentDoc = (db, postId, commentId) => {
  if (!commentId) {
    throw new Error("postCommentDoc: commentId is required");
  }
  return doc(postDocRef(db, postId), "comments", commentId);
};

/**
 * Build a document reference from a persisted Firestore path, typically stored
 * on comment snapshots (e.g., for collection group queries).
 */
export const commentDocFromPath = (db, path) => {
  if (!db || !path) {
    throw new Error("commentDocFromPath: db and path are required");
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length % 2 !== 0) {
    throw new Error(`commentDocFromPath: invalid document path "${path}"`);
  }
  return doc(db, ...segments);
};

export default {
  postDocRef,
  postCommentsCollection,
  postCommentDoc,
  commentDocFromPath,
};
