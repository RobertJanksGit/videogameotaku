import { createContext, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
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
    case "username/already-exists":
      return "This username is already taken";
    default:
      return error.message;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check if username is already taken
  async function isUsernameTaken(username, excludeUserId = null) {
    const q = query(collection(db, "users"), where("name", "==", username));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return false;

    // If we're checking for an existing user (e.g., during profile update),
    // we need to exclude their current username from the check
    if (excludeUserId) {
      const docs = querySnapshot.docs.filter((doc) => doc.id !== excludeUserId);
      return docs.length > 0;
    }

    return true;
  }

  // Sign up function
  async function signup(email, password, displayName) {
    try {
      // Check if username is taken
      const usernameTaken = await isUsernameTaken(displayName);
      if (usernameTaken) {
        throw { code: "username/already-exists" };
      }

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
      const userData = {
        uid: newUser.uid,
        email: newUser.email,
        name: displayName,
        photoURL: newUser.photoURL || "",
        role: "user",
        isActive: true,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      };

      await setDoc(userRef, userData);

      // Return the user with Firestore data
      return { ...newUser, ...userData };
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

      // Get user data from Firestore
      const userRef = doc(db, "users", currentUser.uid);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();

      // Update last login time
      await setDoc(
        userRef,
        {
          lastLogin: serverTimestamp(),
        },
        { merge: true }
      );

      // Return the user with Firestore data
      return { ...currentUser, ...userData };
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
        try {
          // Get user data from Firestore
          const userRef = doc(db, "users", currentUser.uid);
          const userDoc = await getDoc(userRef);
          const userData = userDoc.data();

          // Update last login time
          await setDoc(
            userRef,
            {
              lastLogin: serverTimestamp(),
            },
            { merge: true }
          );

          // Set user with combined Auth and Firestore data
          setUser({ ...currentUser, ...userData });
        } catch (error) {
          console.error("Error fetching user data:", error);
          setUser(currentUser);
        }
      } else {
        setUser(null);
      }
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
    isUsernameTaken,
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
