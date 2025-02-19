import type { MessageEvent } from "undici";
import type { z } from "zod";
import { fetch, WebSocket } from "undici";

import type {
  MessageTypeSchema,
  RouteRequestSchema,
  RouteResponseSchema,
  ServerRoute,
} from "@sinkr/validators";
import {
  ServerResponseSchema,
  SINKR_SCHEMA_HEADER,
  SINKR_SCHEMA_VERSION,
} from "@sinkr/validators";

import type { RealEventMap } from "./event-fallback";
import type { UserInfo } from "./types";

interface OmitSuccess<TRoute extends ServerRoute> {
  route: TRoute;
  response: Exclude<RouteResponseSchema<TRoute>["response"], { success: true }>;
}

function unknownAsyncIterableToReadableStream<T>(
  input: AsyncIterable<T>,
): ReadableStream<T> {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const message of input) {
          controller.enqueue(message);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

function unknownIterableToReadableStream<T>(
  input: Iterable<T>,
): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      try {
        for (const message of input) {
          controller.enqueue(message);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

type ReadableInput<T> = Iterable<T> | AsyncIterable<T>;

function isIterable<T>(input: unknown): input is Iterable<T> {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  return (
    Symbol.iterator in input &&
    typeof (input as Iterable<T>)[Symbol.iterator] === "function"
  );
}

function isAsyncIterable<T>(input: unknown): input is AsyncIterable<T> {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  return (
    Symbol.asyncIterator in input &&
    typeof (input as AsyncIterable<T>)[Symbol.asyncIterator] === "function"
  );
}

function toReadableStream<T>(input: ReadableInput<T>): ReadableStream<T> {
  if (input instanceof ReadableStream) {
    return input;
  }
  if ("from" in ReadableStream) {
    // @ts-expect-error Types for ReadableStream are incomplete
    return ReadableStream.from(input) as ReadableStream<T>;
  }
  if (isAsyncIterable(input)) {
    return unknownAsyncIterableToReadableStream(input);
  }
  if (isIterable(input)) {
    return unknownIterableToReadableStream(input);
  }
  return input;
}

function prepareStream<TOut>(
  shapeFn: (message: z.infer<typeof MessageTypeSchema>) => TOut,
  stream: ReadableStream<unknown>,
) {
  let index = 0;
  const transformer = new TransformStream<unknown, TOut>({
    transform(chunk, controller) {
      controller.enqueue(shapeFn(getMessageContent(chunk, index)));
      index++;
    },
  });
  return stream.pipeThrough(transformer);
}

function getMessageContent(
  data: unknown,
  index?: number,
): z.infer<typeof MessageTypeSchema> {
  if (index !== undefined) {
    return {
      type: "chunk",
      index,
      message: data,
    };
  }
  return {
    type: "plain",
    message: data,
  };
}

class Source {
  private url: URL;
  private wsUrl: URL;

  private wsClient?: WebSocket;

  constructor(
    url: string,
    private appKey: string,
    appId?: string,
  ) {
    const parsedUrl = new URL(url);
    if (parsedUrl.pathname === "/" && appId) {
      parsedUrl.pathname = `/${appId}`;
    }
    parsedUrl.protocol = "https:";
    if (parsedUrl.pathname === "/") {
      throw new Error("Invalid URL provided for Sourcerer!");
    }
    this.url = parsedUrl;
    this.wsUrl = new URL(parsedUrl.toString());
    this.wsUrl.protocol = "wss:";
    this.wsUrl.searchParams.set("appKey", this.appKey);
  }

  private async connectWS() {
    if (this.wsClient) {
      return this.wsClient;
    }
    this.wsClient = new WebSocket(this.wsUrl.toString());
    await new Promise((res) => {
      this.wsClient?.addEventListener("open", () => {
        this.wsClient?.send(`${SINKR_SCHEMA_HEADER}${SINKR_SCHEMA_VERSION}`);
        res(true);
      });
      this.wsClient?.addEventListener("close", () => {
        this.wsClient = undefined;
      });
    });
    return this.wsClient;
  }

  async sendData<TRoute extends ServerRoute>(
    route: TRoute,
    data: RouteRequestSchema<TRoute>["request"],
  ): Promise<RouteResponseSchema<TRoute>>;
  async sendData<TRoute extends ServerRoute>(
    route: TRoute,
    data: RouteRequestSchema<TRoute>["request"] extends { message: unknown }
      ? Omit<RouteRequestSchema<TRoute>["request"], "message">
      : RouteRequestSchema<TRoute>["request"],
    iterable: ReadableInput<unknown>,
  ): Promise<RouteResponseSchema<TRoute>[]>;
  async sendData<TRoute extends ServerRoute>(
    route: TRoute,
    data: RouteRequestSchema<TRoute>["request"],
    iterable?: ReadableInput<unknown>,
  ) {
    if (iterable) {
      const stream = toReadableStream(iterable);
      const encodedStream = prepareStream(
        (message) => ({
          route,
          request: {
            ...data,
            message,
          },
        }),
        stream,
      );
      const ws = await this.connectWS();
      const reader = encodedStream.getReader();
      const statuses = new Map<string, RouteResponseSchema<TRoute>>();
      const ids: string[] = [];
      const onMsg = (ev: MessageEvent) => {
        const data = JSON.parse(ev.data as string) as {
          id: string;
        };
        const parsed = ServerResponseSchema.safeParse(data);
        if (ids.includes(data.id) && parsed.success) {
          statuses.set(data.id, parsed.data);
        }
        return;
      };
      ws.addEventListener("message", onMsg);
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          ws.removeEventListener("message", onMsg);
          return ids.map(
            (id) =>
              statuses.get(id) ?? {
                success: false,
                error: "Unknown error",
              },
          );
        }
        const id = crypto.randomUUID();
        ids.push(id);
        ws.send(
          JSON.stringify({
            data: value,
            id,
          }),
        );
      }
    } else {
      const id = crypto.randomUUID();
      if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
        return new Promise<RouteResponseSchema<TRoute>>((res) => {
          const onMsg = (ev: MessageEvent) => {
            const data = JSON.parse(ev.data as string) as {
              id: string;
            };
            const parsed = ServerResponseSchema.safeParse(data);
            if (data.id === id && parsed.success) {
              this.wsClient?.removeEventListener("message", onMsg);
              res(parsed.data);
            }
          };
          this.wsClient?.addEventListener("message", onMsg);
          this.wsClient?.send(
            JSON.stringify({
              data,
              id,
            }),
          );
        });
      }
      const res = await fetch(this.url, {
        method: "POST",
        body: JSON.stringify({ data, id }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.appKey}`,
          [SINKR_SCHEMA_HEADER]: `${SINKR_SCHEMA_VERSION}`,
        },
      });
      const dataOut = await res.json();
      const parsed = ServerResponseSchema.safeParse(dataOut);
      if (parsed.success) {
        return parsed.data;
      }
      return {
        success: false,
        error: "Unknown error",
      };
    }
  }
}

class SinkrChannel {
  constructor(
    private source: Source,
    readonly channelId: string,
  ) {}

  /**
   * Delete this channel.
   * @returns The HTTP status code Sinkr returned.
   */
  async delete(): Promise<RouteResponseSchema<"channel.delete">> {
    return await this.source.sendData("channel.delete", {
      channelId: this.channelId,
    });
  }

  /**
   * Delete stored messages for this channel.
   * @param messageIds The ids of the messages to delete. Undefined or an empty array will delete **all** messages.
   * @returns The HTTP status code Sinkr returned.
   */
  async deleteMessages(
    messageIds?: string[],
  ): Promise<RouteResponseSchema<"channel.messages.delete">> {
    return await this.source.sendData("channel.messages.delete", {
      channelId: this.channelId,
      messageIds,
    });
  }

  /**
   * Subscribe a user to this channel. Requires authentication to subscribe to private and presence channels.
   * @param userId The ID to subscribe. This can either be a peer ID or, for authenticated users, the user ID.
   * @returns The HTTP status code Sinkr returned.
   */
  async subscribe(
    userId: string,
  ): Promise<RouteResponseSchema<"channel.subscribers.add">> {
    return await this.source.sendData("channel.subscribers.add", {
      subscriberId: userId,
      channelId: this.channelId,
    });
  }

  /**
   * Unsubscribe a user from this channel.
   * @param userId The ID to unsubscribe. This can either be a peer ID or, for authenticated users, the user ID.
   * @returns The HTTP status code Sinkr returned.
   */
  async unsubscribe(
    userId: string,
  ): Promise<RouteResponseSchema<"channel.subscribers.remove">> {
    return await this.source.sendData("channel.subscribers.remove", {
      subscriberId: userId,
      channelId: this.channelId,
    });
  }

  /**
   * Send a message to this channel.
   * @param event The event to send.
   * @param message The data for that event to send.
   * @returns The HTTP status code Sinkr returned.
   */
  async sendMessage<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    event: TEvent,
    message: TData,
  ): Promise<RouteResponseSchema<"channel.messages.send">> {
    return await this.source.sendData("channel.messages.send", {
      channelId: this.channelId,
      event: `${event}`,
      message: getMessageContent(message),
    });
  }

  /**
   * Stream messages to this channel.
   * @param event The event to send.
   * @param data A stream of data to send. Each chunk should be one message. Note that order of delivery is not guaranteed.
   * @returns The HTTP status code Sinkr returned. The function may return before the stream is finished.
   */
  async streamMessages<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    event: TEvent,
    data: ReadableInput<TData>,
  ): Promise<RouteResponseSchema<"channel.messages.send">[]> {
    return await this.source.sendData(
      "channel.messages.send",
      {
        channelId: this.channelId,
        event: `${event}`,
      },
      data,
    );
  }
}

class SinkrSource {
  constructor(private source: Source) {}

  /**
   * Authenticate a user with Sinkr to allow them to use private and presence channels.
   * @param peerId The Peer ID of the connection for the user.
   * @param userInfo The user's information.
   * @returns The HTTP status code Sinkr returned.
   */
  async authenticateUser(
    peerId: string,
    userInfo: {
      id: string;
      userInfo: UserInfo;
    },
  ): Promise<RouteResponseSchema<"user.authenticate">> {
    return await this.source.sendData("user.authenticate", {
      id: userInfo.id,
      peerId,
      userInfo: userInfo.userInfo,
    });
  }

  /**
   * Create a new channel.
   * @param name The name of the channel.
   * @param authMode The authentication mode of the channel. Private and presence channels require user authentication.
   * @param storeMessages Whether to store messages in the database.
   * @returns The HTTP status code Sinkr returned if an error occured, otherwise a SinkrChannel object.
   */
  async createChannel(
    name: string,
    authMode: "public" | "private" | "presence",
    storeMessages = false,
  ): Promise<OmitSuccess<"channel.create"> | SinkrChannel> {
    const res = await this.source.sendData("channel.create", {
      authMode,
      storeMessages,
      name,
    });
    if (res.response.success) {
      return new SinkrChannel(this.source, res.response.channelId);
    }
    return res as OmitSuccess<"channel.create">;
  }

  /**
   * Delete a channel.
   * @param channel The channel to delete.
   * @returns The HTTP status code Sinkr returned.
   */
  async deleteChannel(
    channel: string | SinkrChannel,
  ): Promise<RouteResponseSchema<"channel.delete">> {
    if (channel instanceof SinkrChannel) {
      return channel.delete();
    }
    return await this.source.sendData("channel.delete", {
      channelId: channel,
    });
  }

  /**
   * Delete stored messages for a channel.
   * @param channel The channel to delete messages from.
   * @param messageIds The ids of the messages to delete. Undefined or an empty array will delete **all** messages.
   * @returns The HTTP status code Sinkr returned.
   */
  async deleteChannelMessages(
    channel: string | SinkrChannel,
    messageIds?: string[],
  ): Promise<RouteResponseSchema<"channel.messages.delete">> {
    if (channel instanceof SinkrChannel) {
      return channel.deleteMessages(messageIds);
    }
    return await this.source.sendData("channel.messages.delete", {
      channelId: channel,
      messageIds,
    });
  }

  /**
   * Subscribe a user to a channel. Requires authentication to subscribe to private and presence channels.
   * @param userId The ID to subscribe. This can either be a peer ID or, for authenticated users, the user ID.
   * @param channel The channel to subscribe to.
   * @returns The HTTP status code Sinkr returned.
   */
  async subscribeToChannel(
    userId: string,
    channel: string | SinkrChannel,
  ): Promise<RouteResponseSchema<"channel.subscribers.add">> {
    if (channel instanceof SinkrChannel) {
      return channel.subscribe(userId);
    }
    return await this.source.sendData("channel.subscribers.add", {
      subscriberId: userId,
      channelId: channel,
    });
  }

  /**
   * Unsubscribe a user from a channel.
   * @param userId The ID to unsubscribe. This can either be a peer ID or, for authenticated users, the user ID.
   * @param channel The channel to unsubscribe from.
   * @returns The HTTP status code Sinkr returned.
   */
  async unsubscribeFromChannel(
    userId: string,
    channel: string | SinkrChannel,
  ): Promise<RouteResponseSchema<"channel.subscribers.remove">> {
    if (channel instanceof SinkrChannel) {
      return channel.unsubscribe(userId);
    }
    return await this.source.sendData("channel.subscribers.remove", {
      subscriberId: userId,
      channelId: channel,
    });
  }

  /**
   * Send a message to a channel.
   * @param channel The channel to send the message to.
   * @param event The event to send.
   * @param message The data for that event to send.
   * @returns The HTTP status code Sinkr returned.
   */
  async sendToChannel<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    channel: string | SinkrChannel,
    event: TEvent,
    message: TData,
  ): Promise<RouteResponseSchema<"channel.messages.send">> {
    if (channel instanceof SinkrChannel) {
      return channel.sendMessage(event, message);
    }
    return await this.source.sendData("channel.messages.send", {
      channelId: channel,
      event: `${event}`,
      message: getMessageContent(message),
    });
  }

  /**
   * Stream messages to a channel.
   * @param channel The channel to send the messages to.
   * @param event The event to send.
   * @param data A stream of data to send. Each chunk should be one message. Note that order of delivery is not guaranteed.
   * @returns The HTTP status code Sinkr returned. The function may return before the stream is finished.
   */
  async streamToChannel<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    channel: string | SinkrChannel,
    event: TEvent,
    data: ReadableInput<TData>,
  ): Promise<RouteResponseSchema<"channel.messages.send">[]> {
    if (channel instanceof SinkrChannel) {
      return channel.streamMessages(event, data);
    }
    return await this.source.sendData(
      "channel.messages.send",
      {
        channelId: channel,
        event: `${event}`,
      },
      data,
    );
  }

  /**
   * Send a message directly to a user.
   * @param userId The ID of the user to send the message to. This can be a peer ID or, for authenticated users, the user ID.
   * @param event The event to send.
   * @param message The data for that event to send.
   * @returns The HTTP status code Sinkr returned.
   */
  async directMessage<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    userId: string,
    event: TEvent,
    message: TData,
  ): Promise<RouteResponseSchema<"user.messages.send">> {
    return await this.source.sendData("user.messages.send", {
      recipientId: userId,
      event: `${event}`,
      message: getMessageContent(message),
    });
  }

  /**
   * Stream messages directly to a user.
   * @param userId The ID of the user to send the message to. This can be a peer ID or, for authenticated users, the user ID.
   * @param event The event to send.
   * @param data The stream of data to send. Each chunk should be one message. Note that order of delivery is not guaranteed.
   * @returns The HTTP status code Sinkr returned. The function may return before the stream is finished.
   */
  async streamDirectMessage<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    userId: string,
    event: TEvent,
    data: ReadableInput<TData>,
  ): Promise<RouteResponseSchema<"user.messages.send">[]> {
    return await this.source.sendData(
      "user.messages.send",
      {
        recipientId: userId,
        event: `${event}`,
      },
      data,
    );
  }

  /**
   * Broadcast a message to all connected clients.
   * @param event The event to send.
   * @param message The data for that event to send.
   * @returns The HTTP status code Sinkr returned.
   */
  async broadcastMessage<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    event: TEvent,
    message: TData,
  ): Promise<RouteResponseSchema<"global.messages.send">> {
    return await this.source.sendData("global.messages.send", {
      event: `${event}`,
      message: getMessageContent(message),
    });
  }

  /**
   * Broadcast a stream of messages to all connected clients.
   * @param event The event to send.
   * @param data The stream of data to send. Each chunk should be one message. Note that order of delivery is not guaranteed.
   * @returns The HTTP status code Sinkr returned. The function may return before the stream is finished.
   */
  async streamBroadcastMessage<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    event: TEvent,
    data: ReadableInput<TData>,
  ): Promise<RouteResponseSchema<"global.messages.send">[]> {
    return await this.source.sendData(
      "global.messages.send",
      {
        event: `${event}`,
      },
      data,
    );
  }
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
 * Create a Sinkr source to send messages.
 * @param options The connection options. Will fall back to env vars if not provided.
 * @returns The Sinkr source.
 * @throws If no URL or app key is provided.
 */
export function source({
  url,
  appKey,
  appId,
}:
  | {
      url?: string | undefined;
      appKey?: string | undefined;
      appId?: string | undefined;
    }
  | undefined = {}): SinkrSource {
  url = withEnvFallback(
    url,
    "SINKR_URL",
    "NEXT_PUBLIC_SINKR_URL",
    "PUBLIC_SINKR_URL",
  );
  appKey = withEnvFallback(appKey, "SINKR_APP_KEY");
  appId = withEnvFallback(
    appId,
    "SINKR_APP_ID",
    "NEXT_PUBLIC_SINKR_APP_ID",
    "PUBLIC_SINKR_APP_ID",
  );
  if (!url) {
    throw new Error("Unable to start Sourcerer without a url!");
  }
  if (!appKey) {
    throw new Error("Unable to start Sourcerer without an app key!");
  }
  const src = new Source(url, appKey, appId);
  return new SinkrSource(src);
}
