/**
 * Bot models and access helpers.
 */

export const BOT_PROFILES_COLLECTION = "botProfiles";
export const PENDING_ACTIONS_COLLECTION = "pendingActions";

export const PendingActionType = Object.freeze({
  POST_NOTIFICATION: "POST_NOTIFICATION",
  REPLY_NOTIFICATION: "REPLY_NOTIFICATION",
});

/**
 * @typedef {Object} BotBehavior
 * @property {number} baseResponseProbability
 * @property {number} replyResponseProbability
 * @property {{ min: number, max: number }} postDelayMinutes
 * @property {{ min: number, max: number }} replyDelayMinutes
 * @property {{
 *  commentOnPost: number;
 *  commentOnComment: number;
 *  likePostOnly: number;
 *  likeAndComment: number;
 *  ignore: number;
 * }} actionWeights
 * @property {number} maxCommentsPerPost
 * @property {number} maxRepliesPerThread
 * @property {number} typoChance
 * @property {number} maxTyposPerComment
 */

/**
 * @typedef {Object} BotProfile
 * @property {string} uid
 * @property {string} userName
 * @property {boolean} isActive
 * @property {"male"|"female"|"other"|"unknown"} sex
 * @property {string[]} personalityTraits
 * @property {string} mood
 * @property {string[]} likes
 * @property {string[]} dislikes
 * @property {string} communicationStyle
 * @property {string} selfImage
 * @property {string} flaw
 * @property {string} motivation
 * @property {string} responseStyle
 * @property {BotBehavior} behavior
 * @property {Record<string, number>=} topicPreferences
 * @property {string=} avatarUrl
 * @property {number=} lastEngagedAt
 */

/**
 * @typedef {Object} PendingAction
 * @property {string} id
 * @property {keyof typeof PendingActionType} type
 * @property {string} userUid
 * @property {string} postId
 * @property {string=} parentCommentId
 * @property {string=} threadRootCommentId
 * @property {number} triggerAt
 * @property {number} createdAt
 * @property {number} attempts
 */

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 */
export const botProfilesCollection = (db) =>
  db.collection(BOT_PROFILES_COLLECTION);

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 */
export const pendingActionsCollection = (db) =>
  db.collection(PENDING_ACTIONS_COLLECTION);

/**
 * Convert Firestore doc snapshot to BotProfile.
 * @param {import('firebase-admin').firestore.DocumentSnapshot} doc
 * @returns {BotProfile | null}
 */
export const toBotProfile = (doc) => {
  if (!doc.exists) return null;
  const data = doc.data();
  if (!data) return null;
  return {
    uid: doc.id,
    userName: data.userName,
    isActive: Boolean(data.isActive),
    sex: data.sex ?? "unknown",
    personalityTraits: Array.isArray(data.personalityTraits)
      ? data.personalityTraits
      : [],
    mood: data.mood ?? "neutral",
    likes: Array.isArray(data.likes) ? data.likes : [],
    dislikes: Array.isArray(data.dislikes) ? data.dislikes : [],
    communicationStyle: data.communicationStyle ?? "",
    selfImage: data.selfImage ?? "",
    flaw: data.flaw ?? "",
    motivation: data.motivation ?? "",
    responseStyle: data.responseStyle ?? "",
    avatarUrl: data.avatarUrl ?? data.photoURL ?? null,
    behavior: data.behavior ?? {},
    topicPreferences: data.topicPreferences ?? undefined,
    lastEngagedAt:
      typeof data.lastEngagedAt === "number" ? data.lastEngagedAt : undefined,
  };
};

/**
 * @param {import('firebase-admin').firestore.QueryDocumentSnapshot} doc
 */
export const toPendingAction = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    type: data.type,
    userUid: data.userUid,
    postId: data.postId,
    parentCommentId: data.parentCommentId,
    threadRootCommentId: data.threadRootCommentId,
    triggerAt: data.triggerAt,
    createdAt: data.createdAt,
    attempts: data.attempts ?? 0,
  };
};

export const MAX_BOTS_PER_POST = 3;
export const MAX_PENDING_ACTION_ATTEMPTS = 3;
export const BOT_COOLDOWN_MINUTES = 5;

/**
 * Build the canonical pending action payload.
 * @param {keyof typeof PendingActionType} type
 * @param {Object} options
 * @param {string} options.userUid
 * @param {string} options.postId
 * @param {number} options.triggerAt
 * @param {string=} options.parentCommentId
 * @param {string=} options.threadRootCommentId
 */
export const buildPendingActionPayload = (
  type,
  {
    userUid,
    postId,
    triggerAt,
    parentCommentId = undefined,
    threadRootCommentId = undefined,
  }
) => ({
  type,
  userUid,
  postId,
  parentCommentId: parentCommentId ?? null,
  threadRootCommentId: threadRootCommentId ?? null,
  triggerAt,
  createdAt: Date.now(),
  attempts: 0,
});

/**
 * Convenience helper to query due pending actions.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {number} nowMs
 * @param {number} maxAttempts
 */
export const pendingActionsDueQuery = (
  db,
  nowMs
) =>
  pendingActionsCollection(db)
    .where("triggerAt", "<=", nowMs)
    .orderBy("triggerAt", "asc");
