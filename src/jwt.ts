// Meryem Esma Eröz, 2200005798
// Bonus 7: a signed token (JWT) instead of a session row.
import { jwtVerify, SignJWT } from "jose";
import type { Role } from "./schema.ts";

export type TokenUser = { userId: number; role: Role };

const key = (secret: string) => new TextEncoder().encode(secret);

/**
 * Sign a token for a user: the id goes in `sub`, the role in a `role` claim, and the token
 * expires after `expiresIn` (one hour by default). HS256 = HMAC with SHA-256.
 */
export function signToken(
  user: TokenUser,
  secret: string,
  expiresIn: string | number = "1h",
): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.userId))
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key(secret));
}

/** The user in a token, or null when it is malformed, tampered, expired or signed with another secret. */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<TokenUser | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    const role = payload.role;
    if (!Number.isInteger(userId) || (role !== "user" && role !== "admin")) return null;
    return { userId, role };
  } catch {
    return null; // bad signature, malformed or expired
  }
}
