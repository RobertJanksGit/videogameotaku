import ReactMarkdown from "react-markdown";
import PropTypes from "prop-types";

const RichContent = ({ content, darkMode }) => {
  // Split content by image tags
  const parts = content.split(/(\[img:[^\]]+\])/);

  return (
    <div className={`prose ${darkMode ? "dark:prose-invert" : ""} max-w-none`}>
      {parts.map((part, index) => {
        if (part.startsWith("[img:")) {
          // Handle image tags
          const [url, alt] = part.slice(5, -1).split("|");
          return (
            <img
              key={index}
              src={url}
              alt={alt || ""}
              className="my-4 rounded-lg max-h-[500px] w-auto mx-auto"
            />
          );
        } else {
          // Render markdown content
          return (
            <ReactMarkdown
              key={index}
              components={{
                // Style headers
                h1: ({ children }) => (
                  <h1
                    className={`text-3xl font-bold mb-4 ${
                      darkMode ? "text-white" : "text-gray-900"
                    }`}
                  >
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2
                    className={`text-2xl font-bold mb-3 ${
                      darkMode ? "text-white" : "text-gray-900"
                    }`}
                  >
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3
                    className={`text-xl font-bold mb-2 ${
                      darkMode ? "text-white" : "text-gray-900"
                    }`}
                  >
                    {children}
                  </h3>
                ),
                // Style paragraphs
                p: ({ children, node }) => {
                  // Check if this paragraph only contains a code block
                  const hasOnlyCodeBlock =
                    node.children.length === 1 &&
                    node.children[0].type === "element" &&
                    node.children[0].tagName === "code" &&
                    !node.children[0].properties?.inline;

                  if (hasOnlyCodeBlock) {
                    return children;
                  }

                  return (
                    <p
                      className={`mb-4 ${
                        darkMode ? "text-gray-300" : "text-gray-700"
                      }`}
                    >
                      {children}
                    </p>
                  );
                },
                // Style lists
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-4 space-y-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-4 space-y-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className={darkMode ? "text-gray-300" : "text-gray-700"}>
                    {children}
                  </li>
                ),
                // Style blockquotes
                blockquote: ({ children }) => (
                  <blockquote
                    className={`border-l-4 pl-4 my-4 ${
                      darkMode
                        ? "border-gray-700 text-gray-400"
                        : "border-gray-300 text-gray-600"
                    }`}
                  >
                    {children}
                  </blockquote>
                ),
                // Style code blocks
                code: ({ node, inline, className, children }) => {
                  // If it's an inline code block
                  if (inline) {
                    return (
                      <code
                        className={`px-1 py-0.5 rounded ${
                          darkMode
                            ? "bg-gray-800 text-gray-200"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {children}
                      </code>
                    );
                  }

                  // For block code, check if we're already inside a pre tag
                  const isInsidePre =
                    node.position?.start.line === node.position?.end.line;
                  if (isInsidePre) {
                    return <code>{children}</code>;
                  }

                  // Otherwise, wrap in a pre tag
                  return (
                    <div className="my-4">
                      <pre
                        className={`p-4 rounded-lg overflow-auto ${
                          darkMode
                            ? "bg-gray-800 text-gray-200"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        <code>{children}</code>
                      </pre>
                    </div>
                  );
                },
              }}
            >
              {part}
            </ReactMarkdown>
          );
        }
      })}
    </div>
  );
};

RichContent.propTypes = {
  content: PropTypes.string.isRequired,
  darkMode: PropTypes.bool.isRequired,
};

export default RichContent;
