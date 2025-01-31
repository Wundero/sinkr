import { z } from "zod";

import { ChannelTypeSchema, PresenceChannelTypeSchema } from "./channel";
import { MessageTypeSchema } from "./message";

export const ClientCountChannelSchema = z.object({
  event: z.literal("count"),
  channel: ChannelTypeSchema,
  count: z.number(),
});

export const ClientInitSchema = z.object({
  event: z.literal("init"),
  peerId: z.string(),
});

export const ChannelMemberSchema = z.object({
  id: z.string(),
  userInfo: z.unknown(),
});

export const ClientJoinPresenceChannelSchema = z.object({
  event: z.literal("join-presence-channel"),
  channel: PresenceChannelTypeSchema,
  members: z.array(ChannelMemberSchema),
});

export const ClientLeaveChannelSchema = z.object({
  event: z.literal("leave-channel"),
  channel: ChannelTypeSchema,
});

export const ClientNewMemberSchema = z.object({
  event: z.literal("member-join"),
  channel: PresenceChannelTypeSchema,
  member: ChannelMemberSchema,
});

export const ClientLeavePresenceChannelSchema = z.object({
  event: z.literal("member-leave"),
  channel: PresenceChannelTypeSchema,
  member: ChannelMemberSchema,
});

export const ClientReceiveMetadataSchema = z.discriminatedUnion("event", [
  ClientInitSchema,
  ClientCountChannelSchema,
  ClientJoinPresenceChannelSchema,
  ClientNewMemberSchema,
  ClientLeavePresenceChannelSchema,
  ClientLeaveChannelSchema,
]);

export const ClientReceiveMessageSchema = z.object({
  event: z.string(),
  from: z.discriminatedUnion("source", [
    z.object({
      source: z.enum(["direct", "broadcast"]),
    }),
    z.object({
      source: z.literal("channel"),
      channel: ChannelTypeSchema,
    }),
  ]),
  message: MessageTypeSchema,
});

export const ClientReceiveSchema = z.discriminatedUnion("source", [
  z.object({
    id: z.string(),
    source: z.literal("metadata"),
    data: ClientReceiveMetadataSchema,
  }),
  z.object({
    id: z.string(),
    source: z.literal("message"),
    data: ClientReceiveMessageSchema,
  }),
]);

export type ClientReception = z.infer<typeof ClientReceiveSchema>;
