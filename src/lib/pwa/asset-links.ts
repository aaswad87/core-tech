/**
 * Digital Asset Links for an Android Trusted Web Activity (TWA). Publishing this file proves to
 * Android that the Play Store app and this website belong together, so the app opens the site
 * full-screen without a browser bar.
 *
 * Configure with:
 *   ANDROID_TWA_PACKAGE_NAME          e.g. com.coretechrecruiting.app
 *   ANDROID_TWA_SHA256_FINGERPRINTS   comma-separated signing-key SHA-256 fingerprints (AA:BB:...)
 * Values are public by design (they're published at /.well-known/assetlinks.json).
 */
export type AssetLinkStatement = {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
};

const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const FINGERPRINT_PATTERN = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function buildAssetLinks(env: Record<string, string | undefined>): AssetLinkStatement[] {
  const packageName = env.ANDROID_TWA_PACKAGE_NAME?.trim();
  const fingerprints = (env.ANDROID_TWA_SHA256_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);

  if (!packageName && fingerprints.length === 0) return [];
  if (!packageName || !PACKAGE_PATTERN.test(packageName)) {
    throw new Error("ANDROID_TWA_PACKAGE_NAME is missing or not a valid Android package name");
  }
  if (fingerprints.length === 0 || !fingerprints.every((f) => FINGERPRINT_PATTERN.test(f))) {
    throw new Error("ANDROID_TWA_SHA256_FINGERPRINTS must be colon-separated SHA-256 fingerprints");
  }

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
