import { createContext, useContext, useEffect, useState, useCallback } from "react";
import PropTypes from "prop-types";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  signInAnonymously as firebaseSignInAnonymously,
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
import signInWithGoogleHelper from "../auth/signInWithGoogle";
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
    case "auth/popup-closed-by-user":
      return "Sign-in was closed before finishing. Please try again.";
    case "auth/cancelled-popup-request":
      return "A sign-in is already in progress. Please complete it first.";
    case "auth/operation-not-allowed":
      return "This sign-in method is currently disabled. Please contact support.";
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

const buildAnonymousDisplayName = (uid) => {
  const fallback = `Guest${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;

  if (!uid) {
    return fallback;
  }

  const sanitized = uid.replace(/[^a-zA-Z0-9]/g, "");
  const suffix =
    sanitized.slice(-4).toUpperCase() ||
    Math.floor(Math.random() * 10000).toString().padStart(4, "0");

  return `Guest${suffix}`;
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

  const loadUserData = useCallback(
    async (authUser, { shouldUpdateLastLogin = false } = {}) => {
      if (!authUser) {
        return null;
      }

      try {
        const userRef = doc(db, "users", authUser.uid);
        let userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
          const defaultName = authUser.isAnonymous
            ? buildAnonymousDisplayName(authUser.uid)
            : getPreferredDisplayName(authUser);
          try {
            await setDoc(
              userRef,
              {
                uid: authUser.uid,
                email: authUser.email ?? null,
                name: defaultName,
                displayName: defaultName,
                photoURL: normalizeProfilePhoto(authUser.photoURL || ""),
                role: "user",
                isActive: true,
                createdAt: serverTimestamp(),
                lastLogin: serverTimestamp(),
                isAnonymous: authUser.isAnonymous ?? false,
              },
              { merge: true }
            );
          } catch (createError) {
            console.error("Error creating user document:", createError);
          }
          userDoc = await getDoc(userRef);
        } else if (shouldUpdateLastLogin) {
          await setDoc(
            userRef,
            {
              lastLogin: serverTimestamp(),
              isAnonymous: authUser.isAnonymous ?? false,
            },
            { merge: true }
          );
        } else if (
          authUser.isAnonymous !== undefined &&
          authUser.isAnonymous !== userDoc.data()?.isAnonymous
        ) {
          await setDoc(
            userRef,
            {
              isAnonymous: authUser.isAnonymous,
            },
            { merge: true }
          );
        }

        let userDataRaw = userDoc.data() || {};

        if (authUser.isAnonymous && !userDataRaw.name) {
          const generatedGuestName = buildAnonymousDisplayName(authUser.uid);
          try {
            await setDoc(
              userRef,
              {
                name: generatedGuestName,
                displayName: generatedGuestName,
              },
              { merge: true }
            );
          } catch (guestNameError) {
            console.warn("Unable to persist anonymous display name", guestNameError);
          }
          userDataRaw = {
            ...userDataRaw,
            name: generatedGuestName,
            displayName: generatedGuestName,
          };
        }

        const resolvedName =
          userDataRaw.name ||
          userDataRaw.displayName ||
          getPreferredDisplayName(authUser, userDataRaw);

        const resolvedDisplayName =
          userDataRaw.displayName || resolvedName;

        const userData = {
          ...userDataRaw,
          photoURL: normalizeProfilePhoto(
            userDataRaw.photoURL || authUser.photoURL || ""
          ),
          name: resolvedName,
          displayName: resolvedDisplayName,
          isAnonymous:
            authUser.isAnonymous ?? userDataRaw.isAnonymous ?? false,
        };

        const profile = await ensureProfileDocument(authUser, userData);

        return {
          ...authUser,
          ...userData,
          photoURL: normalizeProfilePhoto(authUser.photoURL || ""),
          profile,
        };
      } catch (error) {
        console.error("Error fetching user data:", error);
        return {
          ...authUser,
          photoURL: normalizeProfilePhoto(authUser.photoURL || ""),
        };
      }
    },
    [ensureProfileDocument]
  );

  const refreshUser = useCallback(async () => {
    const authUser = auth.currentUser;

    if (!authUser) {
      return null;
    }

    const updatedUser = await loadUserData(authUser);

    if (updatedUser) {
      setUser(updatedUser);
    }

    return updatedUser;
  }, [loadUserData]);

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
        const loadedUser = await loadUserData(currentUser, {
          shouldUpdateLastLogin: true,
        });

        setUser(loadedUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [loadUserData]);

  const signInWithGoogle = useCallback(async () => {
    try {
      const credential = await signInWithGoogleHelper();
      const authUser = credential?.user || auth.currentUser;

      if (!authUser) {
        return null;
      }

      const loadedUser = await loadUserData(authUser, {
        shouldUpdateLastLogin: true,
      });

      if (loadedUser) {
        setUser(loadedUser);
      }

      return loadedUser;
    } catch (error) {
      console.error("Google sign-in error:", error);
      throw new Error(formatAuthError(error));
    }
  }, [loadUserData]);

  const signInAnonymously = useCallback(async () => {
    try {
      const result = await firebaseSignInAnonymously(auth);
      const loadedUser = await loadUserData(result.user, {
        shouldUpdateLastLogin: true,
      });

      if (loadedUser) {
        setUser(loadedUser);
      }

      return loadedUser;
    } catch (error) {
      console.error("Anonymous sign-in error:", error);
      throw new Error(formatAuthError(error));
    }
  }, [loadUserData]);

  const value = {
    user,
    loading,
    signup,
    login,
    logout,
    isUsernameTaken,
    refreshUser,
    signInWithGoogle,
    signInAnonymously,
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
