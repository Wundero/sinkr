/* eslint-disable turbo/no-undeclared-env-vars */
import type { MessageEvent } from "undici";
import type { z } from "zod";
import { fetch, WebSocket } from "undici";

import type { ServerEndpointSchema } from "@sinkr/validators";

import type { RealEventMap } from "./event-fallback";
import type { UserInfo } from "./types";

type SendDataParam = z.infer<typeof ServerEndpointSchema>;

function prepareStream(shape: object, stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  const morphedUnencodedStream = new ReadableStream<unknown>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue({
            ...shape,
            message: value,
          });
        }
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return morphedUnencodedStream;
}

class Sourcerer {
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
    data: TData,
    stream: ReadableStream<unknown>,
  ): Promise<number[]>;
  private async sendData<TData extends SendDataParam>(
    data: TData,
    stream?: ReadableStream<unknown>,
  ) {
    if (stream) {
      const encodedStream = prepareStream(data, stream);
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
      if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
        const id = crypto.randomUUID();
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
        body: JSON.stringify(data),
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
  >(channel: string, event: TEvent, message: TData): Promise<number> {
    return await this.sendData({
      route: "channel",
      channel,
      event: `${event}`,
      message,
    });
  }

  /**
   * Stream messages to a channel.
   * @param channel The channel to send the messages to.
   * @param event The event to send.
   * @param stream A stream of data to send. Each chunk should be one message.
   * @returns The HTTP status code Sinkr returned. The function may return before the stream is finished.
   */
  async streamToChannel<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    channel: string,
    event: TEvent,
    stream: ReadableStream<TData>,
  ): Promise<number[]> {
    return await this.sendData(
      {
        route: "channel",
        channel,
        event: `${event}`,
      },
      stream,
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
  >(userId: string, event: TEvent, message: TData): Promise<number> {
    return await this.sendData({
      route: "direct",
      recipientId: userId,
      event: `${event}`,
      message,
    });
  }

  /**
   * Stream messages directly to a user.
   * @param userId The ID of the user to send the message to. This can be a peer ID or, for authenticated users, the user ID.
   * @param event The event to send.
   * @param stream The stream of data to send. Each chunk should be one message.
   * @returns The HTTP status code Sinkr returned. The function may return before the stream is finished.
   */
  async streamDirectMessage<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(
    userId: string,
    event: TEvent,
    stream: ReadableStream<TData>,
  ): Promise<number[]> {
    return await this.sendData(
      {
        route: "direct",
        recipientId: userId,
        event: `${event}`,
      },
      stream,
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
  >(event: TEvent, message: TData): Promise<number> {
    return await this.sendData({
      route: "broadcast",
      event: `${event}`,
      message,
    });
  }

  /**
   * Broadcast a stream of messages to all connected clients.
   * @param event The event to send.
   * @param stream The stream of data to send. Each chunk should be one message.
   * @returns The HTTP status code Sinkr returned. The function may return before the stream is finished.
   */
  async streamBroadcastMessage<
    TEvent extends keyof RealEventMap,
    TData extends RealEventMap[TEvent],
  >(event: TEvent, stream: ReadableStream<TData>): Promise<number[]> {
    return await this.sendData(
      {
        route: "broadcast",
        event: `${event}`,
      },
      stream,
    );
  }
}

export type SinkrSource = Sourcerer;

/**
 * Create a Sinkr source to send messages.
 * @param options The connection options. Will fall back to env vars if not provided.
 * @returns The Sinkr source.
 * @throws If no URL or app key is provided.
 */
export function source({
  url = process.env.SINKR_URL,
  appKey = process.env.SINKER_APP_KEY,
  appId = process.env.SINKR_APP_ID,
}:
  | {
      url?: string | undefined;
      appKey?: string | undefined;
      appId?: string | undefined;
    }
  | undefined = {}): SinkrSource {
  if (!url) {
    throw new Error("Unable to start Sourcerer without a url!");
  }
  if (!appKey) {
    throw new Error("Unable to start Sourcerer without an app key!");
  }
  return new Sourcerer(url, appKey, appId);
}
