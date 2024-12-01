import { getCloudflareContext } from "@opennextjs/cloudflare";
import { initTRPC, TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/d1";
import superjson from "superjson";
import { ZodError } from "zod";

import * as schema from "~/server/db/schema";
import { auth } from "../auth";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const { env } = await getCloudflareContext();
  const db = drizzle(env.DATABASE, { schema });
  const authObj = await auth();
  return {
    db,
    auth: authObj,
    ...opts,
  };
};
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      auth: ctx.auth,
    },
  });
});
