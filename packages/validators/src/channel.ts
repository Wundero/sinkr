import { z } from "zod";

export const ChannelFlags = {
  IS_PRIVATE: 0b0001,
  IS_PRESENCE: 0b0010,
  SHOULD_ENCRYPT_MESSAGES: 0b0100,
  SHOULD_STORE_MESSAGES: 0b1000,
} as const;

export const DEFAULT_FLAGS = 0;

function getFlags(
  channel:
    | {
        flags: number;
      }
    | number,
) {
  if (typeof channel === "number") {
    return channel;
  }
  return channel.flags;
}

export function channelRequiresAuthentication(
  channel:
    | {
        flags: number;
      }
    | number,
) {
  const flags = getFlags(channel);
  return Boolean(flags & (ChannelFlags.IS_PRESENCE | ChannelFlags.IS_PRIVATE));
}

export function isPrivateChannel(
  channel:
    | {
        flags: number;
      }
    | number,
) {
  const flags = getFlags(channel);
  return Boolean(flags & ChannelFlags.IS_PRIVATE);
}

export function isPresenceChannel(
  channel:
    | {
        flags: number;
      }
    | number,
) {
  const flags = getFlags(channel);
  return Boolean(flags & ChannelFlags.IS_PRESENCE);
}

export function shouldChannelEncryptMessages(
  channel:
    | {
        flags: number;
      }
    | number,
) {
  const flags = getFlags(channel);
  return Boolean(flags & ChannelFlags.SHOULD_ENCRYPT_MESSAGES);
}

export function shouldChannelStoreMessages(
  channel:
    | {
        flags: number;
      }
    | number,
) {
  const flags = getFlags(channel);
  return Boolean(flags & ChannelFlags.SHOULD_STORE_MESSAGES);
}

export function toChannel(
  channel:
    | string
    | {
        name: string;
        flags: number;
      },
) {
  if (typeof channel === "string") {
    return channelFromName(channel);
  }
  return channel;
}

export function channelFromName(name: string, flags?: number) {
  let flagsOut = flags ?? 0;
  const parts = name.split("-").slice(0, -1);
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "presence":
        flagsOut |= ChannelFlags.IS_PRESENCE;
        break;
      case "private":
        flagsOut |= ChannelFlags.IS_PRIVATE;
        break;
      case "cache":
      case "store":
        flagsOut |= ChannelFlags.SHOULD_STORE_MESSAGES;
        break;
      case "encrypt":
      case "encrypted":
        flagsOut |= ChannelFlags.SHOULD_ENCRYPT_MESSAGES;
        break;
    }
  }
  return {
    name,
    flags: flagsOut,
  };
}

export const ChannelTypeSchema = z.object({
  name: z.string(),
  flags: z.number().int(),
});

export const PresenceChannelTypeSchema = z.object({
  name: z.string(),
  flags: z
    .number()
    .int()
    .refine((num) => num & ChannelFlags.IS_PRESENCE),
});

export const SoftChannelTypeSchema = z.union([z.string(), ChannelTypeSchema]);
