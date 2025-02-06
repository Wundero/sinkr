import { z } from "zod";

import {
  SoftChannelTypeSchema,
  StoredMessageChannelTypeSchema,
} from "./channel";
import { MessageTypeSchema } from "./message";

export const AuthenticateRouteSchema = z.object({
  route: z.literal("authenticate"),
  peerId: z.string(),
  id: z.string(),
  userInfo: z.unknown(),
});

export const SubscribeRouteSchema = z.object({
  route: z.literal("subscribe"),
  subscriberId: z.string(),
  channel: SoftChannelTypeSchema,
});

export const UnsubscribeRouteSchema = z.object({
  route: z.literal("unsubscribe"),
  subscriberId: z.string(),
  channel: SoftChannelTypeSchema,
});

export const ChannelMessageSchema = z.object({
  route: z.literal("channel"),
  channel: SoftChannelTypeSchema,
  event: z.string(),
  message: MessageTypeSchema,
});

export const DeleteStoredMessagesSchema = z.object({
  route: z.literal("deleteMessages"),
  channel: StoredMessageChannelTypeSchema,
  messageIds: z.array(z.string()).optional(),
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
]);
