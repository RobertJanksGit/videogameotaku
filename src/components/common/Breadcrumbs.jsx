import { Link, useLocation } from "react-router-dom";
import PropTypes from "prop-types";
import { useTheme } from "../../contexts/ThemeContext";

const Breadcrumbs = ({ customCrumbs }) => {
  const location = useLocation();
  const { darkMode } = useTheme();

  // Generate breadcrumbs based on current path or custom crumbs
  const getBreadcrumbs = () => {
    if (customCrumbs) return customCrumbs;

    const pathnames = location.pathname.split("/").filter((x) => x);
    return [
      { path: "/", label: "Home" },
      ...pathnames.map((name, index) => {
        const path = `/${pathnames.slice(0, index + 1).join("/")}`;
        return {
          path,
          label: name.charAt(0).toUpperCase() + name.slice(1),
        };
      }),
    ];
  };

  const crumbs = getBreadcrumbs();

  // Add structured data for breadcrumbs
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@id": `https://videogameotaku.com${crumb.path}`,
        name: crumb.label,
      },
    })),
  };

  return (
    <>
      <script type="application/ld+json">
        {JSON.stringify(structuredData)}
      </script>
      <nav className="text-sm mb-4" aria-label="Breadcrumb">
        <ol className="list-none p-0 inline-flex">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;

            return (
              <li
                key={crumb.path}
                className={`flex items-center ${
                  darkMode ? "text-gray-300" : "text-gray-600"
                }`}
              >
                {index > 0 && (
                  <svg
                    className="w-4 h-4 mx-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                )}
                {!isLast ? (
                  <Link
                    to={crumb.path}
                    className={`hover:underline ${
                      darkMode ? "text-blue-400" : "text-blue-600"
                    }`}
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className={darkMode ? "text-gray-100" : "text-gray-900"}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
};

Breadcrumbs.propTypes = {
  customCrumbs: PropTypes.arrayOf(
    PropTypes.shape({
      path: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ),
};

export default Breadcrumbs;
