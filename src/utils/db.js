import { db } from "../config/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export const createUserDocument = async (user, additionalData = {}) => {
  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const userData = {
    uid: user.uid,
    email: user.email,
    name: user.displayName || additionalData.name || "",
    photoURL: user.photoURL || "",
    role: "user",
    isActive: true,
    createdAt: serverTimestamp(),
    lastLogin: serverTimestamp(),
    ...additionalData,
  };

  try {
    await setDoc(userRef, userData, { merge: true });
    return userData;
  } catch (error) {
    console.error("Error creating user document:", error);
    throw error;
  }
};

export const updateUserLastLogin = async (uid) => {
  if (!uid) return;

  const userRef = doc(db, "users", uid);
  try {
    await setDoc(
      userRef,
      {
        lastLogin: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Error updating last login:", error);
  }
};
