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

export const ChannelMessageSchema = z.object({
  route: z.literal("channel"),
  channel: z.string(),
  event: z.string(),
  message: z.unknown(),
});

export const DirectMessageSchema = z.object({
  route: z.literal("direct"),
  recipientId: z.string(),
  event: z.string(),
  message: z.unknown(),
});

export const BroadcastMessageSchema = z.object({
  route: z.literal("broadcast"),
  event: z.string(),
  message: z.unknown(),
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
  message: z.unknown(),
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
