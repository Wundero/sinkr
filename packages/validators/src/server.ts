import { z } from "zod";

import { MessageTypeSchema } from "./message";

export const STANDARD_ERRORS = [
  "Invalid connection",
  "Invalid request",
  "Unknown error",
] as const;

function makeSchema<
  TRoute extends string,
  TReq extends z.ZodTypeAny,
  TRes extends z.ZodTypeAny,
>(
  route: TRoute,
  {
    request,
    response,
  }: {
    request: TReq;
    response: TRes;
  },
) {
  const schema = {
    request: z.object({
      route: z.literal(route),
      request,
    }),
    response: z.object({
      route: z.literal(route),
      response,
    }),
  } as const;
  return {
    [route]: schema,
  } as Record<TRoute, typeof schema>;
}

export const ALL_ROUTES = {
  ...makeSchema("user.authenticate", {
    request: z.object({
      peerId: z.string(),
      id: z.string(),
      userInfo: z.unknown(),
    }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum([...STANDARD_ERRORS, "Peer not found"]),
      }),
    ]),
  }),
  ...makeSchema("channel.create", {
    request: z.object({
      name: z.string(),
      authMode: z.enum(["public", "private", "presence"]),
      storeMessages: z.boolean().default(false),
    }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
        channelId: z.string(),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum(STANDARD_ERRORS),
      }),
    ]),
  }),
  ...makeSchema("channel.delete", {
    request: z.object({
      channelId: z.string(),
    }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum([...STANDARD_ERRORS, "Channel not found"]),
      }),
    ]),
  }),
  ...makeSchema("channel.messages.delete", {
    request: z.object({
      channelId: z.string(),
      messageIds: z.array(z.string()).nullish(),
    }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum(STANDARD_ERRORS),
      }),
    ]),
  }),
  ...makeSchema("channel.subscribers.add", {
    request: z.object({ subscriberId: z.string(), channelId: z.string() }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum([
          ...STANDARD_ERRORS,
          "Channel not found",
          "Peer not found",
          "Peer not authenticated",
        ]),
      }),
    ]),
  }),
  ...makeSchema("channel.subscribers.remove", {
    request: z.object({ subscriberId: z.string(), channelId: z.string() }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum([
          ...STANDARD_ERRORS,
          "Channel not found",
          "Peer not found",
          "Peer is not subscribed to channel",
        ]),
      }),
    ]),
  }),
  ...makeSchema("channel.messages.send", {
    request: z.object({
      channelId: z.string(),
      event: z.string(),
      message: MessageTypeSchema,
    }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum([...STANDARD_ERRORS, "Channel not found"]),
      }),
    ]),
  }),
  ...makeSchema("user.messages.send", {
    request: z.object({
      recipientId: z.string(),
      event: z.string(),
      message: MessageTypeSchema,
    }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum([...STANDARD_ERRORS, "Recipient not found"]),
      }),
    ]),
  }),
  ...makeSchema("global.messages.send", {
    request: z.object({
      event: z.string(),
      message: MessageTypeSchema,
    }),
    response: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
      }),
      z.object({
        success: z.literal(false),
        error: z.enum(STANDARD_ERRORS),
      }),
    ]),
  }),
} as const;

export type ServerRoute = keyof typeof ALL_ROUTES;

export type RouteRequestSchema<TRoute extends ServerRoute> = z.infer<
  (typeof ALL_ROUTES)[TRoute]["request"]
>;

export type RouteResponseSchema<TRoute extends ServerRoute> = z.infer<
  (typeof ALL_ROUTES)[TRoute]["response"]
>;

export const UserAuthenticateRequestSchema =
  ALL_ROUTES["user.authenticate"].request;
export const UserAuthenticateResponseSchema =
  ALL_ROUTES["user.authenticate"].response;
export const ChannelCreateRequestSchema = ALL_ROUTES["channel.create"].request;
export const ChannelCreateResponseSchema =
  ALL_ROUTES["channel.create"].response;
export const ChannelDeleteRequestSchema = ALL_ROUTES["channel.delete"].request;
export const ChannelDeleteResponseSchema =
  ALL_ROUTES["channel.delete"].response;
export const ChannelMessagesDeleteRequestSchema =
  ALL_ROUTES["channel.messages.delete"].request;
export const ChannelMessagesDeleteResponseSchema =
  ALL_ROUTES["channel.messages.delete"].response;
export const ChannelSubscribersAddRequestSchema =
  ALL_ROUTES["channel.subscribers.add"].request;
export const ChannelSubscribersAddResponseSchema =
  ALL_ROUTES["channel.subscribers.add"].response;
export const ChannelSubscribersRemoveRequestSchema =
  ALL_ROUTES["channel.subscribers.remove"].request;
export const ChannelSubscribersRemoveResponseSchema =
  ALL_ROUTES["channel.subscribers.remove"].response;
export const ChannelMessagesSendRequestSchema =
  ALL_ROUTES["channel.messages.send"].request;
export const ChannelMessagesSendResponseSchema =
  ALL_ROUTES["channel.messages.send"].response;
export const UserMessagesSendRequestSchema =
  ALL_ROUTES["user.messages.send"].request;
export const UserMessagesSendResponseSchema =
  ALL_ROUTES["user.messages.send"].response;
export const GlobalMessagesSendRequestSchema =
  ALL_ROUTES["global.messages.send"].request;
export const GlobalMessagesSendResponseSchema =
  ALL_ROUTES["global.messages.send"].response;

export const ServerRequestSchema = z.discriminatedUnion("route", [
  UserAuthenticateRequestSchema,
  ChannelCreateRequestSchema,
  ChannelDeleteRequestSchema,
  ChannelMessagesDeleteRequestSchema,
  ChannelSubscribersAddRequestSchema,
  ChannelSubscribersRemoveRequestSchema,
  ChannelMessagesSendRequestSchema,
  UserMessagesSendRequestSchema,
  GlobalMessagesSendRequestSchema,
]);

export const ServerResponseSchema = z.discriminatedUnion("route", [
  UserAuthenticateResponseSchema,
  ChannelCreateResponseSchema,
  ChannelDeleteResponseSchema,
  ChannelMessagesDeleteResponseSchema,
  ChannelSubscribersAddResponseSchema,
  ChannelSubscribersRemoveResponseSchema,
  ChannelMessagesSendResponseSchema,
  UserMessagesSendResponseSchema,
  GlobalMessagesSendResponseSchema,
]);
