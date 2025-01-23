import { createContext, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../config/firebase";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

const formatAuthError = (error) => {
  switch (error.code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists";
    case "auth/weak-password":
      return "Password should be at least 6 characters";
    case "auth/invalid-email":
      return "Invalid email address";
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Invalid email or password";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later";
    default:
      return error.message;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Sign up function
  async function signup(email, password, displayName) {
    try {
      // Create the user in Firebase Auth
      const { user: newUser } = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      // Update the user's display name
      await updateProfile(newUser, { displayName });

      // Create the user document in Firestore
      const userRef = doc(db, "users", newUser.uid);
      await setDoc(userRef, {
        uid: newUser.uid,
        email: newUser.email,
        name: displayName,
        photoURL: newUser.photoURL || "",
        role: "user",
        isActive: true,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      });

      return newUser;
    } catch (error) {
      throw new Error(formatAuthError(error));
    }
  }

  // Login function
  async function login(email, password) {
    try {
      const { user: currentUser } = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      // Update last login time
      const userRef = doc(db, "users", currentUser.uid);
      await setDoc(
        userRef,
        {
          lastLogin: serverTimestamp(),
        },
        { merge: true }
      );

      return currentUser;
    } catch (error) {
      throw new Error(formatAuthError(error));
    }
  }

  // Logout function
  async function logout() {
    try {
      await signOut(auth);
    } catch (error) {
      throw new Error(formatAuthError(error));
    }
  }

  // Subscribe to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Update last login time when user is authenticated
        const userRef = doc(db, "users", currentUser.uid);
        await setDoc(
          userRef,
          {
            lastLogin: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    user,
    loading,
    signup,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
