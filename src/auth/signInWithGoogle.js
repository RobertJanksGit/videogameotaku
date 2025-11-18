import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { auth } from "../config/firebase";

const buildProvider = () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: "select_account",
  });
  return provider;
};

const shouldFallbackToRedirect = (error) => {
  if (!error || typeof error.code !== "string") {
    return false;
  }

  const code = error.code.toLowerCase();
  return (
    code.includes("popup-blocked") ||
    code.includes("popup-closed") ||
    code.includes("cancelled-popup-request")
  );
};

/**
 * Attempts to sign in with Google using Firebase Auth.
 * Prefers popup sign-in, with a redirect fallback when popups are blocked.
 *
 * @returns {Promise<import("firebase/auth").UserCredential>}
 */
const signInWithGoogle = async () => {
  const provider = buildProvider();

  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("[Auth] Google popup sign-in failed:", error);

    if (shouldFallbackToRedirect(error)) {
      try {
        await signInWithRedirect(auth, provider);
        // signInWithRedirect does not resolve with a credential here; Firebase handles the redirect.
        return null;
      } catch (redirectError) {
        console.error("[Auth] Google redirect sign-in failed:", redirectError);
        throw redirectError;
      }
    }

    throw error;
  }
};

export default signInWithGoogle;

