import { useState, useEffect } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../config/firebase";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

const HomePage = () => {
  const { darkMode } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [featuredPosts, setFeaturedPosts] = useState([]);
  const [latestPosts, setLatestPosts] = useState([]);
  const [votes, setVotes] = useState({});

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        // Fetch posts ordered by total votes and date
        const postsQuery = query(
          collection(db, "posts"),
          orderBy("totalVotes", "desc"),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const postsSnapshot = await getDocs(postsQuery);
        const allPosts = postsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // If user is logged in, fetch their votes
        if (user) {
          const votesQuery = query(collection(db, "votes"));
          const votesSnapshot = await getDocs(votesQuery);
          const userVotes = {};

          votesSnapshot.docs.forEach((doc) => {
            const vote = doc.data();
            if (vote.userId === user.uid) {
              userVotes[vote.postId] = vote.type;
            }
          });

          setVotes(userVotes);
        }

        setFeaturedPosts(allPosts.slice(0, 4));
        setLatestPosts(allPosts);
      } catch (error) {
        console.error("Error fetching posts:", error);
      }
    };

    fetchPosts();
  }, [user]);

  const handleVote = async (postId, voteType) => {
    if (!user) {
      // TODO: Show login prompt
      return;
    }

    try {
      const voteId = `${postId}_${user.uid}`;
      const voteRef = doc(db, "votes", voteId);
      const postRef = doc(db, "posts", postId);
      const currentVote = votes[postId];

      // Only allow voting if user hasn't voted or is voting in the opposite direction
      if (currentVote && currentVote === voteType) {
        return; // Do nothing if trying to vote in same direction
      }

      // Calculate vote change
      let voteChange = voteType === "up" ? 1 : -1;
      if (currentVote) {
        // If changing vote, double the effect (e.g., changing from down to up is +2)
        voteChange *= 2;
      }

      // Optimistically update UI
      const updatePosts = (posts) =>
        posts.map((post) => {
          if (post.id === postId) {
            return {
              ...post,
              totalVotes: (post.totalVotes || 0) + voteChange,
            };
          }
          return post;
        });

      setVotes({ ...votes, [postId]: voteType });
      setFeaturedPosts(updatePosts(featuredPosts));
      setLatestPosts(updatePosts(latestPosts));

      // Update Firestore atomically
      await Promise.all([
        setDoc(voteRef, {
          postId,
          userId: user.uid,
          type: voteType,
          createdAt: serverTimestamp(),
        }),
        updateDoc(postRef, {
          totalVotes: increment(voteChange),
        }),
      ]);
    } catch (error) {
      console.error("Error voting:", error);
      // Revert optimistic update on error
      const fetchPosts = async () => {
        const postsQuery = query(
          collection(db, "posts"),
          orderBy("totalVotes", "desc"),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const postsSnapshot = await getDocs(postsQuery);
        const allPosts = postsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setFeaturedPosts(allPosts.slice(0, 4));
        setLatestPosts(allPosts);
      };
      fetchPosts();
    }
  };

  const renderVoteButtons = (post) => {
    const userVote = votes[post.id];

    return (
      <div className="flex items-center space-x-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleVote(post.id, "up");
          }}
          disabled={userVote === "up"}
          className={`p-1 rounded transition-colors bg-transparent border-0 ${
            userVote === "up"
              ? "text-blue-500 cursor-default"
              : darkMode
              ? "text-gray-400 hover:text-blue-400"
              : "text-gray-600 hover:text-blue-600"
          }`}
          style={{ background: "transparent", padding: "0.25rem" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <span
          className={`text-sm font-medium ${
            darkMode ? "text-gray-300" : "text-gray-700"
          }`}
        >
          {post.totalVotes || 0}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleVote(post.id, "down");
          }}
          disabled={userVote === "down"}
          className={`p-1 rounded transition-colors bg-transparent border-0 ${
            userVote === "down"
              ? "text-red-500 cursor-default"
              : darkMode
              ? "text-gray-400 hover:text-red-400"
              : "text-gray-600 hover:text-red-600"
          }`}
          style={{ background: "transparent", padding: "0.25rem" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    );
  };

  const handlePostClick = (postId) => {
    navigate(`/post/${postId}`);
  };

  return (
    <div className="w-full space-y-8">
      {/* Featured Posts Section */}
      <section className="w-full">
        <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
          Featured Posts
        </h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {featuredPosts.map((post) => (
            <div
              key={post.id}
              onClick={() => handlePostClick(post.id)}
              className={`rounded-lg overflow-hidden ${
                darkMode
                  ? "bg-gray-800 border-gray-700"
                  : "bg-white border-gray-200"
              } shadow-lg border cursor-pointer transition-transform hover:scale-[1.02]`}
            >
              {post.imageUrl ? (
                <div className="aspect-w-16 aspect-h-9">
                  <img
                    src={post.imageUrl}
                    alt={post.title}
                    className="w-full h-48 object-cover"
                  />
                </div>
              ) : (
                <div
                  className={`w-full h-48 flex items-center justify-center ${
                    darkMode ? "bg-gray-700" : "bg-gray-100"
                  }`}
                >
                  <span
                    className={`text-4xl ${
                      darkMode ? "text-gray-600" : "text-gray-400"
                    }`}
                  >
                    📰
                  </span>
                </div>
              )}
              <div className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
                      darkMode
                        ? "bg-gray-700 text-gray-300"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {post.category}
                  </span>
                  {renderVoteButtons(post)}
                </div>
                <h3
                  className={`text-xl font-semibold mb-2 ${
                    darkMode ? "text-white" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </h3>
                <p
                  className={`text-sm mb-4 line-clamp-2 ${
                    darkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  {post.content}
                </p>
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs ${
                      darkMode ? "text-gray-400" : "text-gray-500"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center overflow-hidden ${
                          darkMode ? "bg-gray-700" : "bg-gray-100"
                        }`}
                      >
                        {post.authorPhotoURL ? (
                          <img
                            src={post.authorPhotoURL}
                            alt={post.authorName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span
                            className={`text-xs font-medium ${
                              darkMode ? "text-gray-300" : "text-gray-600"
                            }`}
                          >
                            {post.authorName?.[0]?.toUpperCase() || "A"}
                          </span>
                        )}
                      </div>
                      <span>{post.authorName}</span>
                    </div>
                  </span>
                  <span
                    className={`text-xs ${
                      darkMode ? "text-gray-400" : "text-gray-500"
                    }`}
                  >
                    {post.createdAt?.toDate().toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Latest Posts Section */}
      <section className="w-full">
        <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
          Latest Posts
        </h2>
        <div className="space-y-8">
          {latestPosts.map((post) => (
            <article
              key={post.id}
              onClick={() => handlePostClick(post.id)}
              className={`rounded-lg overflow-hidden ${
                darkMode
                  ? "bg-gray-800 border-gray-700"
                  : "bg-white border-gray-200"
              } shadow-lg border cursor-pointer transition-transform hover:scale-[1.01]`}
            >
              {post.imageUrl && (
                <div className="aspect-w-16 aspect-h-9">
                  <img
                    src={post.imageUrl}
                    alt={post.title}
                    className="w-full h-64 object-cover"
                  />
                </div>
              )}
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <span
                      className={`px-3 py-1 text-sm font-semibold rounded-full ${
                        darkMode
                          ? "bg-gray-700 text-gray-300"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {post.category}
                    </span>
                    {renderVoteButtons(post)}
                  </div>
                  <span
                    className={`text-sm ${
                      darkMode ? "text-gray-400" : "text-gray-500"
                    }`}
                  >
                    {post.createdAt?.toDate().toLocaleDateString()}
                  </span>
                </div>
                <h3
                  className={`text-2xl font-bold mb-4 ${
                    darkMode ? "text-white" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </h3>
                <p
                  className={`text-base mb-4 line-clamp-3 ${
                    darkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  {post.content}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
                        darkMode ? "bg-gray-700" : "bg-gray-100"
                      }`}
                    >
                      {post.authorPhotoURL ? (
                        <img
                          src={post.authorPhotoURL}
                          alt={post.authorName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span
                          className={`text-sm font-medium ${
                            darkMode ? "text-gray-300" : "text-gray-600"
                          }`}
                        >
                          {post.authorName?.[0]?.toUpperCase() || "A"}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-sm ${
                        darkMode ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      {post.authorName}
                    </span>
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      darkMode
                        ? "text-blue-400 hover:text-blue-300"
                        : "text-blue-600 hover:text-blue-700"
                    }`}
                  >
                    Read more
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};

export default HomePage;
