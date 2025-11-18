import express from "express";
import { handleGeneratePostWebMemory } from "./triggers/generatePostWebMemory.js";

const PORT = process.env.PORT || 8080;
const app = express();

// Read raw text for all content types
app.use(
  express.text({
    limit: "1mb",
    type: "*/*",
  })
);

// Grab postId from the Firestore event blob
const extractPostIdFromRawBody = (raw = "") => {
  if (typeof raw !== "string") {
    raw = String(raw);
  }

  // Strip BOM if present
  raw = raw.replace(/^\uFEFF/, "");

  // Firestore event contains something like:
  // projects/<project>/databases/(default)/documents/posts/<postId>
  const match = raw.match(
    /projects\/[^/]+\/databases\/\(default\)\/documents\/posts\/([A-Za-z0-9_-]+)/
  );

  return match ? match[1] : null;
};

app.post("/", async (req, res) => {
  const rawBody = req.body || "";

  const postId = extractPostIdFromRawBody(rawBody);

  if (!postId) {
    console.error(
      "[generatePostWebMemory] Could not extract postId from event body",
      {
        rawSnippet: rawBody.slice(0, 200),
      }
    );
    // 200 so Eventarc doesn't keep retrying forever
    return res.status(200).send("No postId found; nothing to do");
  }

  console.log("[generatePostWebMemory] Extracted postId from Firestore event", {
    postId,
  });

  try {
    await handleGeneratePostWebMemory({ postId });
    res.status(200).send("OK");
  } catch (error) {
    console.error("[generatePostWebMemory] Handler failed", {
      postId,
      error: error?.message ?? error,
    });
    res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`[generatePostWebMemory] Listening on port ${PORT}`);
});

export default app;
