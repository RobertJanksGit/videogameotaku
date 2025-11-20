import { useEffect, useState, useRef, useCallback } from "react";
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
  const carouselRef = useRef(null);

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
 
  const formatDate = (createdAt) => {
    const date = getTimestampDate(createdAt);
    if (!date) return "";
    try {
      return date.toLocaleDateString();
    } catch {
      return "";
    }
  };

  const scrollCarousel = useCallback((direction) => {
    const container = carouselRef.current;
    if (!container) return;

    const firstCard = container.firstElementChild;
    const cardWidth = firstCard
      ? firstCard.getBoundingClientRect().width + 16
      : container.clientWidth;

    const maxScrollLeft = Math.max(
      0,
      container.scrollWidth - container.clientWidth
    );

    const targetScrollLeft =
      direction === "next"
        ? Math.min(container.scrollLeft + cardWidth, maxScrollLeft)
        : Math.max(container.scrollLeft - cardWidth, 0);

    container.scrollTo({
      left: targetScrollLeft,
      behavior: "smooth",
    });
  }, []);

  const renderPostCard = (post, extraClasses = "") => {
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
        className={`group flex flex-col overflow-hidden rounded-lg border shadow-sm transition-transform duration-200 hover:scale-[1.01] ${
          darkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
        } ${extraClasses}`}
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
  };

  if (loading || !posts.length) {
    return null;
  }

  return (
    <section className="mt-10" aria-label="More stories from today">
      <h2
        className={`text-xl font-semibold mb-4 ${
          darkMode ? "text-gray-100" : "text-gray-900"
        }`}
      >
        More stories from today
      </h2>

      {/* Mobile carousel, mirroring Featured Posts behavior */}
      <div className="relative md:hidden">
        <div
          ref={carouselRef}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-px-4 -mx-4 px-4 pb-2"
        >
          {posts.map((post) =>
            renderPostCard(
              post,
              "snap-start flex-shrink-0 min-w-[80%] max-w-sm max-[440px]:min-w-full max-[440px]:max-w-full"
            )
          )}
        </div>
        {posts.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => scrollCarousel("prev")}
              aria-label="View previous story from today"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-gray-700 shadow-md transition hover:bg-white dark:bg-gray-800/90 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scrollCarousel("next")}
              aria-label="View next story from today"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-gray-700 shadow-md transition hover:bg-white dark:bg-gray-800/90 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Desktop layout: original stacked/grid behavior */}
      <div className="hidden gap-4 md:flex md:flex-row md:flex-wrap">
        {posts.map((post) => renderPostCard(post, "md:flex-1"))}
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


