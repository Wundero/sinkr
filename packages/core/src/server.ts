import type { MessageEvent } from "undici";
import type { z } from "zod";
import { fetch, WebSocket } from "undici";

import type {
  MessageTypeSchema,
  ServerEndpointSchema,
} from "@sinkr/validators";

import type { RealEventMap } from "./event-fallback";
import type { EncryptionInput, UserInfo } from "./types";
import { encrypt, importUnknownJWK } from "./crypto";

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

function prepareStream(
  shape: object,
  stream: ReadableStream<unknown>,
  key?: EncryptionInput,
) {
  let index = 0;
  const transformer = new TransformStream<unknown, object>({
    async transform(chunk, controller) {
      controller.enqueue({
        ...shape,
        message: await getMessageContent(chunk, key, index),
      });
      index++;
    },
  });
  return stream.pipeThrough(transformer);
}

async function getMessageContent(
  data: unknown,
  keyData: EncryptionInput | undefined,
  index?: number,
): Promise<z.infer<typeof MessageTypeSchema>> {
  if (!keyData) {
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
  try {
    const imported = await importUnknownJWK(keyData.key);
    const stringified = JSON.stringify(data);
    const encoded = new TextEncoder().encode(stringified);
    const ciphertext = await encrypt(encoded, imported);
    if (index !== undefined) {
      return {
        type: "encrypted-chunk",
        index,
        ciphertext: ciphertext,
        keyId: keyData.keyId,
      };
    }
    return {
      type: "encrypted",
      ciphertext: ciphertext,
      keyId: keyData.keyId,
    };
  } catch (e) {
    console.error(e);
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
}

class SinkrSource {
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

  private async sendData<TData extends SendDataParam>(
    data: TData,
  ): Promise<number>;
  private async sendData<TData extends SendDataParam>(
    data: TData extends { message: unknown } ? Omit<TData, "message"> : TData,
    iterable: ReadableInput<unknown>,
    key?: EncryptionInput,
  ): Promise<number[]>;
  private async sendData<TData extends SendDataParam>(
    data: TData,
    iterable?: ReadableInput<unknown>,
    key?: EncryptionInput,
  ) {
    if (iterable) {
      const stream = toReadableStream(iterable);
      const encodedStream = prepareStream(data, stream, key);
      const ws = await this.connectWS();
      const reader = encodedStream.getReader();
      const statuses = new Map<string, number>();
      const ids: string[] = [];
      const onMsg = (ev: MessageEvent) => {
        const data = JSON.parse(ev.data as string) as {
          status: number;
          id: string;
          error?: string;
        };
        if (ids.includes(data.id)) {
          statuses.set(data.id, data.status);
        }
        return;
      };
      ws.addEventListener("message", onMsg);
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          ws.removeEventListener("message", onMsg);
          return ids.map((id) => statuses.get(id) ?? 500);
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
        return new Promise<number>((res) => {
          const onMsg = (ev: MessageEvent) => {
            const data = JSON.parse(ev.data as string) as {
              status: number;
              id: string;
              error?: string;
            };
            if (data.id === id) {
              this.wsClient?.removeEventListener("message", onMsg);
              res(data.status);
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
      return res.status;
    }
  }

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
    return await this.sendData({
      route: "authenticate",
      id: userInfo.id,
      peerId,
      userInfo: userInfo.userInfo,
    });
  }

  /**
   * Subscribe a user to a channel. Requires authentication to subscribe to private and presence channels.
   * @param userId The ID to subscribe. This can either be a peer ID or, for authenticated users, the user ID.
   * @param channel The channel to subscribe to.
   * @returns The HTTP status code Sinkr returned.
   */
  async subscribeToChannel(userId: string, channel: string): Promise<number> {
    return await this.sendData({
      route: "subscribe",
      subscriberId: userId,
      channel,
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
    channel: string,
  ): Promise<number> {
    return await this.sendData({
      route: "unsubscribe",
      subscriberId: userId,
      channel,
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
    channel: string,
    event: TEvent,
    message: TData,
    key?: EncryptionInput,
  ): Promise<number> {
    return await this.sendData({
      route: "channel",
      channel,
      event: `${event}`,
      message: await getMessageContent(message, key),
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
    channel: string,
    event: TEvent,
    data: ReadableInput<TData>,
    key?: EncryptionInput,
  ): Promise<number[]> {
    return await this.sendData(
      {
        route: "channel",
        channel,
        event: `${event}`,
      },
      data,
      key,
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
    key?: EncryptionInput,
  ): Promise<number> {
    return await this.sendData({
      route: "direct",
      recipientId: userId,
      event: `${event}`,
      message: await getMessageContent(message, key),
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
    key?: EncryptionInput,
  ): Promise<number[]> {
    return await this.sendData(
      {
        route: "direct",
        recipientId: userId,
        event: `${event}`,
      },
      data,
      key,
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
  >(event: TEvent, message: TData, key?: EncryptionInput): Promise<number> {
    return await this.sendData({
      route: "broadcast",
      event: `${event}`,
      message: await getMessageContent(message, key),
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
    key?: EncryptionInput,
  ): Promise<number[]> {
    return await this.sendData(
      {
        route: "broadcast",
        event: `${event}`,
      },
      data,
      key,
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
  return new SinkrSource(url, appKey, appId);
}
