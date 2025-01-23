import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../config/firebase";

export const updateContributionCount = async (userId) => {
  if (!userId) return;

  try {
    const today = new Date().toISOString().split("T")[0];
    const userRef = doc(db, "users", userId);

    // Get current contributions
    const userDoc = await getDoc(userRef);
    const userData = userDoc.data();
    const contributions = userData.contributions || {};

    // Increment today's count
    contributions[today] = (contributions[today] || 0) + 1;

    // Update user document
    await updateDoc(userRef, {
      contributions: contributions,
    });

    return contributions;
  } catch (error) {
    console.error("Error updating contribution count:", error);
    throw error;
  }
};
