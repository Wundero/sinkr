import { z } from "zod";

import { MessageTypeSchema } from "./message";

export const ClientInitSchema = z.object({
  event: z.literal("init"),
  peerId: z.string(),
});

export const ChannelMemberSchema = z.object({
  id: z.string(),
  userInfo: z.unknown().optional(),
});

export const ClientJoinChannelSchema = z.object({
  event: z.literal("join-channel"),
  channelId: z.string(),
  members: z.array(ChannelMemberSchema),
});

export const ClientLeaveChannelSchema = z.object({
  event: z.literal("leave-channel"),
  channelId: z.string(),
});

export const MemberJoinChannelSchema = z.object({
  event: z.literal("member-join"),
  channelId: z.string(),
  member: ChannelMemberSchema,
});

export const MemberLeaveChannelSchema = z.object({
  event: z.literal("member-leave"),
  channelId: z.string(),
  member: ChannelMemberSchema,
});

export const ClientReceiveMetadataSchema = z.discriminatedUnion("event", [
  ClientInitSchema,
  ClientJoinChannelSchema,
  MemberJoinChannelSchema,
  MemberLeaveChannelSchema,
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
      channelId: z.string(),
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
