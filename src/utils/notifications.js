import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../config/firebase";

export const createNotification = async ({
  recipientId,
  senderId,
  senderName,
  message,
  type,
  link,
  postId,
  commentId,
}) => {
  try {
    const notificationData = {
      recipientId,
      senderId,
      senderName,
      message,
      type,
      link,
      postId,
      commentId,
      read: false,
      createdAt: serverTimestamp(),
    };

    await addDoc(collection(db, "notifications"), notificationData);
  } catch (error) {
    console.error("Error creating notification:", error);
  }
};

export const getNotificationMessage = ({ type, senderName, postTitle }) => {
  switch (type) {
    case "post_comment":
      return `${senderName} commented on your post "${postTitle}"`;
    case "comment_reply":
      return `${senderName} replied to your comment`;
    default:
      return "";
  }
};
