import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../config/firebase";
import useAuthUser from "../auth/useAuthUser";

const isBrowser = typeof window !== "undefined";

const buildLikeDocRef = (documentPath, postId, commentId, uid) => {
  if (documentPath) {
    const segments = documentPath.split("/").filter(Boolean);
    return doc(db, ...segments, "likes", uid);
  }
  if (postId && commentId) {
    return doc(db, "posts", postId, "comments", commentId, "likes", uid);
  }
  return null;
};

const useCommentLikedByMe = ({ postId, commentId, documentPath } = {}) => {
  const user = useAuthUser();
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }

    if (!user) {
      setLiked(false);
      return undefined;
    }

    const likeDocRef = buildLikeDocRef(
      documentPath,
      postId,
      commentId,
      user.uid
    );

    if (!likeDocRef) {
      setLiked(false);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      likeDocRef,
      (snapshot) => setLiked(snapshot.exists()),
      () => setLiked(false)
    );

    return () => unsubscribe();
  }, [documentPath, postId, commentId, user?.uid]);

  return liked;
};

export default useCommentLikedByMe;
