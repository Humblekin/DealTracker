/**
 * Validates that an auth redirect query parameter stays within this app's origin.
 * Rejects protocol-relative URLs (//evil.com), backslashes (/\evil.com),
 * absolute URLs (https://evil.com), and control characters.
 */
export function getSafeRedirectPath(redirectParam) {
  if (typeof redirectParam !== 'string') return null;
  const trimmed = redirectParam.trim();
  if (!trimmed || /[\r\n\t]/.test(trimmed)) return null;
  if (!/^\/(?![/\\])/.test(trimmed)) return null;
  return trimmed;
}
