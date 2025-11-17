import OpenAI from "openai";
import { defineSecret } from "firebase-functions/params";

const openaiApiKey = defineSecret("OPENAI_API_KEY");

let cachedClient = null;

const resolveApiKey = () => {
  const secretValue =
    typeof openaiApiKey?.value === "function" ? openaiApiKey.value() : null;
  return secretValue || process.env.OPENAI_API_KEY || "";
};

export const getOpenAIClient = () => {
  if (cachedClient) return cachedClient;
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
};

export const setOpenAIClientForTesting = (client) => {
  cachedClient = client || null;
};

export const openaiSecret = openaiApiKey;
