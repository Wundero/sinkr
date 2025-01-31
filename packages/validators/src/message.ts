import { z } from "zod";

export const MessageTypeSchema = z.discriminatedUnion("type", [
  // Unencrypted message
  z.object({
    type: z.literal("plain"),
    message: z.unknown(),
  }),
  // Unencrypted message part
  z.object({
    type: z.literal("chunk"),
    index: z.number(),
    message: z.unknown(),
  }),
  // Encrypted message
  z.object({
    type: z.literal("encrypted"),
    ciphertext: z.string(),
    keyId: z.string(),
  }),
  // Encrypted message part
  z.object({
    type: z.literal("encrypted-chunk"),
    ciphertext: z.string(),
    keyId: z.string(),
    index: z.number(),
  }),
]);
