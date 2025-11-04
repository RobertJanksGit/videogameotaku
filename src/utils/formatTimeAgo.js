export const getTimestampDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const dateFromNumber = new Date(value);
    return isNaN(dateFromNumber.getTime()) ? null : dateFromNumber;
  }

  if (typeof value === "string") {
    const dateFromString = new Date(value);
    return isNaN(dateFromString.getTime()) ? null : dateFromString;
  }

  if (typeof value === "object" && typeof value.toDate === "function") {
    const dateFromTimestamp = value.toDate();
    return isNaN(dateFromTimestamp.getTime()) ? null : dateFromTimestamp;
  }

  return null;
};

const formatTimeAgo = (input) => {
  const date = getTimestampDate(input);

  if (!date) return "";

  const now = new Date();
  const diffInMs = Math.max(0, now.getTime() - date.getTime());
  const diffInSeconds = Math.floor(diffInMs / 1000);

  if (diffInSeconds < 45) return "just now";

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;

  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 5) return `${diffInWeeks}w ago`;

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) return `${diffInMonths}mo ago`;

  const diffInYears = Math.floor(diffInDays / 365);
  return `${diffInYears}y ago`;
};

export default formatTimeAgo;

