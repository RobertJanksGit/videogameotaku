import ReactMarkdown from "react-markdown";
import PropTypes from "prop-types";
import { parseEmbedToken } from "../../utils/embedTokens";
import { EMBED_COMPONENTS } from "../embeds";

const TOKEN_SPLIT_REGEX = /(\[img:[^\]]+\]|\{\{\s*embed\b[^}]*\}\})/gi;

const MARKDOWN_COMPONENTS = (darkMode) => ({
  h1: ({ children }) => (
    <h2
      className={`text-3xl font-bold mb-4 ${
        darkMode ? "text-white" : "text-gray-900"
      }`}
    >
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3
      className={`text-2xl font-bold mb-3 ${
        darkMode ? "text-white" : "text-gray-900"
      }`}
    >
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4
      className={`text-xl font-bold mb-2 ${
        darkMode ? "text-white" : "text-gray-900"
      }`}
    >
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5
      className={`text-lg font-bold mb-2 ${
        darkMode ? "text-white" : "text-gray-900"
      }`}
    >
      {children}
    </h5>
  ),
  h5: ({ children }) => (
    <h6
      className={`text-base font-bold mb-2 ${
        darkMode ? "text-white" : "text-gray-900"
      }`}
    >
      {children}
    </h6>
  ),
  h6: ({ children }) => (
    <h6
      className={`text-sm font-bold mb-2 ${
        darkMode ? "text-white" : "text-gray-900"
      }`}
    >
      {children}
    </h6>
  ),
  p: ({ children, node }) => {
    const hasOnlyCodeBlock =
      node.children.length === 1 &&
      node.children[0].type === "element" &&
      node.children[0].tagName === "code" &&
      !node.children[0].properties?.inline;

    if (hasOnlyCodeBlock) {
      return children;
    }

    return (
      <p className={`mb-4 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
        {children}
      </p>
    );
  },
  ul: ({ children }) => (
    <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className={darkMode ? "text-gray-300" : "text-gray-700"}>{children}</li>
  ),
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
  code: ({ node, inline, children }) => {
    if (inline) {
      return (
        <code
          className={`px-1 py-0.5 rounded ${
            darkMode ? "bg-gray-800 text-gray-200" : "bg-gray-100 text-gray-800"
          }`}
        >
          {children}
        </code>
      );
    }

    const isInsidePre =
      node.position?.start.line === node.position?.end.line;
    if (isInsidePre) {
      return <code>{children}</code>;
    }

    return (
      <div className="my-4">
        <pre
          className={`p-4 rounded-lg overflow-auto ${
            darkMode ? "bg-gray-800 text-gray-200" : "bg-gray-100 text-gray-800"
          }`}
        >
          <code>{children}</code>
        </pre>
      </div>
    );
  },
});

const splitContent = (content) => {
  if (!content) return [];

  const segments = [];
  let lastIndex = 0;

  const matches = content.matchAll(TOKEN_SPLIT_REGEX);

  for (const match of matches) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      segments.push({
        type: "markdown",
        value: content.slice(lastIndex, start),
      });
    }

    if (token.startsWith("[img:")) {
      segments.push({ type: "image", value: token });
    } else {
      segments.push({ type: "embed", value: token });
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: "markdown",
      value: content.slice(lastIndex),
    });
  }

  return segments;
};

const renderSegment = (segment, index, darkMode) => {
  if (segment.type === "image") {
    const [url, alt] = segment.value.slice(5, -1).split("|");
    return (
      <figure key={`img-${index}`} className="my-6">
        <img
          src={url}
          alt={alt || ""}
          className="my-4 rounded-lg max-h-[500px] w-auto mx-auto"
        />
        {alt && (
          <figcaption className="text-center text-sm text-gray-500 dark:text-gray-400">
            {alt}
          </figcaption>
        )}
      </figure>
    );
  }

  if (segment.type === "embed") {
    const parsed = parseEmbedToken(segment.value);
    if (parsed) {
      const providerKey = parsed.provider?.toLowerCase?.() || parsed.provider;
      const EmbedComponent = EMBED_COMPONENTS[providerKey];
      if (EmbedComponent) {
        return (
          <div key={`embed-${index}`} className="my-6">
            <EmbedComponent url={parsed.url} darkMode={darkMode} />
          </div>
        );
      }
    }

    return (
      <div
        key={`embed-unsupported-${index}`}
        className={`my-6 rounded-md border p-4 text-sm ${
          darkMode
            ? "border-gray-700 text-gray-400 bg-[#1C2128]"
            : "border-gray-200 text-gray-600 bg-gray-50"
        }`}
      >
        Unsupported embed.
      </div>
    );
  }

  return (
    <ReactMarkdown
      key={`md-${index}`}
      components={MARKDOWN_COMPONENTS(darkMode)}
    >
      {segment.value}
    </ReactMarkdown>
  );
};

const RichContent = ({ content, darkMode }) => {
  const segments = splitContent(content);

  return (
    <div className={`prose ${darkMode ? "dark:prose-invert" : ""} max-w-none`}>
      {segments.map((segment, index) =>
        renderSegment(segment, index, darkMode)
      )}
    </div>
  );
};

RichContent.propTypes = {
  content: PropTypes.string.isRequired,
  darkMode: PropTypes.bool.isRequired,
};

export default RichContent;
