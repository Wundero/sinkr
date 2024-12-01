import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

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

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      profile(profile) {
        let role: "USER" | "ADMIN" = "USER";
        switch (profile.login) {
          case "wundero": // Change this to your GitHub username
            role = "ADMIN";
            break;
          default:
            break;
        }
        return { ...profile, id: `${profile.id}`, role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.role = token.role === "ADMIN" ? "ADMIN" : "USER";
      return session;
    },
  },
});
