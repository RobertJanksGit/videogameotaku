import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../config/firebase";

const buildNotificationsRef = (userId) =>
  collection(db, "notifications", userId, "items");

const useNotifications = (userId, options = {}) => {
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    setIsLoading(true);
    const notificationsQuery = query(
      buildNotificationsRef(userId),
      orderBy("createdAt", "desc"),
      limit(options.limit || 20)
    );

    const unsubscribe = onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setNotifications(items);
        setIsLoading(false);
      },
      (err) => {
        console.error("Notification listener failed", err);
        setError(err);
        setNotifications([]);
        setIsLoading(false);
      }
    );

    return unsubscribe;
  }, [userId, options.limit]);

  const markAsRead = async (notificationId) => {
    if (!userId || !notificationId) return;
    const ref = doc(db, "notifications", userId, "items", notificationId);
    await updateDoc(ref, { read: true });
  };

  const markAllAsRead = async () => {
    if (!userId || notifications.length === 0) {
      return;
    }
    const unread = notifications.filter((item) => !item.read);
    if (unread.length === 0) {
      return;
    }
    const batch = writeBatch(db);
    unread.forEach((item) => {
      const ref = doc(db, "notifications", userId, "items", item.id);
      batch.update(ref, { read: true });
    });
    await batch.commit();
  };

  return {
    notifications,
    isLoading,
    error,
    unreadCount: notifications.filter((item) => !item.read).length,
    markAsRead,
    markAllAsRead,
  };
};

export default useNotifications;
