import { randomInt, randomFloat } from "./utils.js";

export const maybeAddTypos = (bot, text) => {
  const typoChance = bot?.behavior?.typoChance ?? 0;
  const maxTypos = bot?.behavior?.maxTyposPerComment ?? 0;

  if (!typoChance || typoChance <= 0 || !maxTypos || maxTypos <= 0) {
    return text;
  }

  if (randomFloat() > typoChance) {
    return text;
  }

  const typoCount = randomInt(1, maxTypos);
  let result = text;

  for (let i = 0; i < typoCount; i += 1) {
    result = introduceSingleTypo(result);
  }

  return result;
};

export const introduceSingleTypo = (text) => {
  if (!text || text.length < 5) {
    return text;
  }

  const index = randomInt(0, text.length - 2);
  const roll = randomFloat();

  if (roll < 0.33) {
    return (
      text.slice(0, index) +
      text[index + 1] +
      text[index] +
      text.slice(index + 2)
    );
  }

  if (roll < 0.66) {
    return text.slice(0, index) + text.slice(index + 1);
  }

  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const replacement = alphabet[randomInt(0, alphabet.length - 1)];
  return text.slice(0, index) + replacement + text.slice(index + 1);
};
