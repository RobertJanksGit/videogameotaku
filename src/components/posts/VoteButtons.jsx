import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import PropTypes from "prop-types";
import { incrementStarterPackUpvotes } from "../../utils/starterPackStorage";

const VoteButtons = ({ post, darkMode, onVoteChange }) => {
  const { user } = useAuth();
  const { showInfoToast } = useToast();
  const [isVoting, setIsVoting] = useState(false);

  // Calculate total votes
  const calculateVotes = (liked, disliked) => {
    return (liked?.length || 0) - (disliked?.length || 0);
  };

  const handleVote = async (voteType) => {
    if (!user) {
      // Show toast notification for non-signed-in users
      showInfoToast("Please sign in to vote on posts", 3000);
      return;
    }

    if (isVoting) return;
    setIsVoting(true);

    try {
      const postRef = doc(db, "posts", post.id);
      const usersThatLiked = [...(post.usersThatLiked || [])];
      const usersThatDisliked = [...(post.usersThatDisliked || [])];
      const hadLiked = usersThatLiked.includes(user.uid);
      const hadDisliked = usersThatDisliked.includes(user.uid);
      let addedUpvote = false;

      if (voteType === "upvote") {
        if (hadLiked) {
          // Remove like
          const index = usersThatLiked.indexOf(user.uid);
          usersThatLiked.splice(index, 1);
        } else {
          // Add like and remove dislike if exists
          usersThatLiked.push(user.uid);
          if (hadDisliked) {
            const dislikeIndex = usersThatDisliked.indexOf(user.uid);
            if (dislikeIndex !== -1) {
              usersThatDisliked.splice(dislikeIndex, 1);
            }
          }
          addedUpvote = true;
        }
      } else {
        const isDisliked = usersThatDisliked.includes(user.uid);
        if (isDisliked) {
          // Remove dislike
          const index = usersThatDisliked.indexOf(user.uid);
          usersThatDisliked.splice(index, 1);
        } else {
          // Add dislike and remove like if exists
          usersThatDisliked.push(user.uid);
          const likeIndex = usersThatLiked.indexOf(user.uid);
          if (likeIndex !== -1) {
            usersThatLiked.splice(likeIndex, 1);
          }
        }
      }

      const newTotalVotes = calculateVotes(usersThatLiked, usersThatDisliked);

      await updateDoc(postRef, {
        usersThatLiked,
        usersThatDisliked,
        totalVotes: newTotalVotes,
      });

      // Update local state through parent component
      if (onVoteChange) {
        onVoteChange({
          ...post,
          usersThatLiked,
          usersThatDisliked,
          totalVotes: newTotalVotes,
        });
      }

      if (addedUpvote) {
        incrementStarterPackUpvotes(user.uid);
      }
    } catch (error) {
      console.error("Error voting:", error);
    } finally {
      setIsVoting(false);
    }
  };

  const hasLiked = post.usersThatLiked?.includes(user?.uid);
  const hasDisliked = post.usersThatDisliked?.includes(user?.uid);
  const totalVotes = post.totalVotes || 0;

  return (
    <div
      className="flex items-center space-x-2"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleVote("upvote");
        }}
        disabled={isVoting}
        className={`p-1 rounded transition-colors bg-transparent border-0 ${
          hasLiked
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
        className={`text-sm font-medium transition-all duration-700 transform ${
          darkMode ? "text-gray-300" : "text-gray-700"
        }`}
        style={{
          display: "inline-block",
          transform: isVoting ? "scale(1.2)" : "scale(1)",
          transition: "all 0.7s ease-in-out",
        }}
      >
        {totalVotes}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleVote("downvote");
        }}
        disabled={isVoting}
        className={`p-1 rounded transition-colors bg-transparent border-0 ${
          hasDisliked
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

VoteButtons.propTypes = {
  post: PropTypes.shape({
    id: PropTypes.string.isRequired,
    usersThatLiked: PropTypes.arrayOf(PropTypes.string),
    usersThatDisliked: PropTypes.arrayOf(PropTypes.string),
    totalVotes: PropTypes.number,
  }).isRequired,
  darkMode: PropTypes.bool.isRequired,
  onVoteChange: PropTypes.func,
};

export default VoteButtons;
