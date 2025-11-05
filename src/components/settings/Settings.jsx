import { useState, useRef, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { storage, db, auth } from "../../config/firebase";
import normalizeProfilePhoto from "../../utils/normalizeProfilePhoto";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, updateDoc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import ContributionGraph from "../activity/ContributionGraph";

const MIN_PROFILE_IMAGE_DIMENSION = 256;
const INVALID_FILE_MESSAGE = "Please select a valid image file (PNG, JPG, GIF) up to 5MB";

const loadImageDimensions = (file) =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { naturalWidth, naturalHeight } = img;
      URL.revokeObjectURL(objectUrl);
      resolve({ width: naturalWidth, height: naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };
    img.src = objectUrl;
  });

const Settings = () => {
  const { user, isUsernameTaken, refreshUser } = useAuth();
  const { darkMode } = useTheme();
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [contributions, setContributions] = useState({});
  const [notificationPrefs, setNotificationPrefs] = useState({
    postComments: true,
    commentReplies: true,
  });
  const [bio, setBio] = useState("");
  const [profileExists, setProfileExists] = useState(false);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const userAvatar = normalizeProfilePhoto(user?.photoURL || "", 224);
  const userAvatar2x = userAvatar
    ? normalizeProfilePhoto(user?.photoURL || "", 448)
    : "";
  const userAvatarSrcSet =
    userAvatar && userAvatar2x && userAvatar2x !== userAvatar
      ? `${userAvatar2x} 2x`
      : undefined;

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();
        setContributions(userData?.contributions || {});
        setNotificationPrefs({
          postComments: userData?.notificationPrefs?.postComments ?? true,
          commentReplies: userData?.notificationPrefs?.commentReplies ?? true,
        });

        const profileDoc = await getDoc(doc(db, "profiles", user.uid));
        if (profileDoc.exists()) {
          const profileData = profileDoc.data();
          setBio(profileData?.bio || "");
          setProfileExists(true);
        } else {
          setBio("");
          setProfileExists(false);
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      }
    };

    fetchUserData();
  }, [user]);

  const createImagePreview = (file) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const setImageSelectionError = (message) => {
    setSelectedImage(null);
    setImagePreview(null);
    setError(message);
  };

  const validateAndSetImage = async (file) => {
    if (!file) return;

    if (!isValidImageFile(file)) {
      setImageSelectionError(INVALID_FILE_MESSAGE);
      return;
    }

    try {
      const { width, height } = await loadImageDimensions(file);
      const shortestSide = Math.min(width, height);

      if (shortestSide < MIN_PROFILE_IMAGE_DIMENSION) {
        setImageSelectionError(
          `Profile image must be at least ${MIN_PROFILE_IMAGE_DIMENSION}px on the shortest side`
        );
        return;
      }

      setSelectedImage(file);
      createImagePreview(file);
      setError("");
    } catch (dimensionError) {
      console.error("Unable to read image dimensions:", dimensionError);
      setImageSelectionError("Unable to process image. Please try another file.");
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    await validateAndSetImage(file);
  };

  const isValidImageFile = (file) => {
    const validTypes = ["image/jpeg", "image/png", "image/gif"];
    const maxSize = 5 * 1024 * 1024; // 5MB
    return validTypes.includes(file.type) && file.size <= maxSize;
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.target === dropZoneRef.current) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    await validateAndSetImage(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Validate username format
      if (displayName.length < 3) {
        setError("Username must be at least 3 characters long");
        setLoading(false);
        return;
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(displayName)) {
        setError(
          "Username can only contain letters, numbers, underscores, and hyphens"
        );
        setLoading(false);
        return;
      }

      // Check if username is taken (excluding current user)
      if (displayName !== user.name) {
        const usernameTaken = await isUsernameTaken(displayName, user.uid);
        if (usernameTaken) {
          setError("This username is already taken");
          setLoading(false);
          return;
        }
      }

      let photoURL = normalizeProfilePhoto(user.photoURL || "");

      // Upload new profile image if selected
      if (selectedImage) {
        const imageRef = ref(
          storage,
          `profile-images/${user.uid}/${selectedImage.name}`
        );
        await uploadBytes(imageRef, selectedImage);
        photoURL = normalizeProfilePhoto(await getDownloadURL(imageRef));
      }

      // Update auth profile
      const currentUser = auth.currentUser;
      if (currentUser) {
        await updateProfile(currentUser, {
          displayName,
          photoURL,
        });
      }

      // Update Firestore document
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        name: displayName,
        photoURL,
        notificationPrefs,
      });

      const profileRef = doc(db, "profiles", user.uid);
      const profileData = {
        displayName,
        avatarUrl: photoURL || "",
        bio: bio.trim(),
        updatedAt: serverTimestamp(),
      };

      if (!profileExists) {
        profileData.createdAt = serverTimestamp();
        profileData.karma = 0;
      }

      await setDoc(profileRef, profileData, { merge: true });

      setProfileExists(true);

      const updatedUser = await (refreshUser?.() ?? Promise.resolve(null));
      if (updatedUser) {
        setDisplayName(updatedUser?.name || updatedUser?.displayName || "");
      }

      setSuccess("Profile updated successfully!");
      clearImage(); // Clear selected image after successful update
    } catch (err) {
      setError(err.message || "Failed to update profile. Please try again.");
      console.error("Error updating profile:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    setPasswordLoading(true);

    // Validate password requirements
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters long");
      setPasswordLoading(false);
      return;
    }

    if (!/[a-z]/.test(newPassword)) {
      setPasswordError(
        "New password must contain at least one lowercase letter"
      );
      setPasswordLoading(false);
      return;
    }

    if (!/[A-Z]/.test(newPassword)) {
      setPasswordError(
        "New password must contain at least one uppercase letter"
      );
      setPasswordLoading(false);
      return;
    }

    if (!/[0-9]/.test(newPassword)) {
      setPasswordError("New password must contain at least one number");
      setPasswordLoading(false);
      return;
    }

    if (!/[^a-zA-Z0-9]/.test(newPassword)) {
      setPasswordError(
        "New password must contain at least one special character"
      );
      setPasswordLoading(false);
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError("New passwords do not match");
      setPasswordLoading(false);
      return;
    }

    try {
      const currentUser = auth.currentUser;
      const credential = EmailAuthProvider.credential(
        currentUser.email,
        currentPassword
      );

      // Reauthenticate user before changing password
      await reauthenticateWithCredential(currentUser, credential);

      // Update password
      await updatePassword(currentUser, newPassword);

      setPasswordSuccess("Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      if (err.code === "auth/wrong-password") {
        setPasswordError("Current password is incorrect");
      } else {
        setPasswordError(
          err.message || "Failed to update password. Please try again."
        );
      }
      console.error("Error updating password:", err);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
        Settings
      </h1>

      <div className="space-y-6">
        <div
          className={`rounded-lg shadow p-6 ${
            darkMode ? "bg-[#2D333B]" : "bg-white border border-gray-200"
          }`}
        >
          <h2
            className={`text-lg font-semibold mb-4 ${
              darkMode ? "text-[#ADBAC7]" : "text-gray-900"
            }`}
          >
            Profile
          </h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && <div className="text-red-500 text-sm">{error}</div>}
            {success && <div className="text-green-500 text-sm">{success}</div>}

            <div className="space-y-2">
              <label
                htmlFor="displayName"
                className={`block text-sm font-medium ${
                  darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                }`}
              >
                Username
              </label>
              <input
                type="text"
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`w-full px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-[#316DCA] focus:border-transparent ${
                  darkMode
                    ? "bg-[#1C2128] border-[#373E47] text-[#ADBAC7]"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
                required
              />
            </div>

            <div className="space-y-4">
              <h3
                className={`text-sm font-medium ${
                  darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                }`}
              >
                Notification Preferences
              </h3>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={notificationPrefs.postComments}
                    onChange={(e) =>
                      setNotificationPrefs({
                        ...notificationPrefs,
                        postComments: e.target.checked,
                      })
                    }
                    className={`rounded border-gray-300 text-[#316DCA] focus:ring-[#316DCA] ${
                      darkMode ? "bg-[#1C2128] border-[#373E47]" : ""
                    }`}
                  />
                  <span
                    className={`ml-2 text-sm ${
                      darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                    }`}
                  >
                    Notify me when someone comments on my posts
                  </span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={notificationPrefs.commentReplies}
                    onChange={(e) =>
                      setNotificationPrefs({
                        ...notificationPrefs,
                        commentReplies: e.target.checked,
                      })
                    }
                    className={`rounded border-gray-300 text-[#316DCA] focus:ring-[#316DCA] ${
                      darkMode ? "bg-[#1C2128] border-[#373E47]" : ""
                    }`}
                  />
                  <span
                    className={`ml-2 text-sm ${
                      darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                    }`}
                  >
                    Notify me when someone replies to my comments
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="profileImage"
                className={`block text-sm font-medium ${
                  darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                }`}
              >
                Profile Image
              </label>
              <div
                ref={dropZoneRef}
                className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg transition-colors ${
                  isDragging
                    ? darkMode
                      ? "border-[#316DCA] bg-[#1C2128]"
                      : "border-blue-500 bg-blue-50"
                    : darkMode
                    ? "border-[#373E47] hover:border-[#316DCA]"
                    : "border-gray-300 hover:border-gray-400"
                }`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center space-y-4 mb-4">
                  {imagePreview ? (
                    <div className="relative group">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className={`w-24 h-24 md:w-32 md:h-32 rounded-full object-cover ring-4 ${
                          darkMode ? "ring-gray-700" : "ring-gray-100"
                        }`}
                      />
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-white text-sm">Change photo</span>
                      </div>
                    </div>
                  ) : user?.photoURL ? (
                    <div className="relative group">
                      <img
                        src={userAvatar}
                        srcSet={userAvatarSrcSet}
                        alt="Profile"
                        className={`w-24 h-24 md:w-32 md:h-32 rounded-full object-cover ring-4 ${
                          darkMode ? "ring-gray-700" : "ring-gray-100"
                        }`}
                      />
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-white text-sm">Change photo</span>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center ${
                        darkMode ? "bg-gray-700" : "bg-gray-200"
                      }`}
                    >
                      <svg
                        className={`w-16 h-16 ${
                          darkMode ? "text-gray-500" : "text-gray-400"
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.5"
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    </div>
                  )}
                  {selectedImage && (
                    <div className="flex items-center space-x-2 text-sm">
                      <span
                        className={darkMode ? "text-gray-400" : "text-gray-500"}
                      >
                        Selected: {selectedImage.name}
                      </span>
                      <button
                        type="button"
                        onClick={clearImage}
                        className="text-red-500 hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <input
                    type="file"
                    id="profileImage"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={`inline-flex items-center px-4 py-2 text-sm font-medium ${
                      darkMode
                        ? "text-[#316DCA] hover:text-[#2760AA]"
                        : "text-blue-600 hover:text-blue-700"
                    } focus:outline-none focus:underline`}
                  >
                    Choose a file
                  </button>
                  <p
                    className={`mt-2 text-sm ${
                      darkMode ? "text-gray-400" : "text-gray-500"
                    }`}
                  >
                    or drag and drop your image here
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      darkMode ? "text-gray-500" : "text-gray-400"
                    }`}
                  >
                    PNG, JPG, GIF up to 5MB
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="bio"
                className={`block text-sm font-medium ${
                  darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                }`}
              >
                Bio <span className="text-xs text-gray-500">(optional)</span>
              </label>
              <textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows="3"
                maxLength={280}
                placeholder="Share a short description about yourself"
                className={`w-full px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-[#316DCA] focus:border-transparent resize-none ${
                  darkMode
                    ? "bg-[#1C2128] border-[#373E47] text-[#ADBAC7]"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
              />
              <p
                className={`text-xs ${
                  darkMode ? "text-gray-500" : "text-gray-400"
                }`}
              >
                {bio.length}/280 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2 px-4 text-sm text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                darkMode
                  ? "bg-[#316DCA] hover:bg-[#2760AA] focus:ring-[#316DCA]"
                  : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
              }`}
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </div>

        <div
          className={`rounded-lg shadow p-6 ${
            darkMode ? "bg-[#2D333B]" : "bg-white border border-gray-200"
          }`}
        >
          <h2
            className={`text-lg font-semibold mb-4 ${
              darkMode ? "text-[#ADBAC7]" : "text-gray-900"
            }`}
          >
            Change Password
          </h2>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {passwordError && (
              <div className="text-red-500 text-sm">{passwordError}</div>
            )}
            {passwordSuccess && (
              <div className="text-green-500 text-sm">{passwordSuccess}</div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="currentPassword"
                className={`block text-sm font-medium ${
                  darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                }`}
              >
                Current Password
              </label>
              <input
                type="password"
                id="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={`w-full px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-[#316DCA] focus:border-transparent ${
                  darkMode
                    ? "bg-[#1C2128] border-[#373E47] text-[#ADBAC7]"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
                required
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="newPassword"
                className={`block text-sm font-medium ${
                  darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                }`}
              >
                New Password
              </label>
              <input
                type="password"
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-[#316DCA] focus:border-transparent ${
                  darkMode
                    ? "bg-[#1C2128] border-[#373E47] text-[#ADBAC7]"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
                required
                placeholder="Min. 8 characters with letters, numbers & symbols"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="confirmNewPassword"
                className={`block text-sm font-medium ${
                  darkMode ? "text-[#ADBAC7]" : "text-gray-700"
                }`}
              >
                Confirm New Password
              </label>
              <input
                type="password"
                id="confirmNewPassword"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={`w-full px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-[#316DCA] focus:border-transparent ${
                  darkMode
                    ? "bg-[#1C2128] border-[#373E47] text-[#ADBAC7]"
                    : "bg-white border-gray-300 text-gray-900"
                }`}
                required
              />
            </div>

            <button
              type="submit"
              disabled={passwordLoading}
              className={`w-full py-2 px-4 text-sm text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                darkMode
                  ? "bg-[#316DCA] hover:bg-[#2760AA] focus:ring-[#316DCA]"
                  : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
              }`}
            >
              {passwordLoading ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>

        <div
          className={`rounded-lg shadow p-6 ${
            darkMode ? "bg-[#2D333B]" : "bg-white border border-gray-200"
          }`}
        >
          <h2
            className={`text-lg font-semibold mb-4 ${
              darkMode ? "text-[#ADBAC7]" : "text-gray-900"
            }`}
          >
            Activity
          </h2>
          <ContributionGraph contributions={contributions} />
        </div>
      </div>
    </div>
  );
};

export default Settings;
