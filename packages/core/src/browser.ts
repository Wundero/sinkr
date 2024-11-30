import type { z } from "zod";
import Emittery from "emittery";
import { WebSocket } from "undici";

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

import type { EventMap, UserInfo } from ".";
import {
  connectSymbol,
  countEventSymbol,
  disconnectSymbol,
  initEventSymbol,
  joinEventSymbol,
  leaveEventSymbol,
  memberJoinEventSymbol,
  memberLeaveEventSymbol,
} from ".";

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
  [K in keyof EventMap]: GenericMessageEvent<EventMap[K]>;
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

  constructor(private url: string) {
    super();
  }

  channel(channel: `presence-${string}`): PresenceChannel;
  channel(channel: string): Channel;
  channel(channel: string) {
    if (channel.startsWith("presence-")) {
      return proxyRemoveEmit(new PresenceSinker(this, channel));
    }
    return proxyRemoveEmit(new ChannelSinker(this, channel));
  }

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

type ChannelEventMap = Prettify<DefaultChannelEventMap & EventMap>;

class ChannelSinker extends Emittery<ChannelEventMap> {
  private _count = 0;

  get count() {
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

export type PresenceMember = Prettify<
  Omit<z.infer<typeof ChannelMemberSchema>, "userInfo"> & { userInfo: UserInfo }
>;

interface DefaultPresenceChannelEventMap {
  [joinEventSymbol]: PresenceMember[];
  [memberJoinEventSymbol]: PresenceMember;
  [memberLeaveEventSymbol]: PresenceMember;
}

type PresenceChannelEventMap = Prettify<
  DefaultPresenceChannelEventMap & EventMap
>;

class PresenceSinker extends Emittery<PresenceChannelEventMap> {
  private _members: PresenceMember[] = [];

  get members() {
    return [...this._members];
  }

  get memberCount() {
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

export type Sinker = Prettify<Omit<BrowserSinker, "emit" | "emitSerial">>;
export type Channel = Prettify<ChannelNoEmit>;
export type PresenceChannel = Prettify<PresenceNoEmit>;

export interface SinkOptions {
  url?: string;
  appId?: string;
}

export function sink(options: SinkOptions = {}): Sinker {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const url = options.url ?? process.env.SINKR_URL;
  if (!url) {
    throw new Error("Unable to start Sinkr without a url!");
  }
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const appId = options.appId ?? process.env.SINKR_APP_ID;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "ws" && parsedUrl.protocol !== "wss") {
      throw new Error("Invalid URL provided for Sinkr!");
    }
    if (parsedUrl.pathname === "/") {
      parsedUrl.pathname = `/${appId}`;
    }
    return new BrowserSinker(parsedUrl.toString());
  } catch {
    throw new Error("Invalid URL provided for Sinkr!");
  }
}
