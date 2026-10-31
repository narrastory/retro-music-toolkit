/**
 * Single source of truth for the release version. Reports, manifests and the
 * CLI banner all read this instead of hard-coding strings.
 */
export const TOOLKIT_VERSION = "1.2.0";
export const ACCEPTED_SCHEMA_VERSIONS = ["1.0", "1.1", "1.2", "1.3"] as const;
/** Schema version written by every authoring tool in this release. */
export const SUPPORTED_SCHEMA = "1.3" as const;
export const ENGINE_STRING = "Tone.js / Chromium / PCM16";
