import {
  AuthenticateRouteSchema as authenticateRouteSchema,
  BroadcastMessageSchema as broadcastMessageSchema,
  ChannelMemberSchema as channelMemberSchema,
  ChannelMessageSchema as channelMessageSchema,
  ClientCountChannelSchema as clientCountChannelSchema,
  ClientInitSchema as clientInitSchema,
  ClientJoinPresenceChannelSchema as clientJoinPresenceChannelSchema,
  ClientLeaveChannelSchema as clientLeaveChannelSchema,
  ClientLeavePresenceChannelSchema as clientLeavePresenceChannelSchema,
  ClientNewMemberSchema as clientNewMemberSchema,
  ClientReceiveMessageSchema as clientReceiveMessageSchema,
  ClientReceiveMetadataSchema as clientReceiveMetadataSchema,
  ClientReceiveSchema as clientReceiveSchema,
  DirectMessageSchema as directMessageSchema,
  ServerEndpointSchema as serverEndpointSchema,
  StreamedBroadcastMessageSchema as streamedBroadcastMessageSchema,
  StreamedChannelMessageSchema as streamedChannelMessageSchema,
  StreamedDirectMessageSchema as streamedDirectMessageSchema,
  StreamedServerEndpointSchema as streamedServerEndpointSchema,
  SubscribeRouteSchema as subscribeRouteSchema,
  UnsubscribeRouteSchema as unsubscribeRouteSchema,
} from "./schemas";

export const AuthenticateRouteSchema: typeof authenticateRouteSchema =
  authenticateRouteSchema;
export const SubscribeRouteSchema: typeof subscribeRouteSchema =
  subscribeRouteSchema;
export const UnsubscribeRouteSchema: typeof unsubscribeRouteSchema =
  unsubscribeRouteSchema;
export const ChannelMessageSchema: typeof channelMessageSchema =
  channelMessageSchema;
export const DirectMessageSchema: typeof directMessageSchema =
  directMessageSchema;
export const BroadcastMessageSchema: typeof broadcastMessageSchema =
  broadcastMessageSchema;
export const StreamedChannelMessageSchema: typeof streamedChannelMessageSchema =
  streamedChannelMessageSchema;
export const StreamedDirectMessageSchema: typeof streamedDirectMessageSchema =
  streamedDirectMessageSchema;
export const StreamedBroadcastMessageSchema: typeof streamedBroadcastMessageSchema =
  streamedBroadcastMessageSchema;
export const StreamedServerEndpointSchema: typeof streamedServerEndpointSchema =
  streamedServerEndpointSchema;
export const ServerEndpointSchema: typeof serverEndpointSchema =
  serverEndpointSchema;
export const ClientCountChannelSchema: typeof clientCountChannelSchema =
  clientCountChannelSchema;
export const ClientInitSchema: typeof clientInitSchema = clientInitSchema;
export const ChannelMemberSchema: typeof channelMemberSchema =
  channelMemberSchema;
export const ClientJoinPresenceChannelSchema: typeof clientJoinPresenceChannelSchema =
  clientJoinPresenceChannelSchema;
export const ClientLeaveChannelSchema: typeof clientLeaveChannelSchema =
  clientLeaveChannelSchema;
export const ClientNewMemberSchema: typeof clientNewMemberSchema =
  clientNewMemberSchema;
export const ClientLeavePresenceChannelSchema: typeof clientLeavePresenceChannelSchema =
  clientLeavePresenceChannelSchema;
export const ClientReceiveMetadataSchema: typeof clientReceiveMetadataSchema =
  clientReceiveMetadataSchema;
export const ClientReceiveMessageSchema: typeof clientReceiveMessageSchema =
  clientReceiveMessageSchema;
export const ClientReceiveSchema: typeof clientReceiveSchema =
  clientReceiveSchema;
