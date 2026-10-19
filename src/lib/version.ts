/**
 * The first three version segments identify the incorporated upstream release.
 * Increment the fourth segment once per fork deploy, with one changelog entry.
 * Check the hosted /api/version first; keep an unshipped revision for that deploy.
 * Change UPSTREAM_VERSION only when incorporating a new upstream release.
 */
export const UPSTREAM_VERSION = "4.3.0";
export const FORK_REVISION = 4;
export const APP_VERSION = `${UPSTREAM_VERSION}.${FORK_REVISION}`;
