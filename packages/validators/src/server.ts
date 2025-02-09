import { z } from "zod";

import { MessageTypeSchema } from "./message";

export const AuthenticateRouteSchema = z.object({
  route: z.literal("authenticate"),
  peerId: z.string(),
  id: z.string(),
  userInfo: z.unknown(),
});

export const CreateChannelRouteSchema = z.object({
  route: z.literal("createChannel"),
  name: z.string(),
  authMode: z.enum(["public", "private", "presence"]),
  storeMessages: z.boolean().default(false),
});

export const DeleteChannelRouteSchema = z.object({
  route: z.literal("deleteChannel"),
  channelId: z.string(),
});

export const SubscribeRouteSchema = z.object({
  route: z.literal("subscribe"),
  subscriberId: z.string(),
  channelId: z.string(),
});

export const UnsubscribeRouteSchema = z.object({
  route: z.literal("unsubscribe"),
  subscriberId: z.string(),
  channelId: z.string(),
});

export const DeleteStoredMessagesSchema = z.object({
  route: z.literal("deleteMessages"),
  channelId: z.string(),
  messageIds: z.array(z.string()).optional(),
});

export const ChannelMessageSchema = z.object({
  route: z.literal("channel"),
  channelId: z.string(),
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
  DeleteStoredMessagesSchema,
  CreateChannelRouteSchema,
  DeleteChannelRouteSchema,
]);
