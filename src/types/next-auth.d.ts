import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** The Supabase auth user id. */
    uid?: string;
    /** When this session began, ms since epoch. */
    authTime?: number;
  }
}
