import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import { db } from "../../config/firebase";
import { useTheme } from "../../contexts/ThemeContext";
import OptimizedImage from "../common/OptimizedImage";
import { getTimestampDate } from "../../utils/formatTimeAgo";
import { fetchMoreStoriesFromToday } from "../../lib/posts/fetchMoreStoriesFromToday";

const MoreFromTodaySection = ({ currentPost }) => {
  const { darkMode } = useTheme();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (!currentPost?.id || !currentPost?.createdAt) {
        if (isMounted) {
          setPosts([]);
        }
        return;
      }

      setLoading(true);
      try {
        const results = await fetchMoreStoriesFromToday({
          db,
          currentPost,
          limitSize: 4,
        });
        if (isMounted) {
          setPosts(results);
        }
      } catch (error) {
        console.error("Error fetching more stories from today:", error);
        if (isMounted) {
          setPosts([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [currentPost?.id, currentPost?.createdAt]);

  if (loading || !posts.length) {
    return null;
  }

  const formatDate = (createdAt) => {
    const date = getTimestampDate(createdAt);
    if (!date) return "";
    try {
      return date.toLocaleDateString();
    } catch {
      return "";
    }
  };

  return (
    <section className="mt-10" aria-label="More stories from today">
      <h2
        className={`text-xl font-semibold mb-4 ${
          darkMode ? "text-gray-100" : "text-gray-900"
        }`}
      >
        More stories from today
      </h2>
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap">
        {posts.map((post) => {
          const platforms = Array.isArray(post.platforms)
            ? post.platforms
            : post.platform
            ? [post.platform]
            : [];

          const createdDateLabel = formatDate(post.createdAt);

          return (
            <Link
              key={post.id}
              to={`/post/${post.id}`}
              className={`group flex flex-col overflow-hidden rounded-lg border shadow-sm transition-transform duration-200 hover:scale-[1.01] md:flex-1 ${
                darkMode
                  ? "bg-gray-800 border-gray-700"
                  : "bg-white border-gray-200"
              }`}
            >
              {post.imageUrl ? (
                <div className="aspect-w-16 aspect-h-9 overflow-hidden">
                  <OptimizedImage
                    src={post.imageUrl}
                    alt={post.title}
                    className="h-full w-full object-contain"
                    sizes="(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 100vw"
                    loading="lazy"
                    objectFit="contain"
                  />
                </div>
              ) : null}
              <div className="flex flex-1 flex-col p-4">
                {platforms.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {platforms.map((platform) => (
                      <span
                        key={platform}
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          darkMode
                            ? "bg-gray-700 text-gray-300"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {platform}
                      </span>
                    ))}
                  </div>
                )}
                {post.category && (
                  <div className="mb-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        darkMode
                          ? "bg-gray-700 text-gray-300"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {post.category}
                    </span>
                  </div>
                )}
                <h3
                  className={`mb-1 text-base font-semibold line-clamp-2 ${
                    darkMode ? "text-white" : "text-gray-900"
                  }`}
                >
                  {post.title}
                </h3>
                {createdDateLabel && (
                  <p
                    className={`mt-1 text-xs ${
                      darkMode ? "text-gray-400" : "text-gray-500"
                    }`}
                  >
                    {createdDateLabel}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

MoreFromTodaySection.propTypes = {
  currentPost: PropTypes.shape({
    id: PropTypes.string,
    createdAt: PropTypes.any,
    category: PropTypes.string,
    platforms: PropTypes.array,
    platform: PropTypes.string,
    tags: PropTypes.array,
  }),
};

export default MoreFromTodaySection;


