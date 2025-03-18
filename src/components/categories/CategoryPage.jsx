import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTheme } from "../../contexts/ThemeContext";
import SEO from "../common/SEO";
import StructuredData from "../common/StructuredData";
import Breadcrumbs from "../common/Breadcrumbs";
import OptimizedImage from "../common/OptimizedImage";
import { db } from "../../config/firebase";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";

const CategoryPage = () => {
  const { category } = useParams();
  const { darkMode } = useTheme();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const categoryInfo = {
    news: {
      title: "Gaming News",
      description:
        "Latest gaming news, updates, and announcements from the video game industry.",
      keywords:
        "gaming news, video game updates, gaming industry news, game announcements",
    },
    review: {
      title: "Game Reviews",
      description:
        "In-depth video game reviews, ratings, and analysis from our gaming community.",
      keywords:
        "game reviews, video game ratings, game analysis, gaming reviews",
    },
    guide: {
      title: "Gaming Guides",
      description:
        "Comprehensive gaming guides, tutorials, and walkthroughs for various video games.",
      keywords:
        "gaming guides, game tutorials, video game walkthroughs, gaming tips",
    },
    opinion: {
      title: "Gaming Opinion",
      description:
        "Editorial content, opinions, and discussions about video games and the gaming industry.",
      keywords:
        "gaming opinions, video game editorials, gaming discussions, game industry analysis",
    },
  };

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const postsQuery = query(
          collection(db, "posts"),
          where("category", "==", category),
          where("status", "==", "published"),
          orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(postsQuery);
        const fetchedPosts = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setPosts(fetchedPosts);
      } catch (error) {
        console.error("Error fetching posts:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPosts();
  }, [category]);

  const info = categoryInfo[category] || {
    title: "Category",
    description: "Explore our gaming content",
    keywords: "video games, gaming",
  };

  return (
    <>
      <SEO
        title={info.title}
        description={info.description}
        keywords={info.keywords}
        type="website"
      />
      <StructuredData
        type="CollectionPage"
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `Video Game Otaku - ${info.title}`,
          description: info.description,
          url: `https://videogameotaku.com/${category}`,
          hasPart: posts.map((post) => ({
            "@type": "Article",
            headline: post.title,
            description: post.content.substring(0, 150),
            image: post.imageUrl,
            datePublished: post.createdAt?.toDate().toISOString(),
            dateModified:
              post.updatedAt?.toDate().toISOString() ||
              post.createdAt?.toDate().toISOString(),
            author: {
              "@type": "Person",
              name: post.author?.name || "Video Game Otaku",
            },
            publisher: {
              "@type": "Organization",
              name: "Video Game Otaku",
              logo: {
                "@type": "ImageObject",
                url: "https://videogameotaku.com/logo.svg",
              },
            },
          })),
        }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs
          customCrumbs={[
            { path: "/", label: "Home" },
            { path: `/${category}`, label: info.title },
          ]}
        />
        <header>
          <h1
            className={`text-3xl font-bold mb-4 ${
              darkMode ? "text-white" : "text-gray-900"
            }`}
          >
            {info.title}
          </h1>
          <p
            className={`text-lg mb-8 ${
              darkMode ? "text-gray-300" : "text-gray-600"
            }`}
          >
            {info.description}
          </p>
        </header>
        {loading ? (
          <div className="flex justify-center">
            <div
              className={`animate-spin rounded-full h-8 w-8 border-b-2 ${
                darkMode ? "border-white" : "border-gray-900"
              }`}
            />
          </div>
        ) : (
          <section>
            <h2
              className={`text-2xl font-bold mb-6 ${
                darkMode ? "text-white" : "text-gray-900"
              }`}
            >
              Latest {info.title}
            </h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className={`h-entry rounded-lg overflow-hidden shadow-lg ${
                    darkMode ? "bg-gray-800" : "bg-white"
                  }`}
                >
                  {post.imageUrl && (
                    <OptimizedImage
                      src={post.imageUrl}
                      alt={post.title}
                      className="w-full h-48 u-photo"
                      sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                    />
                  )}
                  <div className="p-6">
                    <h3
                      className={`text-xl font-bold mb-2 p-name ${
                        darkMode ? "text-white" : "text-gray-900"
                      }`}
                    >
                      {post.title}
                    </h3>
                    <p
                      className={`text-sm mb-4 p-summary ${
                        darkMode ? "text-gray-300" : "text-gray-600"
                      }`}
                    >
                      {post.content.substring(0, 150)}...
                    </p>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-2 h-card p-author">
                        <h4
                          className={`text-sm font-semibold ${
                            darkMode ? "text-gray-300" : "text-gray-700"
                          }`}
                        >
                          Author:
                        </h4>
                        {post.authorPhotoURL && (
                          <img
                            src={post.authorPhotoURL}
                            alt={post.authorName}
                            className="w-8 h-8 rounded-full u-photo"
                          />
                        )}
                        <span
                          className={`text-sm p-name ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                          }`}
                        >
                          {post.authorName}
                        </span>
                      </div>
                      <div>
                        <h4
                          className={`text-sm font-semibold mb-1 ${
                            darkMode ? "text-gray-300" : "text-gray-700"
                          }`}
                        >
                          Published:
                        </h4>
                        <time
                          dateTime={post.createdAt?.toDate().toISOString()}
                          className={`text-sm dt-published ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                          }`}
                        >
                          {post.createdAt?.toDate().toLocaleDateString()}
                        </time>
                      </div>
                    </div>
                    <a href={`/post/${post.id}`} className="u-url hidden">
                      Permalink
                    </a>
                    <span className="p-category hidden">{post.category}</span>
                  </div>
                </article>
              ))}
            </div>
            {posts.length === 0 && (
              <div className="text-center py-8">
                <h3
                  className={`text-xl font-semibold ${
                    darkMode ? "text-gray-300" : "text-gray-700"
                  }`}
                >
                  No Posts Found
                </h3>
                <p
                  className={`mt-2 ${
                    darkMode ? "text-gray-400" : "text-gray-600"
                  }`}
                >
                  Check back later for new content in this category.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
};

export default CategoryPage;
