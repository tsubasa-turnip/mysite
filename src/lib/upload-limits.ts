export const VERCEL_UPLOAD_MB = 4;

// Vercel exposes VERCEL during both build and runtime. Its vercel.json env
// settings need not be present during the build, so use the same safe default.
export function uploadLimitMb(env: Record<string, string | undefined> = process.env) {
  const maximum = env.VERCEL ? VERCEL_UPLOAD_MB : 25;
  const requested = Number(env.MAX_UPLOAD_MB) || maximum;
  return Math.min(maximum, Math.max(1, requested));
}
