const RANKS = [
  { max: 90, label: "New Scout", emoji: "✨" },
  { max: 490, label: "Info Hunter", emoji: "🧩" },
  { max: 1990, label: "Top Scout", emoji: "🔥" },
  { max: 9990, label: "News Ronin", emoji: "🗡️" },
  { max: Infinity, label: "Legendary Otaku", emoji: "👑" },
];

export const getRankFromKarma = (karmaInput) => {
  const karma = Number.isFinite(karmaInput) ? karmaInput : 0;

  const rank = RANKS.find(({ max }) => karma <= max) || RANKS[RANKS.length - 1];

  return {
    label: rank.label,
    emoji: rank.emoji,
  };
};

export default getRankFromKarma;

