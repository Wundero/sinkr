/* eslint-disable turbo/no-undeclared-env-vars */
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
import { ClientReceiveSchema } from "@sinkr/validators";

import type { RealEventMap } from "./event-fallback";
import type { UserInfo } from "./index";
import {
  connectSymbol,
  countEventSymbol,
  disconnectSymbol,
  initEventSymbol,
  joinEventSymbol,
  leaveEventSymbol,
  memberJoinEventSymbol,
  memberLeaveEventSymbol,
} from "./index";

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
  Omit<z.infer<typeof ClientReceiveMessageSchema>, "message"> & { message: T }
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

class BrowserSinker extends Emittery<EventMapWithDefaults> {
  private ws: WebSocket | null = null;

  private channelCache = new Map<string, WeakRef<Channel | PresenceChannel>>();

  constructor(private url: string) {
    super();
  }

  /**
   * Get a sinkr channel by name. If a presence channel is specified, alternative types and messages will be available.
   * @param channel The channel to listen to. Events will only fire if the current client is subscribed to the channel.
   */
  channel(channel: `presence-${string}`): PresenceChannel;
  channel(channel: string): Channel;
  channel(channel: string) {
    const cached = this.channelCache.get(channel)?.deref();
    if (cached) {
      return cached;
    }
    if (channel.startsWith("presence-")) {
      const newChannel = proxyRemoveEmit(new PresenceSinker(this, channel));
      const ref = new WeakRef(newChannel);
      this.channelCache.set(channel, ref);
      return newChannel;
    }
    const newChannel = proxyRemoveEmit(new ChannelSinker(this, channel));
    const ref = new WeakRef(newChannel);
    this.channelCache.set(channel, ref);
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
      const parsed = ClientReceiveSchema.safeParse(dat);
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
        void this.emit(
          data.data.event,
          data.data as unknown as GenericMessageEvent<unknown>,
        );
      }
    });
    this.ws.addEventListener("close", () => {
      void this.emit(disconnectSymbol);
      this.ws = null;
    });
  }
}

interface DefaultChannelEventMap {
  [countEventSymbol]: { count: number };
}

type ChannelEventMap = Prettify<DefaultChannelEventMap & RealEventMap>;

class ChannelSinker extends Emittery<ChannelEventMap> {
  private _count = 0;

  /**
   * The current count of connected clients to the channel.
   */
  get count(): number {
    return this._count;
  }

  constructor(
    private root: BrowserSinker,
    readonly channel: string,
  ) {
    super();
    const unsubCount = this.root.on(countEventSymbol, (data) => {
      if (data.channel === this.channel) {
        this._count = data.count;
        void this.emit(countEventSymbol, { count: data.count });
      }
    });
    const unsubEvent = this.root.onAny((eventName, data) => {
      if (typeof eventName === "string" && data) {
        if (
          "from" in data &&
          data.from.source === "channel" &&
          data.from.channel === this.channel
        ) {
          void this.emit(eventName, data.message);
        }
      }
    });
    const unsubLeave = this.root.on(leaveEventSymbol, () => {
      unsubCount();
      unsubEvent();
      unsubLeave();
    });
  }
}

type ChannelNoEmit = Omit<ChannelSinker, "emit" | "emitSerial">;

/**
 * A member of a presence channel.
 */
export type PresenceMember = Prettify<
  Omit<z.infer<typeof ChannelMemberSchema>, "userInfo"> & { userInfo: UserInfo }
>;

interface DefaultPresenceChannelEventMap {
  [joinEventSymbol]: PresenceMember[];
  [memberJoinEventSymbol]: PresenceMember;
  [memberLeaveEventSymbol]: PresenceMember;
}

type PresenceChannelEventMap = Prettify<
  DefaultPresenceChannelEventMap & RealEventMap
>;

class PresenceSinker extends Emittery<PresenceChannelEventMap> {
  private _members: PresenceMember[] = [];

  /**
   * The current members of the presence channel.
   */
  get members(): PresenceMember[] {
    return [...this._members];
  }

  /**
   * The current count of members in the presence channel.
   */
  get memberCount(): number {
    return this._members.length;
  }

  constructor(
    private root: BrowserSinker,
    readonly channel: string,
  ) {
    super();
    const unsubJoin = this.root.on(joinEventSymbol, (data) => {
      if (data.channel === this.channel) {
        this._members = data.members as PresenceMember[];
        void this.emit(joinEventSymbol, this.members);
      }
    });
    const unsubMemberAdd = this.root.on(memberJoinEventSymbol, (data) => {
      if (data.channel === this.channel) {
        this._members.push(data.member as PresenceMember);
        void this.emit(memberJoinEventSymbol, data.member as PresenceMember);
      }
    });
    const unsubMemberRemove = this.root.on(memberLeaveEventSymbol, (data) => {
      if (data.channel === this.channel) {
        this._members = this._members.filter((m) => m.id !== data.member.id);
        void this.emit(memberLeaveEventSymbol, data.member as PresenceMember);
      }
    });
    const unsubEvent = this.root.onAny((eventName, data) => {
      if (typeof eventName === "string" && data) {
        if (
          "from" in data &&
          data.from.source === "channel" &&
          data.from.channel === this.channel
        ) {
          void this.emit(eventName, data.message);
        }
      }
    });
    const unsubLeave = this.root.on(leaveEventSymbol, () => {
      unsubJoin();
      unsubEvent();
      unsubMemberAdd();
      unsubMemberRemove();
      unsubLeave();
    });
  }
}

type PresenceNoEmit = Omit<PresenceSinker, "emit" | "emitSerial">;

/**
 * Global Sinkr client for the browser. Fires all events received.
 */
export type Sinker = Prettify<Omit<BrowserSinker, "emit" | "emitSerial">>;
/**
 * A Sinkr channel for the browser. Fires all events received for the specified channel.
 */
export type Channel = Prettify<ChannelNoEmit>;
/**
 * A Sinkr presence channel for the browser. Fires all events received for the specified presence channel.
 */
export type PresenceChannel = Prettify<PresenceNoEmit>;

/**
 * Sinkr initialization options.
 */
export interface SinkOptions {
  /**
   * The Sinkr url to connect to.
   */
  url?: string;
  /**
   * The Sinkr app to use.
   */
  appId?: string;
}

/**
 * Connect to a Sinkr server over websockets.
 * @param options The connection options to use.
 * @returns The connected Sinkr client.
 */
export function sink(options: SinkOptions = {}): Sinker {
  const url = options.url ?? process.env.SINKR_URL;
  if (!url) {
    throw new Error("Unable to start Sinkr without a url!");
  }
  const appId = options.appId ?? process.env.SINKR_APP_ID;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
      parsedUrl.protocol = "wss:";
    }
    if (parsedUrl.pathname === "/") {
      parsedUrl.pathname = `/${appId}`;
    }
    return new BrowserSinker(parsedUrl.toString());
  } catch {
    throw new Error("Invalid URL provided for Sinkr!");
  }
}
