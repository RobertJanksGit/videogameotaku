import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "../../contexts/ThemeContext";
import SEO from "./SEO";
import StructuredData from "./StructuredData";
import { db } from "../../config/firebase";
import { collection, query, limit, getDocs, orderBy } from "firebase/firestore";

const NotFound = () => {
  const { darkMode } = useTheme();
  const navigate = useNavigate();
  const [suggestedPosts, setSuggestedPosts] = useState([]);
  const mainHeadingRef = useRef(null);

  useEffect(() => {
    // Focus the main heading when component mounts for better screen reader experience
    mainHeadingRef.current?.focus();
  }, []);

  useEffect(() => {
    const fetchSuggestedPosts = async () => {
      try {
        const postsQuery = query(
          collection(db, "posts"),
          orderBy("totalVotes", "desc"),
          limit(3)
        );
        const snapshot = await getDocs(postsQuery);
        const posts = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setSuggestedPosts(posts);
      } catch (error) {
        console.error("Error fetching suggested posts:", error);
      }
    };

    fetchSuggestedPosts();
  }, []);

  const handleKeyDown = (e, action) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  };

  return (
    <>
      <SEO
        title="Page Not Found"
        description="The page you're looking for cannot be found. Explore our popular gaming content instead."
        type="website"
      />
      <StructuredData
        type="BreadcrumbList"
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              item: {
                "@id": "https://videogameotaku.com",
                name: "Home",
              },
            },
            {
              "@type": "ListItem",
              position: 2,
              item: {
                "@id": "https://videogameotaku.com/404",
                name: "Page Not Found",
              },
            },
          ],
        }}
      />
      <main
        className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8"
        role="main"
      >
        <div className="max-w-3xl w-full space-y-8 text-center">
          <div>
            <h1
              ref={mainHeadingRef}
              tabIndex={-1}
              className={`text-6xl font-bold mb-4 ${
                darkMode ? "text-white" : "text-gray-900"
              } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              404
            </h1>
            <h2
              className={`text-2xl font-semibold mb-2 ${
                darkMode ? "text-gray-200" : "text-gray-700"
              }`}
            >
              Page Not Found
            </h2>
            <p
              className={`text-lg mb-8 ${
                darkMode ? "text-gray-300" : "text-gray-600"
              }`}
            >
              The page you&apos;re looking for doesn&apos;t exist or has been
              moved.
            </p>
          </div>

          <div
            className="space-y-4"
            role="navigation"
            aria-label="Error page navigation"
          >
            <button
              onClick={() => navigate(-1)}
              onKeyDown={(e) => handleKeyDown(e, () => navigate(-1))}
              className={`px-6 py-3 rounded-lg mr-4 ${
                darkMode
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
              aria-label="Go back to previous page"
            >
              Go Back
            </button>
            <Link
              to="/"
              className={`px-6 py-3 rounded-lg inline-block ${
                darkMode
                  ? "bg-gray-700 hover:bg-gray-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-900"
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
              aria-label="Return to homepage"
            >
              Return Home
            </Link>
          </div>

          {suggestedPosts.length > 0 && (
            <section
              className="mt-12"
              aria-labelledby="suggested-posts-heading"
            >
              <h3
                id="suggested-posts-heading"
                className={`text-xl font-semibold mb-6 ${
                  darkMode ? "text-gray-200" : "text-gray-700"
                }`}
              >
                Popular Posts You Might Like
              </h3>
              <div
                className="grid gap-6 md:grid-cols-3"
                role="list"
                aria-label="Suggested posts"
              >
                {suggestedPosts.map((post) => (
                  <Link
                    key={post.id}
                    to={`/post/${post.id}`}
                    className={`block p-4 rounded-lg transition-transform hover:scale-105 ${
                      darkMode
                        ? "bg-gray-800 hover:bg-gray-700"
                        : "bg-white hover:bg-gray-50"
                    } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    role="listitem"
                    onKeyDown={(e) =>
                      handleKeyDown(e, () => navigate(`/post/${post.id}`))
                    }
                  >
                    <h4
                      className={`font-medium mb-2 ${
                        darkMode ? "text-gray-200" : "text-gray-900"
                      }`}
                    >
                      {post.title}
                    </h4>
                    <p
                      className={`text-sm ${
                        darkMode ? "text-gray-400" : "text-gray-600"
                      }`}
                    >
                      {post.content.substring(0, 100)}...
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
};

export default NotFound;
