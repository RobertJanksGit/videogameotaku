import { getFunctions, httpsCallable } from "firebase/functions";
import ensureSignedIn from "../auth/ensureSignedIn";

const functions = getFunctions(undefined, "us-central1");
const toggleLikeCallable = httpsCallable(functions, "toggleCommentLike");

const buildPayload = ({ commentPath, postId, commentId }) => {
  const payload = {};
  if (commentPath) {
    payload.commentPath = commentPath.replace(/^\/+/, "");
  }
  if (postId) {
    payload.postId = postId;
  }
  if (commentId) {
    payload.commentId = commentId;
  }
  return payload;
};

export const toggleCommentLikeByPath = async ({
  commentPath,
  postId,
  commentId,
}) => {
  await ensureSignedIn();
  const response = await toggleLikeCallable(
    buildPayload({ commentPath, postId, commentId })
  );
  return response?.data || {};
};

export default toggleCommentLikeByPath;
