import { DurableObject } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";

import {
  ServerEndpointSchema,
  StreamedServerEndpointSchema,
} from "@sinkr/validators";

import { peerChannelSubscriptions, peers } from "./db/schema";
import { getPeerMap, getPeers, sendToPeer, ws } from "./server";
import { getDB, init, requiresAuthentication } from "./utils";

export class $DurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    init(env);
    ws.handleDurableInit(this, ctx, env);
  }

  async fetch(request: Request) {
    console.log("On durable object fetch");

    if (request.headers.get("Upgrade") === "websocket") {
      return ws.handleDurableUpgrade(this, request);
    }

    const reqUrl = new URL(request.url);
    const [_, appId] = reqUrl.pathname.split("/");
    if (!appId) {
      return new Response("Not found", { status: 404 });
    }
    const db = getDB();
    const app = await db.query.apps.findFirst({
      where: (a, ops) => ops.and(ops.eq(a.id, appId), ops.eq(a.enabled, true)),
    });
    if (!app) {
      return new Response("Not found", { status: 404 });
    }
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }
    const [authMethod, token] = authHeader.split(" ");
    if (!token || authMethod !== "Bearer") {
      return new Response("Unauthorized", { status: 401 });
    }
    if (token !== app.secretKey) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const shouldStream = request.headers.get("X-Sinkr-Stream") === "true";
    if (shouldStream) {
      if (!request.body) {
        return new Response("Invalid request", { status: 400 });
      }
      const transformed = transformRequestStream(request.body);
      const reader = transformed.getReader();
      const prelude = await reader.read();
      if (prelude.done) {
        return new Response("Invalid request", { status: 400 });
      }
      const parsed = StreamedServerEndpointSchema.safeParse(prelude.value);
      if (!parsed.success) {
        return new Response("Invalid request", { status: 400 });
      }
      const data = parsed.data;
      switch (data.route) {
        case "broadcast": {
          const peers = getPeers();
          const dbPeers = await db.query.peers.findMany({
            where: (p, ops) => ops.eq(p.appId, appId),
          });
          const peerIdSet = new Set();
          dbPeers.forEach((p) => peerIdSet.add(p.id));
          return unblockedResponse(this.ctx, reader, (message) => {
            peers.forEach((peer) => {
              if (peerIdSet.has(peer.id)) {
                sendToPeer(peer, {
                  source: "message",
                  data: {
                    event: data.event,
                    from: {
                      source: "broadcast",
                    },
                    message,
                  },
                });
              }
            });
          });
        }
        case "channel": {
          const subscriptions =
            await db.query.peerChannelSubscriptions.findMany({
              where: (s, ops) =>
                ops.and(
                  ops.eq(s.appId, appId),
                  ops.eq(s.channel, data.channel),
                ),
            });
          const peers = getPeerMap();
          return unblockedResponse(this.ctx, reader, (message) => {
            subscriptions.forEach((sub) => {
              const peer = peers.get(sub.peerId);
              if (peer) {
                sendToPeer(peer, {
                  source: "message",
                  data: {
                    event: data.event,
                    from: {
                      source: "channel",
                      channel: data.channel,
                    },
                    message,
                  },
                });
              }
            });
          });
        }
        case "direct": {
          const dbPeer = await db.query.peers.findFirst({
            where: (p, ops) =>
              ops.and(
                ops.eq(p.appId, appId),
                ops.or(
                  ops.eq(p.authenticatedUserId, data.recipientId),
                  ops.eq(p.id, data.recipientId),
                ),
              ),
          });
          if (!dbPeer) {
            return new Response("Not found", { status: 404 });
          }
          const peer = getPeerMap().get(dbPeer.id);
          if (!peer) {
            return new Response("Not found", { status: 404 });
          }
          return unblockedResponse(this.ctx, reader, (message) => {
            sendToPeer(peer, {
              source: "message",
              data: {
                event: data.event,
                from: {
                  source: "direct",
                },
                message,
              },
            });
          });
        }
      }
    }
    const body = await request.json().catch(() => null);
    const parsed = ServerEndpointSchema.safeParse(body);
    if (!parsed.success) {
      return new Response("Invalid request", { status: 400 });
    }
    const data = parsed.data;
    switch (data.route) {
      case "authenticate": {
        const peer = await db.query.peers.findFirst({
          where: (p, ops) =>
            ops.and(ops.eq(p.appId, appId), ops.eq(p.id, data.peerId)),
        });
        if (!peer) {
          return new Response("Not found", { status: 404 });
        }
        await db
          .update(peers)
          .set({ userInfo: data.userInfo, authenticatedUserId: data.id })
          .where(eq(peers.id, peer.id));
        return new Response("OK", { status: 200 });
      }
      case "broadcast": {
        const peers = getPeers();
        const dbPeers = await db.query.peers.findMany({
          where: (p, ops) => ops.eq(p.appId, appId),
        });
        const peerIdSet = new Set();
        dbPeers.forEach((p) => peerIdSet.add(p.id));
        peers.forEach((peer) => {
          if (peerIdSet.has(peer.id)) {
            sendToPeer(peer, {
              source: "message",
              data: {
                event: data.event,
                from: {
                  source: "broadcast",
                },
                message: data.message,
              },
            });
          }
        });
        return new Response("OK", { status: 200 });
      }
      case "channel": {
        const subscriptions = await db.query.peerChannelSubscriptions.findMany({
          where: (s, ops) =>
            ops.and(ops.eq(s.appId, appId), ops.eq(s.channel, data.channel)),
        });
        const peers = getPeerMap();
        subscriptions.forEach((sub) => {
          const peer = peers.get(sub.peerId);
          if (peer) {
            sendToPeer(peer, {
              source: "message",
              data: {
                event: data.event,
                from: {
                  source: "channel",
                  channel: data.channel,
                },
                message: data.message,
              },
            });
          }
        });
        return new Response("OK", { status: 200 });
      }
      case "direct": {
        const dbPeer = await db.query.peers.findFirst({
          where: (p, ops) =>
            ops.and(
              ops.eq(p.appId, appId),
              ops.or(
                ops.eq(p.authenticatedUserId, data.recipientId),
                ops.eq(p.id, data.recipientId),
              ),
            ),
        });
        if (!dbPeer) {
          return new Response("Not found", { status: 404 });
        }
        const peer = getPeerMap().get(dbPeer.id);
        if (!peer) {
          return new Response("Not found", { status: 404 });
        }
        sendToPeer(peer, {
          source: "message",
          data: {
            event: data.event,
            from: {
              source: "direct",
            },
            message: data.message,
          },
        });
        return new Response("OK", { status: 200 });
      }
      case "subscribe": {
        const dbPeer = await db.query.peers.findFirst({
          where: (p, ops) =>
            ops.and(
              ops.eq(p.appId, appId),
              ops.or(
                ops.eq(p.authenticatedUserId, data.subscriberId),
                ops.eq(p.id, data.subscriberId),
              ),
            ),
        });
        if (!dbPeer) {
          return new Response("Not found", { status: 404 });
        }
        if (requiresAuthentication(data.channel)) {
          if (!dbPeer.authenticatedUserId) {
            return new Response("Unauthorized", { status: 401 });
          }
        }
        const existingSubs = await db
          .select({
            peer: peers,
            subscription: peerChannelSubscriptions,
          })
          .from(peerChannelSubscriptions)
          .innerJoin(peers, eq(peers.id, peerChannelSubscriptions.peerId))
          .where(
            and(
              eq(peers.appId, appId),
              eq(peerChannelSubscriptions.channel, data.channel),
            ),
          );
        await db.insert(peerChannelSubscriptions).values({
          appId,
          peerId: dbPeer.id,
          channel: data.channel,
        });
        const isPresence = data.channel.startsWith("presence-");
        const peerMap = getPeerMap();
        const mainPeer = peerMap.get(dbPeer.id);
        if (mainPeer) {
          if (isPresence) {
            sendToPeer(mainPeer, {
              source: "metadata",
              data: {
                event: "join-presence-channel",
                channel: data.channel,
                members: existingSubs.map((s) => ({
                  id: s.peer.authenticatedUserId ?? s.peer.id,
                  userInfo: s.peer.userInfo,
                })),
              },
            });
          } else {
            sendToPeer(mainPeer, {
              source: "metadata",
              data: {
                event: "count",
                channel: data.channel,
                count: existingSubs.length + 1,
              },
            });
          }
        }
        existingSubs.forEach((sub) => {
          const peer = peerMap.get(sub.peer.id);
          if (peer) {
            if (isPresence) {
              sendToPeer(peer, {
                source: "metadata",
                data: {
                  event: "member-join",
                  channel: data.channel,
                  member: {
                    id: dbPeer.authenticatedUserId ?? dbPeer.id,
                    userInfo: dbPeer.userInfo,
                  },
                },
              });
            } else {
              sendToPeer(peer, {
                source: "metadata",
                data: {
                  event: "count",
                  channel: data.channel,
                  count: existingSubs.length + 1,
                },
              });
            }
          }
        });
        return new Response("OK", { status: 200 });
      }
      case "unsubscribe": {
        const dbPeer = await db.query.peers.findFirst({
          where: (p, ops) =>
            ops.and(
              ops.eq(p.appId, appId),
              ops.or(
                ops.eq(p.authenticatedUserId, data.subscriberId),
                ops.eq(p.id, data.subscriberId),
              ),
            ),
        });
        if (!dbPeer) {
          return new Response("Not found", { status: 404 });
        }
        const isInChannel = await db.query.peerChannelSubscriptions.findFirst({
          where: (s, ops) =>
            ops.and(
              ops.eq(s.appId, appId),
              ops.eq(s.peerId, dbPeer.id),
              ops.eq(s.channel, data.channel),
            ),
        });
        if (!isInChannel) {
          return new Response("Not found", { status: 404 });
        }
        await db
          .delete(peerChannelSubscriptions)
          .where(eq(peerChannelSubscriptions.id, isInChannel.id));
        const remainingSubs = await db
          .select({
            peer: peers,
            subscription: peerChannelSubscriptions,
          })
          .from(peerChannelSubscriptions)
          .innerJoin(peers, eq(peers.id, peerChannelSubscriptions.peerId))
          .where(
            and(
              eq(peers.appId, appId),
              eq(peerChannelSubscriptions.channel, data.channel),
            ),
          );
        const peerMap = getPeerMap();
        const mainPeer = peerMap.get(dbPeer.id);
        const isPresence = data.channel.startsWith("presence-");
        if (mainPeer) {
          sendToPeer(mainPeer, {
            data: {
              event: "leave-channel",
              channel: data.channel,
            },
            source: "metadata",
          });
        }
        remainingSubs.forEach((sub) => {
          const peer = peerMap.get(sub.peer.id);
          if (peer) {
            if (isPresence) {
              sendToPeer(peer, {
                source: "metadata",
                data: {
                  event: "member-leave",
                  channel: data.channel,
                  member: {
                    id: dbPeer.authenticatedUserId ?? dbPeer.id,
                    userInfo: dbPeer.userInfo,
                  },
                },
              });
            } else {
              sendToPeer(peer, {
                source: "metadata",
                data: {
                  event: "count",
                  channel: data.channel,
                  count: remainingSubs.length,
                },
              });
            }
          }
        });
        return new Response("OK", { status: 200 });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(client: WebSocket, message: string | ArrayBuffer) {
    console.log("On durable object message");
    return ws.handleDurableMessage(this, client, message);
  }

  webSocketClose(
    client: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    console.log("On durable object close");
    return ws.handleDurableClose(this, client, code, reason, wasClean);
  }
}

function transformRequestStream(body: ReadableStream) {
  const transformer = new TransformStream<unknown, unknown>({
    transform(chunk, controller) {
      if (typeof chunk === "string") {
        try {
          const parsed = JSON.parse(chunk) as unknown;
          controller.enqueue(parsed);
        } catch (e) {
          controller.error(e);
        }
        return;
      }
      if (typeof chunk !== "object") {
        return controller.error(new Error("Invalid chunk"));
      }
      if (chunk instanceof ArrayBuffer) {
        const decoded = new TextDecoder().decode(chunk);
        try {
          const parsed = JSON.parse(decoded) as unknown;
          controller.enqueue(parsed);
        } catch (e) {
          controller.error(e);
        }
        return;
      }
      if (chunk instanceof Buffer) {
        const decoded = chunk.toString("utf-8");
        try {
          const parsed = JSON.parse(decoded) as unknown;
          controller.enqueue(parsed);
        } catch (e) {
          controller.error(e);
        }
        return;
      }
    },
  });
  return body.pipeThrough(transformer);
}

function unblockedResponse(
  ctx: DurableObjectState,
  body: ReadableStreamDefaultReader<unknown>,
  onMessageChunk: (chunk: unknown) => void | Promise<void>,
): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const daemonPromise = new Promise<void>((res, rej) => {
      const outputStream = new ReadableStream({
        async pull(controller) {
          const nextChunk = await body.read();
          if (nextChunk.done) {
            controller.close();
            res();
            return;
          }
          try {
            await onMessageChunk(nextChunk.value);
            controller.enqueue("OK");
          } catch (e) {
            controller.error(e);
            rej(e);
          }
        },
      });
      resolve(
        new Response(outputStream, {
          status: 200,
        }),
      );
    });
    ctx.waitUntil(daemonPromise);
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    init(env);
    return ws.handleUpgrade(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
