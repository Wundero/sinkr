import { getCloudflareContext } from "@opennextjs/cloudflare";
import { initTRPC } from "@trpc/server";
import { drizzle } from "drizzle-orm/d1";
import superjson from "superjson";
import { ZodError } from "zod";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const { env } = await getCloudflareContext();
  const db = drizzle(env.DATABASE);
  return {
    db,
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
