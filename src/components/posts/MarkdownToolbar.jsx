import PropTypes from "prop-types";

const MarkdownToolbar = ({ textareaRef, darkMode }) => {
  const insertMarkdown = (prefix, suffix = "") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    const beforeText = text.substring(0, start);
    const afterText = text.substring(end);

    const newText = `${beforeText}${prefix}${selectedText}${suffix}${afterText}`;
    textarea.value = newText;

    // Update React state
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    // Reset cursor position
    textarea.focus();
    const newCursorPos = selectedText
      ? end + prefix.length
      : start + prefix.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
  };

  const buttons = [
    { label: "B", title: "Bold", action: () => insertMarkdown("**", "**") },
    { label: "I", title: "Italic", action: () => insertMarkdown("*", "*") },
    { label: "H1", title: "Heading 1", action: () => insertMarkdown("# ") },
    { label: "H2", title: "Heading 2", action: () => insertMarkdown("## ") },
    { label: "H3", title: "Heading 3", action: () => insertMarkdown("### ") },
    { label: "•", title: "Bullet List", action: () => insertMarkdown("- ") },
    {
      label: "1.",
      title: "Numbered List",
      action: () => insertMarkdown("1. "),
    },
    { label: ">", title: "Quote", action: () => insertMarkdown("> ") },
    {
      label: "Code",
      title: "Code Block",
      action: () => insertMarkdown("```\n", "\n```"),
    },
    {
      label: "`",
      title: "Inline Code",
      action: () => insertMarkdown("`", "`"),
    },
    {
      label: "Link",
      title: "Link",
      action: () => insertMarkdown("[", "](url)"),
    },
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          title={button.title}
          onClick={button.action}
          className={`px-2 py-1 text-sm font-medium rounded ${
            darkMode
              ? "bg-gray-700 text-gray-200 hover:bg-gray-600"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
};

MarkdownToolbar.propTypes = {
  textareaRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  darkMode: PropTypes.bool.isRequired,
};

export default MarkdownToolbar;
