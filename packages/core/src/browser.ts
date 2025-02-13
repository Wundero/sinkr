import type { z } from "zod";
import Emittery from "emittery";

import type {
  ChannelMemberSchema,
  ClientInitSchema,
  ClientJoinChannelSchema,
  ClientLeaveChannelSchema,
  ClientReceiveMessageSchema,
  MemberJoinChannelSchema,
  MemberLeaveChannelSchema,
} from "@sinkr/validators";
import { ClientReceiveSchema } from "@sinkr/validators";

import type { RealEventMap } from "./event-fallback";
import type { UserInfo } from "./types";
import {
  connectSymbol,
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
  [joinEventSymbol]: [z.infer<typeof ClientJoinChannelSchema>, SinkrChannel];
  [leaveEventSymbol]: z.infer<typeof ClientLeaveChannelSchema>;
  [memberJoinEventSymbol]: z.infer<typeof MemberJoinChannelSchema>;
  [memberLeaveEventSymbol]: z.infer<typeof MemberLeaveChannelSchema>;
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

type ChannelMetadata = z.infer<typeof ClientJoinChannelSchema>;

class BrowserSinker extends Emittery<EventMapWithDefaults> {
  private ws: WebSocket | null = null;

  private channelCache = new Map<string, WeakRef<SinkrChannel>>();
  private joinedChannels = new Map<string, WeakRef<ChannelMetadata>>();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(
    private url: string,
    private pingFreq = 0,
  ) {
    super();
  }

  /**
   * Get a sinkr channel by id.
   * @param channelId The channel to listen to. Events will only fire if the current client is subscribed to the channel.
   * @returns The channel object.
   */
  channel(channelId: string): SinkrChannel {
    const cached = this.channelCache.get(channelId)?.deref();
    if (cached) {
      return cached;
    }
    const newChannel = proxyRemoveEmit(
      new ChannelSinker(
        this,
        channelId,
        this.joinedChannels.get(channelId)?.deref(),
      ),
    );
    const ref = new WeakRef(newChannel);
    this.channelCache.set(channelId, ref);
    return newChannel;
  }

  /**
   * Request stored messages to be transmitted to this client.
   * @param channel The channel the messages are stored on.
   * @param messageIds The message id or ids to request.
   */
  requestStoredMessages(
    channel: string | SinkrChannel,
    messageIds: string | string[],
  ) {
    const channelId = typeof channel === "string" ? channel : channel.channelId;
    if (Array.isArray(messageIds)) {
      this.ws?.send(
        JSON.stringify({
          event: "request-stored-messages",
          channelId,
          messageIds,
        }),
      );
    } else {
      this.ws?.send(
        JSON.stringify({
          event: "request-stored-messages",
          channelId,
          messageIds: [messageIds],
        }),
      );
    }
  }

  /**
   * Disconnect from the Sinkr server and clear all listeners.
   */
  disconnect() {
    this.ws?.close();
    this.clearListeners();
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
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
          case "join-channel":
            {
              this.joinedChannels.set(
                data.data.channelId,
                new WeakRef(data.data),
              );
              const channel = new ChannelSinker(
                this,
                data.data.channelId,
                data.data,
              );
              this.channelCache.set(channel.channelId, new WeakRef(channel));
              void this.emit(joinEventSymbol, [data.data, channel]);
            }
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
    if (this.pingFreq > 0) {
      this.pingInterval = setInterval(() => {
        this.ws?.send("ping");
      }, this.pingFreq);
    }
  }

  private async emitMessage<T>(
    input: z.infer<typeof ClientReceiveMessageSchema>,
  ) {
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
/**
 * A member of a presence channel.
 */
export type PresenceMember = Prettify<
  Omit<z.infer<typeof ChannelMemberSchema>, "userInfo"> & {
    userInfo?: UserInfo;
  }
>;

interface DefaultPresenceChannelEventMap {
  [joinEventSymbol]: PresenceMember[];
  [memberJoinEventSymbol]: PresenceMember;
  [memberLeaveEventSymbol]: PresenceMember;
  [leaveEventSymbol]: undefined;
}

type ChannelEventMap = Prettify<RealEventMap & DefaultPresenceChannelEventMap>;

interface ExistingMessage {
  date: Date;
  id: string;
}

class ChannelSinker extends Emittery<ChannelEventMap> {
  private _members: PresenceMember[] = [];
  private _joined: boolean;

  /**
   * The current count of connected clients to the channel.
   */
  get count(): number {
    return this._members.length;
  }

  /**
   * The existing message ids and dates from prior to joining the channel
   */
  get existingMessages(): ExistingMessage[] {
    return this.channelMeta?.channelStoredMessages ?? [];
  }

  /**
   * The current members of the presence channel.
   *  This is empty if the channel doesn't support presence.
   */
  get members(): PresenceMember[] {
    return this._members.slice();
  }

  /**
   * The name of this channel. If the channel has not yet been joined, this returns the channel's ID.
   */
  get name() {
    return this.channelMeta?.channelName ?? this.channelId;
  }

  /**
   * Whether the channel is active.
   */
  get active() {
    return this._joined;
  }

  constructor(
    private root: BrowserSinker,
    readonly channelId: string,
    private channelMeta?: ChannelMetadata,
  ) {
    super();
    this._joined = Boolean(this.channelMeta);
    this._members = (channelMeta?.members ?? []) as PresenceMember[];
    this.root.onAny((eventName, data) => {
      if (typeof eventName === "string" && data) {
        if (
          "from" in data &&
          data.from.source === "channel" &&
          data.from.channelId === this.channelId
        ) {
          void this.emit(eventName, data.message);
        }
      }
    });
    this.root.on(joinEventSymbol, ([data]) => {
      if (data.channelId === this.channelId) {
        this._joined = true;
        this._members = data.members as PresenceMember[];
        this.channelMeta = data;
        void this.emit(joinEventSymbol, this.members);
      }
    });
    this.root.on(memberJoinEventSymbol, (data) => {
      if (data.channelId === this.channelId) {
        this._members.push(data.member as PresenceMember);
        void this.emit(memberJoinEventSymbol, data.member as PresenceMember);
      }
    });
    this.root.on(memberLeaveEventSymbol, (data) => {
      if (data.channelId === this.channelId) {
        this._members = this._members.filter((m) => m.id !== data.member.id);
        void this.emit(memberLeaveEventSymbol, data.member as PresenceMember);
      }
    });
    this.root.on(leaveEventSymbol, (data) => {
      if (data.channelId === this.channelId) {
        this._joined = false;
        void this.emit(leaveEventSymbol);
      }
    });
  }

  /**
   * Request stored messages to be transmitted to this client.
   * @param messageIds The message id or ids to request.
   */
  requestStoredMessages(messageIds: string | string[]) {
    if (!this.existingMessages.length) {
      return;
    }
    this.root.requestStoredMessages(this, messageIds);
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
  /**
   * How often to ping the server to keep the connection alive.
   */
  pingFrequencyMilliseconds?: number | undefined;
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
    return new BrowserSinker(
      parsedUrl.toString(),
      options.pingFrequencyMilliseconds,
    );
  } catch {
    throw new Error("Invalid URL provided for Sinkr!");
  }
}
