import { Helmet } from "react-helmet-async";
import PropTypes from "prop-types";

const StructuredData = ({ type, data }) => {
  const getStructuredData = () => {
    switch (type) {
      case "Article":
        return {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: data.title,
          description: data.description,
          image: data.image,
          datePublished: data.datePublished,
          dateModified: data.dateModified,
          author: {
            "@type": "Person",
            name: data.author,
          },
        };
      case "WebSite":
        return {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: data.name,
          description: data.description,
          url: data.url,
        };
      case "Organization":
        return {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: data.name,
          url: data.url,
          logo: data.logo,
          sameAs: data.socialLinks,
        };
      case "BreadcrumbList":
        return {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: data.itemListElement,
        };
      case "CollectionPage":
        return {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: data.name,
          description: data.description,
          url: data.url,
          hasPart: data.hasPart,
        };
      default:
        return null;
    }
  };

  const structuredData = getStructuredData();

  if (!structuredData) return null;

  return (
    <Helmet>
      <script type="application/ld+json">
        {JSON.stringify(structuredData)}
      </script>
    </Helmet>
  );
};

StructuredData.propTypes = {
  type: PropTypes.oneOf([
    "Article",
    "WebSite",
    "Organization",
    "BreadcrumbList",
    "CollectionPage",
  ]).isRequired,
  data: PropTypes.object.isRequired,
};

export default StructuredData;
