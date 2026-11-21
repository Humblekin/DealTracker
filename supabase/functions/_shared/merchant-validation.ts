export function isApiKeyExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false

  const expiration = Date.parse(expiresAt)
  return !Number.isFinite(expiration) || expiration <= now
}

export function isMerchantPermissionAllowed(
  permissions: Record<string, unknown>,
  permission: string
): boolean {
  return permissions[permission] === true
}

interface MerchantClaimInput {
  accountEmail: string | null | undefined
  emailConfirmedAt: string | null | undefined
  submittedEmail: string | null | undefined
  merchantUserId: string | null | undefined
  callerUserId: string | null | undefined
}

export function canClaimMerchantByEmail({
  accountEmail,
  emailConfirmedAt,
  submittedEmail,
  merchantUserId,
  callerUserId,
}: MerchantClaimInput): boolean {
  if (!accountEmail || !emailConfirmedAt || !submittedEmail || !callerUserId) return false

  if (accountEmail.trim().toLowerCase() !== submittedEmail.trim().toLowerCase()) return false
  return !merchantUserId || merchantUserId === callerUserId
}
