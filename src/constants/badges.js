export const BADGE_DEFINITIONS = {
  first_comment: {
    id: "first_comment",
    label: "First Comment",
    icon: "🌱",
  },
  talkative_i: {
    id: "talkative_i",
    label: "Talkative I",
    icon: "💬",
  },
  talkative_ii: {
    id: "talkative_ii",
    label: "Talkative II",
    icon: "💬",
  },
  talkative_iii: {
    id: "talkative_iii",
    label: "Talkative III",
    icon: "💥",
  },
  helpful: {
    id: "helpful",
    label: "Helpful",
    icon: "👍",
  },
  authors_pick: {
    id: "authors_pick",
    label: "Author's Pick",
    icon: "✍️",
  },
  streaker_3: {
    id: "streaker_3",
    label: "Streaker (3 days)",
    icon: "🔥",
  },
  streaker_7: {
    id: "streaker_7",
    label: "Streaker (7 days)",
    icon: "🔥",
  },
  streaker_30: {
    id: "streaker_30",
    label: "Streaker (30 days)",
    icon: "🏅",
  },
};

export const getBadgeMeta = (badgeId) =>
  BADGE_DEFINITIONS[badgeId] || {
    id: badgeId,
    label: "Community badge",
    icon: "⭐",
  };
