export function isAllowedPaymentRedirect(
  redirectUrl: string,
  allowedOrigins: string[]
): boolean {
  try {
    const parsed = new URL(redirectUrl)
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && allowedOrigins.includes(parsed.origin)
  } catch {
    return false
  }
}
