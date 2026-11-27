/**
 * Family sign-in, built on Better Auth: email and password, sessions in cookies, and the
 * organization plugin for the care group (a person and their family, with roles). We do not write
 * our own password hashing, session or role code.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization as organizationPlugin } from 'better-auth/plugins';
import { schema } from '@kaabil/db';
import type { Db } from './types';

export interface AuthOptions {
  db: Db;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  /** Better Auth's own rate limiter. Off in tests, on everywhere else. */
  rateLimit?: boolean;
}

export function createAuth(o: AuthOptions) {
  const secure = o.baseUrl.startsWith('https://');
  return betterAuth({
    appName: 'Kaabil',
    baseURL: o.baseUrl,
    secret: o.secret,
    trustedOrigins: [o.baseUrl, ...o.trustedOrigins],
    database: drizzleAdapter(o.db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure },
    },
    rateLimit: { enabled: o.rateLimit ?? true, window: 60, max: 100, customRules: { '/sign-in/email': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 10 } } },
    plugins: [organizationPlugin()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
