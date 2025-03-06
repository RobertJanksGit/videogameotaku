import { useState, useEffect } from "react";
import PropTypes from "prop-types";

const OptimizedImage = ({
  src,
  alt,
  className,
  width,
  height,
  loading = "lazy",
  sizes = "100vw",
  objectFit = "cover",
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2;

  useEffect(() => {
    // Reset states when src changes
    setLoaded(false);
    setError(false);
    setRetryCount(0);

    // Preload the image
    if (src) {
      const img = new Image();
      img.src = src;

      img.onload = () => {
        setLoaded(true);
      };

      img.onerror = () => {
        if (retryCount < maxRetries) {
          // Add cache-busting parameter for retry
          const cacheBuster = `?cb=${Date.now()}`;
          img.src = src.includes("?")
            ? `${src}&cb=${Date.now()}`
            : `${src}${cacheBuster}`;
          setRetryCount((prev) => prev + 1);
        } else {
          setError(true);
        }
      };
    }
  }, [src, retryCount]);

  const handleLoad = () => {
    setLoaded(true);
  };

  const handleError = () => {
    if (retryCount < maxRetries) {
      // Try loading again with cache busting
      setRetryCount((prev) => prev + 1);
    } else {
      setError(true);
    }
  };

  // Generate srcset for responsive images
  const generateSrcSet = () => {
    if (!src) return "";

    // Define common viewport widths
    const widths = [320, 640, 768, 1024, 1280, 1536];

    return widths
      .map((w) => {
        // For images hosted on CDNs that support dynamic resizing
        // You can modify this based on your image hosting service
        const resizedUrl = src.includes("?")
          ? `${src}&w=${w}`
          : `${src}?w=${w}`;
        return `${resizedUrl} ${w}w`;
      })
      .join(", ");
  };

  // Add cache busting parameter if retrying
  const getImageSrc = () => {
    if (retryCount > 0) {
      const cacheBuster = `cb=${Date.now()}`;
      return src.includes("?")
        ? `${src}&${cacheBuster}`
        : `${src}?${cacheBuster}`;
    }
    return src;
  };

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ width, height }}
    >
      {!loaded && !error && (
        <div
          className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse"
          aria-hidden="true"
        />
      )}

      {error ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800"
          aria-hidden="true"
        >
          <span className="text-gray-400">Image not available</span>
        </div>
      ) : (
        <img
          src={getImageSrc()}
          alt={alt}
          loading={loading}
          onLoad={handleLoad}
          onError={handleError}
          className={`w-full h-full transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          style={{ objectFit }}
          srcSet={generateSrcSet()}
          sizes={sizes}
          decoding="async"
          fetchPriority={loading === "eager" ? "high" : "auto"}
        />
      )}
    </div>
  );
};

OptimizedImage.propTypes = {
  src: PropTypes.string.isRequired,
  alt: PropTypes.string.isRequired,
  className: PropTypes.string,
  width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  height: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  loading: PropTypes.oneOf(["lazy", "eager"]),
  sizes: PropTypes.string,
  objectFit: PropTypes.oneOf([
    "contain",
    "cover",
    "fill",
    "none",
    "scale-down",
  ]),
};

export default OptimizedImage;
