/**
 * The official community, read-only. The server flag in `OFFICIAL_COMMUNITY_URL`
 * decides where the API reads from; this build-time flag decides which controls
 * the browser shows. Both are set together for a deployment.
 */
export const OFFICIAL_COMMUNITY_READ_ONLY =
  process.env.NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY === "1";
