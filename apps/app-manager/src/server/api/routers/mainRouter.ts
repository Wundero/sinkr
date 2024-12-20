import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { apps } from "~/server/db/schema";
import { protectedProcedure } from "../trpc";

export const mainRouter = {
  listApps: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().nullish(),
        cursor: z.string().nullish(),
        limit: z.number().min(1).max(100).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.auth.user.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
        });
      }
      const appList = await ctx.db.query.apps.findMany({
        where: (t, ops) =>
          ops.and(
            ...(input.enabled === undefined || input.enabled === null
              ? []
              : [ops.eq(t.enabled, input.enabled)]),
            ops.gt(t.id, input.cursor ?? ""),
          ),
        orderBy: (t, ops) => ops.asc(t.id),
        limit: input.limit + 1,
      });
      let nextCursor: string | null = null;
      if (appList.length > input.limit) {
        const nextItem = appList.pop();
        if (nextItem) {
          nextCursor = nextItem.id;
        }
      }
      return {
        nextCursor,
        items: appList,
      };
    }),
  createApp: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.user.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
        });
      }
      const randomBytes = new ArrayBuffer(64);
      crypto.getRandomValues(new Uint8Array(randomBytes));
      const secretKey = Buffer.from(randomBytes).toString("base64");
      const [app] = await ctx.db
        .insert(apps)
        .values({
          name: input.name,
          secretKey,
          enabled: true,
        })
        .returning();

      if (!app) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create app!",
        });
      }
      return app;
    }),
  updateApp: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(64).nullish(),
        enabled: z.boolean().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.user.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
        });
      }
      const app = await ctx.db.query.apps.findFirst({
        where: (t, ops) => ops.eq(t.id, input.id),
      });
      if (!app) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "App not found",
        });
      }
      const [updated] = await ctx.db
        .update(apps)
        .set({
          name: input.name ?? undefined,
          enabled: input.enabled ?? undefined,
        })
        .where(eq(apps.id, input.id))
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update app!",
        });
      }
      return updated;
    }),
  regenerateKey: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.user.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
        });
      }
      const randomBytes = new ArrayBuffer(64);
      crypto.getRandomValues(new Uint8Array(randomBytes));
      const secretKey = Buffer.from(randomBytes).toString("base64");
      const [app] = await ctx.db
        .update(apps)
        .set({ secretKey })
        .where(eq(apps.id, input.id))
        .returning();
      if (!app) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to regenerate key!",
        });
      }
      return app;
    }),
  deleteApp: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.auth.user.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
        });
      }
      const app = await ctx.db.query.apps.findFirst({
        where: (t, ops) => ops.eq(t.id, input.id),
      });
      if (!app) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "App not found",
        });
      }
      await ctx.db.delete(apps).where(eq(apps.id, input.id));
    }),
} satisfies TRPCRouterRecord;
