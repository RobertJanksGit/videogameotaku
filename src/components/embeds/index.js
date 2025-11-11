import TwitterEmbed from "./TwitterEmbed";
import YouTubeEmbed from "./YouTubeEmbed";
import TwitchEmbed from "./TwitchEmbed";

// Registry of supported embed components keyed by the `type` value in the
// `{{embed type="..." url="..."}}` token.
export const EMBED_COMPONENTS = {
  twitter: TwitterEmbed,
  youtube: YouTubeEmbed,
  twitch: TwitchEmbed,
};

export { default as TwitterEmbed } from "./TwitterEmbed";
export { default as YouTubeEmbed } from "./YouTubeEmbed";
export { default as TwitchEmbed } from "./TwitchEmbed";

