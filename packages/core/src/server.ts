import type { MessageEvent } from "undici";
import type { z } from "zod";
import { fetch, WebSocket } from "undici";

import type {
  MessageTypeSchema,
  ServerEndpointSchema,
} from "@sinkr/validators";

import type { RealEventMap } from "./event-fallback";
import type { UserInfo } from "./types";

type SendDataParam = z.infer<typeof ServerEndpointSchema>;

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

function prepareStream(shape: object, stream: ReadableStream<unknown>) {
  let index = 0;
  const transformer = new TransformStream<unknown, object>({
    transform(chunk, controller) {
      controller.enqueue({
        ...shape,
        message: getMessageContent(chunk, index),
      });
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
    this.wsClient ??= new WebSocket(this.wsUrl.toString());
    await new Promise((res) => {
      this.wsClient?.addEventListener("open", res);
    });
    this.wsClient.addEventListener("close", () => {
      this.wsClient = undefined;
    });
    return this.wsClient;
  }

  async sendData<TData extends SendDataParam>(
    data: TData,
  ): Promise<{
    status: number;
    data?: unknown;
  }>;
  async sendData<TData extends SendDataParam>(
    data: TData extends { message: unknown } ? Omit<TData, "message"> : TData,
    iterable: ReadableInput<unknown>,
  ): Promise<
    {
      status: number;
      data?: unknown;
    }[]
  >;
  async sendData<TData extends SendDataParam>(
    data: TData,
    iterable?: ReadableInput<unknown>,
  ) {
    if (iterable) {
      const stream = toReadableStream(iterable);
      const encodedStream = prepareStream(data, stream);
      const ws = await this.connectWS();
      const reader = encodedStream.getReader();
      const statuses = new Map<
        string,
        {
          status: number;
          data?: unknown;
        }
      >();
      const ids: string[] = [];
      const onMsg = (ev: MessageEvent) => {
        const data = JSON.parse(ev.data as string) as {
          status: number;
          id: string;
          data?: unknown;
        };
        if (ids.includes(data.id)) {
          statuses.set(data.id, data);
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
                status: 500,
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
        return new Promise<{
          status: number;
          data?: unknown;
        }>((res) => {
          const onMsg = (ev: MessageEvent) => {
            const data = JSON.parse(ev.data as string) as {
              status: number;
              id: string;
              data?: unknown;
            };
            if (data.id === id) {
              this.wsClient?.removeEventListener("message", onMsg);
              res(data);
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
        },
      });
      const dataOut = (await res.json()) as {
        status: number;
        data?: unknown;
      };
      return dataOut;
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
  async delete(): Promise<number> {
    return (
      await this.source.sendData({
        route: "deleteChannel",
        channelId: this.channelId,
      })
    ).status;
  }

  /**
   * Delete stored messages for this channel.
   * @param messageIds The ids of the messages to delete. Undefined or an empty array will delete **all** messages.
   * @returns The HTTP status code Sinkr returned.
   */
  async deleteMessages(messageIds?: string[]): Promise<number> {
    return (
      await this.source.sendData({
        route: "deleteMessages",
        channelId: this.channelId,
        messageIds,
      })
    ).status;
  }

  /**
   * Subscribe a user to this channel. Requires authentication to subscribe to private and presence channels.
   * @param userId The ID to subscribe. This can either be a peer ID or, for authenticated users, the user ID.
   * @returns The HTTP status code Sinkr returned.
   */
  async subscribe(userId: string): Promise<number> {
    return (
      await this.source.sendData({
        route: "subscribe",
        subscriberId: userId,
        channelId: this.channelId,
      })
    ).status;
  }

  /**
   * Unsubscribe a user from this channel.
   * @param userId The ID to unsubscribe. This can either be a peer ID or, for authenticated users, the user ID.
   * @returns The HTTP status code Sinkr returned.
   */
  async unsubscribe(userId: string): Promise<number> {
    return (
      await this.source.sendData({
        route: "unsubscribe",
        subscriberId: userId,
        channelId: this.channelId,
      })
    ).status;
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
  >(event: TEvent, message: TData): Promise<number> {
    return (
      await this.source.sendData({
        route: "channel",
        channelId: this.channelId,
        event: `${event}`,
        message: getMessageContent(message),
      })
    ).status;
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
  >(event: TEvent, data: ReadableInput<TData>): Promise<number[]> {
    return (
      await this.source.sendData(
        {
          route: "channel",
          channelId: this.channelId,
          event: `${event}`,
        },
        data,
      )
    ).map((x) => x.status);
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
  ): Promise<number> {
    return (
      await this.source.sendData({
        route: "authenticate",
        id: userInfo.id,
        peerId,
        userInfo: userInfo.userInfo,
      })
    ).status;
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
  ): Promise<number | SinkrChannel> {
    const res = await this.source.sendData({
      route: "createChannel",
      authMode,
      storeMessages,
      name,
    });
    if (res.status !== 200) {
      return res.status;
    }
    if (!res.data) {
      return 500;
    }
    const cid = res.data as string;
    return new SinkrChannel(this.source, cid);
  }

  /**
   * Delete a channel.
   * @param channel The channel to delete.
   * @returns The HTTP status code Sinkr returned.
   */
  async deleteChannel(channel: string | SinkrChannel): Promise<number> {
    if (channel instanceof SinkrChannel) {
      return channel.delete();
    }
    return (
      await this.source.sendData({
        route: "deleteChannel",
        channelId: channel,
      })
    ).status;
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
  ): Promise<number> {
    if (channel instanceof SinkrChannel) {
      return channel.deleteMessages(messageIds);
    }
    return (
      await this.source.sendData({
        route: "deleteMessages",
        channelId: channel,
        messageIds,
      })
    ).status;
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
  ): Promise<number> {
    if (channel instanceof SinkrChannel) {
      return channel.subscribe(userId);
    }
    return (
      await this.source.sendData({
        route: "subscribe",
        subscriberId: userId,
        channelId: channel,
      })
    ).status;
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
  ): Promise<number> {
    if (channel instanceof SinkrChannel) {
      return channel.unsubscribe(userId);
    }
    return (
      await this.source.sendData({
        route: "unsubscribe",
        subscriberId: userId,
        channelId: channel,
      })
    ).status;
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
  ): Promise<number> {
    if (channel instanceof SinkrChannel) {
      return channel.sendMessage(event, message);
    }
    return (
      await this.source.sendData({
        route: "channel",
        channelId: channel,
        event: `${event}`,
        message: getMessageContent(message),
      })
    ).status;
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
  ): Promise<number[]> {
    if (channel instanceof SinkrChannel) {
      return channel.streamMessages(event, data);
    }
    return (
      await this.source.sendData(
        {
          route: "channel",
          channelId: channel,
          event: `${event}`,
        },
        data,
      )
    ).map((x) => x.status);
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
  >(userId: string, event: TEvent, message: TData): Promise<number> {
    return (
      await this.source.sendData({
        route: "direct",
        recipientId: userId,
        event: `${event}`,
        message: getMessageContent(message),
      })
    ).status;
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
  ): Promise<number[]> {
    return (
      await this.source.sendData(
        {
          route: "direct",
          recipientId: userId,
          event: `${event}`,
        },
        data,
      )
    ).map((r) => r.status);
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
  >(event: TEvent, message: TData): Promise<number> {
    return (
      await this.source.sendData({
        route: "broadcast",
        event: `${event}`,
        message: getMessageContent(message),
      })
    ).status;
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
  >(event: TEvent, data: ReadableInput<TData>): Promise<number[]> {
    return (
      await this.source.sendData(
        {
          route: "broadcast",
          event: `${event}`,
        },
        data,
      )
    ).map((r) => r.status);
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
