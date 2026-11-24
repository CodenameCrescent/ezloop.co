import "server-only";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { logger } from "../lib/logger";
import { EmailNotVerified, OAuthLinkRefused, SignInUnavailable, findOrCreateOAuthUser, passwordSignIn } from "./accounts";
import { SignInRateLimited, limitedPasswordSignIn } from "./signInLimits";

/**
 * NextAuth v4 owns the session (a signed JWT in an httpOnly cookie, 30 days);
 * Supabase Auth owns the users. The token's `uid` is always the Supabase user
 * id, whichever provider was used.
 *
 * Google switches itself on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are
 * set. Adding Microsoft or Apple later is one provider entry plus the same
 * `findOrCreateOAuthUser` call in `signIn`.
 */

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/sign-in", error: "/sign-in" },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;
        const headers = (req?.headers ?? {}) as Record<string, string | string[] | undefined>;
        const header = (name: string) => {
          const value = headers[name] ?? headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] : value;
        };
        try {
          return await limitedPasswordSignIn(email, password, header, passwordSignIn);
        } catch (err) {
          // Each reaches the form as its own `error` code (AuthForms.tsx).
          if (err instanceof EmailNotVerified || err instanceof SignInRateLimited || err instanceof SignInUnavailable) throw err;
          logger.error({ err }, "password sign-in failed");
          throw new SignInUnavailable();
        }
      },
    }),
    ...(googleEnabled()
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! })]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") return true;
      if (!user.email) return false;
      try {
        user.id = await findOrCreateOAuthUser({
          email: user.email,
          // Linking by email is only safe when the provider vouches for the address.
          emailVerified: (profile as { email_verified?: boolean } | undefined)?.email_verified === true,
          name: user.name ?? null,
          image: user.image ?? null,
          provider: account?.provider ?? "oauth",
        });
        return true;
      } catch (err) {
        // A refusal says why on the sign-in page; anything else is a plain failure.
        if (err instanceof OAuthLinkRefused) return `/sign-in?error=${err.code}`;
        logger.error({ err }, "oauth sign-in failed");
        return false;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        // When this session began (ms). A password reset revokes every
        // session that began before it (accountStatus.ts).
        token.authTime = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
};
