import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../config/firebase";

export const createNotification = async ({
  recipientId,
  actorUserId,
  actorDisplayName,
  type,
  postId,
  commentId,
  postTitle,
}) => {
  try {
    if (!recipientId || !actorUserId || !type || !postId) {
      return;
    }

    const notificationsCollection = collection(
      db,
      "users",
      recipientId,
      "notifications"
    );

    const notificationData = {
      type,
      postId,
      actorUserId,
      createdAt: serverTimestamp(),
      isRead: false,
    };

    if (commentId) {
      notificationData.commentId = commentId;
    }

    if (postTitle) {
      notificationData.postTitle = postTitle;
    }

    if (actorDisplayName) {
      notificationData.actorDisplayName = actorDisplayName;
    }

    await addDoc(notificationsCollection, notificationData);
  } catch (error) {
    console.error("Error creating notification:", error);
  }
};

export const markNotificationsAsRead = async ({
  userId,
  notificationIds,
}) => {
  try {
    if (!userId || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return;
    }

    const batch = writeBatch(db);

    notificationIds.forEach((notificationId) => {
      const notificationRef = doc(
        db,
        "users",
        userId,
        "notifications",
        notificationId
      );
      batch.update(notificationRef, { isRead: true });
    });

    await batch.commit();
  } catch (error) {
    console.error("Error marking notifications as read:", error);
  }
};

export const getNotificationMessage = ({ type, postTitle }) => {
  switch (type) {
    case "post_comment":
      return postTitle
        ? `commented on your post "${postTitle}"`
        : "commented on your post";
    case "comment_reply":
      return postTitle
        ? `replied to your comment on "${postTitle}"`
        : "replied to your comment";
    case "mention":
      return postTitle
        ? `mentioned you in "${postTitle}"`
        : "mentioned you";
    default:
      return "";
  }
};
