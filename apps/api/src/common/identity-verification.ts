export const IDENTITY_VERIFICATION_TTL_MS = 30 * 60 * 1_000;

export function identityVerificationIsValid(verifiedAt: Date | null, now = new Date()): boolean {
  return Boolean(
    verifiedAt && now.getTime() - verifiedAt.getTime() >= 0 &&
      now.getTime() - verifiedAt.getTime() <= IDENTITY_VERIFICATION_TTL_MS,
  );
}

