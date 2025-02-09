import { z } from "zod";

export const MessageTypeSchema = z.discriminatedUnion("type", [
  // Full message
  z.object({
    type: z.literal("plain"),
    message: z.unknown(),
  }),
  // Message part
  z.object({
    type: z.literal("chunk"),
    index: z.number(),
    message: z.unknown(),
  }),
]);
