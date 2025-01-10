import { z } from "zod";

export const AuthenticateRouteSchema = z.object({
  route: z.literal("authenticate"),
  peerId: z.string(),
  id: z.string(),
  userInfo: z.unknown(),
});

export const SubscribeRouteSchema = z.object({
  route: z.literal("subscribe"),
  subscriberId: z.string(),
  channel: z.string(),
});

export const UnsubscribeRouteSchema = z.object({
  route: z.literal("unsubscribe"),
  subscriberId: z.string(),
  channel: z.string(),
});

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

export const ChannelMessageSchema = z.object({
  route: z.literal("channel"),
  channel: z.string(),
  event: z.string(),
  message: MessageTypeSchema,
});

export const DirectMessageSchema = z.object({
  route: z.literal("direct"),
  recipientId: z.string(),
  event: z.string(),
  message: MessageTypeSchema,
});

export const BroadcastMessageSchema = z.object({
  route: z.literal("broadcast"),
  event: z.string(),
  message: MessageTypeSchema,
});

export const ServerEndpointSchema = z.discriminatedUnion("route", [
  AuthenticateRouteSchema,
  SubscribeRouteSchema,
  UnsubscribeRouteSchema,
  ChannelMessageSchema,
  DirectMessageSchema,
  BroadcastMessageSchema,
]);

export const ClientCountChannelSchema = z.object({
  event: z.literal("count"),
  channel: z.string(),
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
  channel: z.string(),
  members: z.array(ChannelMemberSchema),
});

export const ClientLeaveChannelSchema = z.object({
  event: z.literal("leave-channel"),
  channel: z.string(),
});

export const ClientNewMemberSchema = z.object({
  event: z.literal("member-join"),
  channel: z.string(),
  member: ChannelMemberSchema,
});

export const ClientLeavePresenceChannelSchema = z.object({
  event: z.literal("member-leave"),
  channel: z.string(),
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
      channel: z.string(),
    }),
  ]),
  message: MessageTypeSchema,
});

export const ClientReceiveSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("metadata"),
    data: ClientReceiveMetadataSchema,
  }),
  z.object({
    source: z.literal("message"),
    data: ClientReceiveMessageSchema,
  }),
]);

export type ClientReception = z.infer<typeof ClientReceiveSchema>;
