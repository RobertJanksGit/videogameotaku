import { createContext, useContext, useEffect, useState, useCallback } from "react";
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
  Timestamp,
  collection,
  query,
  where,
  getDocs,
  limit,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";
import normalizeProfilePhoto from "../utils/normalizeProfilePhoto";

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

const getPreferredDisplayName = (authUser, userData = {}) => {
  if (userData?.name) return userData.name;
  if (authUser?.displayName) return authUser.displayName;
  const email = authUser?.email || userData?.email;
  if (email) {
    return email.split("@")[0];
  }
  return "Community Member";
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const ensureProfileDocument = useCallback(async (authUser, userData = {}) => {
    if (!authUser) {
      return null;
    }

    try {
      const profileRef = doc(db, "profiles", authUser.uid);
      const creationTimestamp = () => {
        if (userData?.createdAt) {
          return userData.createdAt;
        }

        if (authUser?.metadata?.creationTime) {
          try {
            const createdDate = new Date(authUser.metadata.creationTime);
            if (!Number.isNaN(createdDate.getTime())) {
              return Timestamp.fromDate(createdDate);
            }
          } catch (dateError) {
            console.warn("Unable to parse auth creation time", dateError);
          }
        }

        return Timestamp.now();
      };

      const fallbackProfile = () => ({
        displayName: getPreferredDisplayName(authUser, userData),
        avatarUrl: normalizeProfilePhoto(
          userData?.photoURL || authUser.photoURL || ""
        ),
        bio: userData?.bio || "",
        createdAt: creationTimestamp(),
        updatedAt: userData?.updatedAt || null,
        karma: Number.isFinite(userData?.karma) ? userData.karma : 0,
      });

      let profileSnap;

      try {
        profileSnap = await getDoc(profileRef);
      } catch (readError) {
        if (readError.code === "permission-denied") {
          console.warn("Profiles read permission denied; using fallback data.");
          return fallbackProfile();
        }
        throw readError;
      }

      if (profileSnap.exists()) {
        const data = profileSnap.data() || {};
        return {
          ...data,
          avatarUrl: normalizeProfilePhoto(
            data.avatarUrl || data.photoURL || userData?.photoURL || authUser.photoURL || ""
          ),
        };
      }

      const profilePayload = {
        displayName: getPreferredDisplayName(authUser, userData),
        avatarUrl: normalizeProfilePhoto(
          userData?.photoURL || authUser.photoURL || ""
        ),
        bio: "",
        createdAt: creationTimestamp(),
        updatedAt: serverTimestamp(),
        karma: 0,
      };

      try {
        await setDoc(profileRef, profilePayload);
      } catch (writeError) {
        if (writeError.code === "permission-denied") {
          console.warn("Profiles write permission denied; using fallback data.");
          return fallbackProfile();
        }
        throw writeError;
      }

      const createdProfileSnap = await getDoc(profileRef);
      if (createdProfileSnap.exists()) {
        const data = createdProfileSnap.data() || {};
        return {
          ...data,
          avatarUrl: normalizeProfilePhoto(
            data.avatarUrl || data.photoURL || profilePayload.avatarUrl
          ),
        };
      }
      return profilePayload;
    } catch (error) {
      console.error("Error ensuring profile document:", error);
      return null;
    }
  }, []);

  // Check if username is already taken
  async function isUsernameTaken(username, excludeUserId = null) {
    try {
      const q = query(
        collection(db, "users"),
        where("name", "==", username),
        limit(1)
      );

      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        return false;
      }

      // If we're checking for an existing user (e.g., during profile update),
      // we need to exclude their current username from the check
      if (excludeUserId) {
        const docs = querySnapshot.docs.filter(
          (doc) => doc.id !== excludeUserId
        );
        return docs.length > 0;
      }

      return true;
    } catch {
      // Instead of failing, assume username is available and let other validations catch issues
      return false;
    }
  }

  // Sign up function
  async function signup(email, password, displayName) {
    try {
      // Create the user in Firebase Auth first
      const { user: newUser } = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      // Update the user's display name
      await updateProfile(newUser, { displayName });

      // Check if username is taken after auth creation
      const usernameTaken = await isUsernameTaken(displayName);
      if (usernameTaken) {
        await newUser.delete();
        throw { code: "username/already-exists" };
      }

      // Create the user document in Firestore
      const userRef = doc(db, "users", newUser.uid);
      const userData = {
        uid: newUser.uid,
        email: newUser.email,
        name: displayName,
        photoURL: normalizeProfilePhoto(newUser.photoURL || ""),
        role: "user",
        isActive: true,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      };

      try {
        await setDoc(userRef, userData);
      } catch (firestoreError) {
        // If Firestore fails, we should delete the auth user to maintain consistency
        await newUser.delete();
        throw firestoreError;
      }

      const profile = await ensureProfileDocument(newUser, userData);

      // Return the user with Firestore data
      return {
        ...newUser,
        ...userData,
        photoURL: normalizeProfilePhoto(newUser.photoURL || ""),
        profile,
      };
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
      const userDataRaw = userDoc.data() || {};
      const userData = {
        ...userDataRaw,
        photoURL: normalizeProfilePhoto(
          userDataRaw.photoURL || currentUser.photoURL || ""
        ),
      };

      // Update last login time
      await setDoc(
        userRef,
        {
          lastLogin: serverTimestamp(),
        },
        { merge: true }
      );

      const profile = await ensureProfileDocument(currentUser, userData);

      // Return the user with Firestore data
      return {
        ...currentUser,
        ...userData,
        photoURL: normalizeProfilePhoto(currentUser.photoURL || ""),
        profile,
      };
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
          const userDataRaw = userDoc.data() || {};
          const userData = {
            ...userDataRaw,
            photoURL: normalizeProfilePhoto(
              userDataRaw.photoURL || currentUser.photoURL || ""
            ),
          };

          // Update last login time
          await setDoc(
            userRef,
            {
              lastLogin: serverTimestamp(),
            },
            { merge: true }
          );

          const profile = await ensureProfileDocument(currentUser, userData);

          // Set user with combined Auth and Firestore data
          setUser({
            ...currentUser,
            ...userData,
            photoURL: normalizeProfilePhoto(currentUser.photoURL || ""),
            profile,
          });
        } catch (error) {
          console.error("Error fetching user data:", error);
          setUser({
            ...currentUser,
            photoURL: normalizeProfilePhoto(currentUser.photoURL || ""),
          });
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [ensureProfileDocument]);

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
