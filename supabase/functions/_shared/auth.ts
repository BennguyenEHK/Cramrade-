// Who is calling? Functions run with verify_jwt = true, so the platform has
// already checked the token's signature; here we turn it into a user.

import { db, serviceRoleKey } from './db.ts';
import { HttpError } from './http.ts';

export interface AuthedUser {
  /** The auth user id, same as profiles.id. */
  id: string;
  /** True for anonymous (guest) sign-ins: quiz players without an account. */
  isAnonymous: boolean;
}

/** The token after "Bearer ", or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** The signed-in caller, guests included. 401 when there is no valid user token. */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'not_signed_in', 'Sign in first.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'not_signed_in', 'Sign in first.');
  return { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
}

/** Like requireUser, but guests get 403. Everything except quiz play uses this. */
export async function requireFullUser(req: Request): Promise<AuthedUser> {
  const user = await requireUser(req);
  if (user.isAnonymous) {
    throw new HttpError(403, 'guest_not_allowed', 'Guests cannot do this. Create an account first.');
  }
  return user;
}

/** True when another function called with the service-role key (see invoke.ts). */
export function isServiceCall(req: Request): boolean {
  return bearerToken(req) === serviceRoleKey;
}
