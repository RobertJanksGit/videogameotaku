import { getFunctions, httpsCallable } from "firebase/functions";
import ensureSignedIn from "../auth/ensureSignedIn";

const functions = getFunctions(undefined, "us-central1");
const toggleLikeCallable = httpsCallable(functions, "toggleCommentLike");

const sanitizeCommentPath = (commentPath) =>
  typeof commentPath === "string" ? commentPath.replace(/^\/+/, "") : "";

export const toggleCommentLikeByPath = async (commentPath) => {
  await ensureSignedIn();
  const sanitizedPath = sanitizeCommentPath(commentPath);
  if (!sanitizedPath) {
    throw new Error("commentPath is required to toggle comment likes.");
  }
  const response = await toggleLikeCallable({
    commentPath: sanitizedPath,
  });
  return response?.data || {};
};

export default toggleCommentLikeByPath;
