import { getAuth, signInAnonymously } from "firebase/auth";

export const ensureSignedIn = async () => {
  const auth = getAuth();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser;
};

export default ensureSignedIn;
