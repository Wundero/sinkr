/**
 * Event map for customizing which events can be sent or received.
 *
 * Override this with module augmentation to specify your own types.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventMap {}

/**
 * User information for presence channels.
 *
 * Override this with module augmentation to specify your own types.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UserInfo {}

/**
 * Built-in event for initializing a connection.
 */
export const initEventSymbol: unique symbol = Symbol("sinkr-init");
/**
 * Built-in event for updating a channel's connected member count.
 */
export const countEventSymbol: unique symbol = Symbol("sinkr-count");
/**
 * Built-in event for a client connecting to a channel.
 */
export const joinEventSymbol: unique symbol = Symbol("sinkr-join");
/**
 * Built-in event for a client disconnecting from a channel.
 */
export const leaveEventSymbol: unique symbol = Symbol("sinkr-leave");
/**
 * Built-in event for a client to be informed of another client joining a presence channel.
 */
export const memberJoinEventSymbol: unique symbol = Symbol("sinkr-member-join");
/**
 * Built-in event for a client to be informed of another client leaving a presence channel.
 */
export const memberLeaveEventSymbol: unique symbol =
  Symbol("sinkr-member-leave");
/**
 * Built-in event for when the client connects to Sinkr.
 */
export const connectSymbol: unique symbol = Symbol("sinkr-connect");
/**
 * Built-in event for when the client disconnects from Sinkr.
 */
export const disconnectSymbol: unique symbol = Symbol("sinkr-disconnect");

/**
 * Type which represents an encryption key to be used to either encrypt or decrypt messages.
 */
export interface EncryptionInput {
  keyId: string;
  key: JsonWebKey | CryptoKey;
}
