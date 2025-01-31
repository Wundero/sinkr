import type { z } from "zod";
import Emittery from "emittery";

import type {
  ChannelMemberSchema,
  ClientCountChannelSchema,
  ClientInitSchema,
  ClientJoinPresenceChannelSchema,
  ClientLeaveChannelSchema,
  ClientLeavePresenceChannelSchema,
  ClientNewMemberSchema,
  ClientReceiveMessageSchema,
} from "@sinkr/validators";
import { ClientReceiveSchema, toChannel } from "@sinkr/validators";

import type { RealEventMap } from "./event-fallback";
import type { EncryptionInput, UserInfo } from "./types";
import { decrypt, importUnknownJWK } from "./crypto";
import {
  connectSymbol,
  countEventSymbol,
  disconnectSymbol,
  initEventSymbol,
  joinEventSymbol,
  leaveEventSymbol,
  memberJoinEventSymbol,
  memberLeaveEventSymbol,
} from "./types";

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

interface DefaultEvents {
  [initEventSymbol]: z.infer<typeof ClientInitSchema>;
  [countEventSymbol]: z.infer<typeof ClientCountChannelSchema>;
  [joinEventSymbol]: z.infer<typeof ClientJoinPresenceChannelSchema>;
  [leaveEventSymbol]: z.infer<typeof ClientLeaveChannelSchema>;
  [memberJoinEventSymbol]: z.infer<typeof ClientNewMemberSchema>;
  [memberLeaveEventSymbol]: z.infer<typeof ClientLeavePresenceChannelSchema>;
  [connectSymbol]: undefined;
  [disconnectSymbol]: undefined;
}

type GenericMessageEvent<T> = Prettify<
  Omit<z.infer<typeof ClientReceiveMessageSchema>, "message"> & {
    message: T;
    index?: number;
  }
>;

type MappedEvents = {
  [K in keyof RealEventMap]: GenericMessageEvent<RealEventMap[K]>;
};

type _EventMapWithDefaults = MappedEvents & DefaultEvents;

type EventMapWithDefaults = Prettify<_EventMapWithDefaults>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function proxyRemoveEmit<T extends Emittery<any>>(emitter: T) {
  return new Proxy<Omit<T, "emit" | "emitSerial">>(emitter, {
    get(target, prop, receiver) {
      if (prop === "emit" || prop === "emitSerial") {
        return () => {};
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

type SoftChannel =
  | string
  | {
      name: string;
      flags: number;
    };

function chash(channel: SoftChannel) {
  const ch = toChannel(channel);
  return `${ch.flags}.${ch.name}`;
}

function ceq(a: SoftChannel, b: SoftChannel) {
  return chash(a) === chash(b);
}

class BrowserSinker extends Emittery<EventMapWithDefaults> {
  private ws: WebSocket | null = null;

  private channelCache = new Map<string, WeakRef<SinkrChannel>>();

  private keyMap = new Map<string, CryptoKey>();

  constructor(private url: string) {
    super();
  }

  /**
   * Imports a decryption key for the client to decrypt messages.
   */
  async addDecryptionKey(key: EncryptionInput) {
    const imported = await importUnknownJWK(key.key);
    this.keyMap.set(key.keyId, imported);
  }

  /**
   * Get a sinkr channel by name. If a presence channel is specified, alternative types and messages will be available.
   * @param channel The channel to listen to. Events will only fire if the current client is subscribed to the channel.
   */
  channel(channel: SoftChannel, flags?: number): SinkrChannel {
    const ch = toChannel(channel);
    ch.flags |= flags ?? 0;
    const chas = chash(channel);
    const cached = this.channelCache.get(chas)?.deref();
    if (cached) {
      return cached;
    }
    const newChannel = proxyRemoveEmit(new ChannelSinker(this, channel));
    const ref = new WeakRef(newChannel);
    this.channelCache.set(chas, ref);
    return newChannel;
  }

  /**
   * Disconnect from the Sinkr server and clear all listeners.
   */
  disconnect() {
    this.ws?.close();
    this.clearListeners();
  }

  /**
   * Connect to the Sinkr server.
   */
  connect() {
    if (this.ws) {
      this.ws.close();
    }
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => {
      void this.emit(connectSymbol);
    });
    this.ws.addEventListener("message", (event) => {
      const dat = event.data as unknown;
      if (typeof dat !== "string") {
        console.error("Received non-string message", dat);
        return;
      }
      const parsed = ClientReceiveSchema.safeParse(JSON.parse(dat));
      if (!parsed.success) {
        console.error("Failed to parse message", parsed.error, event.data);
        this.ws?.close();
        return;
      }
      const data = parsed.data;
      if (data.source === "metadata") {
        switch (data.data.event) {
          case "init":
            void this.emit(initEventSymbol, data.data);
            break;
          case "count":
            void this.emit(countEventSymbol, data.data);
            break;
          case "join-presence-channel":
            void this.emit(joinEventSymbol, data.data);
            break;
          case "leave-channel":
            void this.emit(leaveEventSymbol, data.data);
            break;
          case "member-join":
            void this.emit(memberJoinEventSymbol, data.data);
            break;
          case "member-leave":
            void this.emit(memberLeaveEventSymbol, data.data);
            break;
        }
      } else {
        void this.emitMessage(data.data);
      }
    });
    this.ws.addEventListener("close", () => {
      void this.emit(disconnectSymbol);
      this.ws = null;
    });
  }

  private async emitMessage<T>(
    input: z.infer<typeof ClientReceiveMessageSchema>,
  ) {
    if (
      input.message.type === "encrypted" ||
      input.message.type === "encrypted-chunk"
    ) {
      const key = this.keyMap.get(input.message.keyId);
      if (!key) {
        return;
      }
      try {
        const msg = await decrypt(input.message.ciphertext, key);
        const msgDecoded = new TextDecoder().decode(msg);
        const msgTransform = {
          message: JSON.parse(msgDecoded) as T,
          index: "index" in input.message ? input.message.index : undefined,
        };
        await this.emit(input.event, {
          ...input,
          message: msgTransform,
        });
      } catch (e) {
        console.error(e);
        return;
      }
    } else {
      const msgTransform = {
        message: input.message.message as T,
        index: "index" in input.message ? input.message.index : undefined,
      };
      await this.emit(input.event, {
        ...input,
        message: msgTransform,
      });
    }
  }
}
/**
 * A member of a presence channel.
 */
export type PresenceMember = Prettify<
  Omit<z.infer<typeof ChannelMemberSchema>, "userInfo"> & { userInfo: UserInfo }
>;

interface DefaultChannelEventMap {
  [countEventSymbol]: { count: number };
}

interface DefaultPresenceChannelEventMap {
  [joinEventSymbol]: PresenceMember[];
  [memberJoinEventSymbol]: PresenceMember;
  [memberLeaveEventSymbol]: PresenceMember;
}
type ChannelEventMap = Prettify<
  DefaultChannelEventMap & RealEventMap & DefaultPresenceChannelEventMap
>;

class ChannelSinker extends Emittery<ChannelEventMap> {
  private _count = 0;
  private _members: PresenceMember[] = [];
  readonly channel: {
    name: string;
    flags: number;
  };

  /**
   * The current count of connected clients to the channel.
   */
  get count(): number {
    return this._count + this._members.length;
  }

  /**
   * The current members of the presence channel.
   *  This is empty if the channel doesn't support presence.
   */
  get members(): PresenceMember[] {
    return [...this._members];
  }

  constructor(
    private root: BrowserSinker,
    channel:
      | string
      | {
          name: string;
          flags: number;
        },
  ) {
    super();
    this.channel = toChannel(channel);
    const unsubCount = this.root.on(countEventSymbol, (data) => {
      if (ceq(this.channel, data.channel)) {
        this._count = data.count;
        void this.emit(countEventSymbol, { count: data.count });
      }
    });
    const unsubEvent = this.root.onAny((eventName, data) => {
      if (typeof eventName === "string" && data) {
        if (
          "from" in data &&
          data.from.source === "channel" &&
          ceq(this.channel, data.from.channel)
        ) {
          void this.emit(eventName, data.message);
        }
      }
    });
    const unsubJoin = this.root.on(joinEventSymbol, (data) => {
      if (ceq(this.channel, data.channel)) {
        this._members = data.members as PresenceMember[];
        void this.emit(joinEventSymbol, this.members);
      }
    });
    const unsubMemberAdd = this.root.on(memberJoinEventSymbol, (data) => {
      if (ceq(this.channel, data.channel)) {
        this._members.push(data.member as PresenceMember);
        void this.emit(memberJoinEventSymbol, data.member as PresenceMember);
      }
    });
    const unsubMemberRemove = this.root.on(memberLeaveEventSymbol, (data) => {
      if (ceq(this.channel, data.channel)) {
        this._members = this._members.filter((m) => m.id !== data.member.id);
        void this.emit(memberLeaveEventSymbol, data.member as PresenceMember);
      }
    });
    const unsubLeave = this.root.on(leaveEventSymbol, () => {
      unsubCount();
      unsubEvent();
      unsubJoin();
      unsubMemberAdd();
      unsubMemberRemove();
      unsubLeave();
    });
  }
}

type ChannelNoEmit = Omit<ChannelSinker, "emit" | "emitSerial">;

/**
 * Global Sinkr client for the browser. Fires all events received.
 */
export type SinkrSink = Prettify<Omit<BrowserSinker, "emit" | "emitSerial">>;
/**
 * A Sinkr channel for the browser. Fires all events received for the specified channel.
 */
export type SinkrChannel = Prettify<ChannelNoEmit>;

/**
 * Sinkr initialization options.
 */
export interface SinkrOptions {
  /**
   * The Sinkr url to connect to.
   */
  url?: string | undefined;
  /**
   * The Sinkr app to use.
   */
  appId?: string | undefined;
}

function withEnvFallback(
  value: string | undefined,
  ...keys: string[]
): string | undefined {
  if (value) {
    return value;
  }
  if (typeof process === "undefined") {
    return undefined;
  }
  for (const key of keys) {
    if (process.env[key]) {
      return process.env[key];
    }
  }
  return undefined;
}

/**
 * Connect to a Sinkr server over websockets.
 * @param options The connection options to use.
 * @returns The connected Sinkr client.
 */
export function sink(options: SinkrOptions | undefined = {}): SinkrSink {
  const url = withEnvFallback(
    options.url,
    "SINKR_URL",
    "NEXT_PUBLIC_SINKR_URL",
    "PUBLIC_SINKR_URL",
  );
  if (!url) {
    throw new Error("Unable to start Sinkr without a url!");
  }
  const appId = withEnvFallback(
    options.appId,
    "SINKR_APP_ID",
    "NEXT_PUBLIC_SINKR_APP_ID",
    "PUBLIC_SINKR_APP_ID",
  );
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
      parsedUrl.protocol = "wss:";
    }
    if (parsedUrl.pathname === "/") {
      if (!appId) {
        throw new Error("No app ID provided for Sinkr!");
      }
      parsedUrl.pathname = `/${appId}`;
    }
    return new BrowserSinker(parsedUrl.toString());
  } catch {
    throw new Error("Invalid URL provided for Sinkr!");
  }
}
