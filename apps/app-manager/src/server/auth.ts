import type { DefaultSession } from "next-auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { CustomD1Adapter } from "./db/adapter";

declare module "next-auth" {
  /**
   * Returned by `auth`, `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: {
      /** The user's postal address. */
      role: "USER" | "ADMIN";
      /**
       * By default, TypeScript merges new interface properties and overwrites existing ones.
       * In this case, the default session user properties will be overwritten,
       * with the new ones defined above. To keep the default session user properties,
       * you need to add them back into the newly declared interface.
       */
    } & DefaultSession["user"];
  }
  interface User {
    role: "USER" | "ADMIN";
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth(() => {
  const ctx = getCloudflareContext();
  const db = ctx.env.DATABASE;

  return {
    session: {
      strategy: "database",
    },
    providers: [
      GitHub({
        checks: ["none"],
      }),
    ],
    trustHost: true,
    adapter: CustomD1Adapter(db),
    callbacks: {
      session({ session, user }) {
        session.user.role = user.role;
        return session;
      },
    },
  } as const;
});
