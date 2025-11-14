import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export const normalizeHandle = (handle) =>
  (handle || "").trim().toLowerCase().replace(/[^a-z0-9_-]/gi, "");

export const ensureHandleRecord = async (
  db,
  { userId, handle, displayName = "", avatarUrl = "" }
) => {
  if (!db) throw new Error("ensureHandleRecord: db is required");
  if (!userId) throw new Error("ensureHandleRecord: userId is required");
  const normalized = normalizeHandle(handle);
  if (!normalized) {
    throw new Error("ensureHandleRecord: handle is required");
  }

  const ref = doc(db, "user_handles", normalized);
  await setDoc(
    ref,
    {
      userId,
      handle,
      handleLower: normalized,
      displayName: displayName || handle,
      avatarUrl: avatarUrl || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return normalized;
};

export const removeHandleRecord = async (db, handle) => {
  if (!db) throw new Error("removeHandleRecord: db is required");
  const normalized = normalizeHandle(handle);
  if (!normalized) {
    return;
  }
  await deleteDoc(doc(db, "user_handles", normalized));
};

export default {
  normalizeHandle,
  ensureHandleRecord,
  removeHandleRecord,
};
