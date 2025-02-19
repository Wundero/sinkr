import type { Peer } from "crossws";
import type { z } from "zod";
import { UTCDate } from "@date-fns/utc";
import crossws from "crossws/adapters/cloudflare-durable";
import { and, eq, inArray, not } from "drizzle-orm";

import type {
  ClientReceiveSchema,
  RouteRequestSchema,
  RouteResponseSchema,
  ServerRoute,
} from "@sinkr/validators";

import { getCoordinator } from ".";
import {
  channels,
  peerChannelSubscriptions,
  peers,
  storedChannelMessages,
} from "./db/schema";
import { hooks } from "./hooks";
import { getDB } from "./utils";

type ClientReception = z.infer<typeof ClientReceiveSchema>;

export function getCoordinatorInstance(env: Env) {
  const coordinatorBinding = env.ObjectCoordinator;
  const coordinatorId = coordinatorBinding.idFromName("coordinator");
  const coordinator = coordinatorBinding.get(coordinatorId);
  return coordinator;
}

export const ws = crossws({
  hooks,
  resolveDurableStub(req, $env) {
    return getCoordinatorInstance($env as Env);
  },
});

export function getPeers() {
  const firstPeer = ws.peers.values().next().value;
  if (!firstPeer) {
    return new Set<Peer>();
  }
  const all = firstPeer.peers;
  return all;
}

export function getPeerMap() {
  const peers = getPeers();
  const map = new Map<string, Peer>();
  peers.forEach((p) => map.set(p.id, p));
  return map;
}

export function sendToPeer(peer: Peer, message: ClientReception) {
  console.log("Sending to peer", peer.id, message);
  peer.send(message);
}

export async function handleSource<TRoute extends ServerRoute>(
  id: string,
  input: RouteRequestSchema<TRoute>,
  appId: string,
): Promise<RouteResponseSchema<TRoute>["response"]> {
  const db = getDB();
  const { route, request: data } = input;
  switch (route) {
    case "user.authenticate": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          success: false,
          error: "Invalid connection",
        };
      }
      const peer = await db.query.peers.findFirst({
        where: (p, ops) =>
          ops.and(ops.eq(p.appId, appId), ops.eq(p.id, data.peerId)),
      });
      if (!peer) {
        return {
          success: false,
          error: "Peer not found",
        };
      }
      await db
        .update(peers)
        .set({ userInfo: data.userInfo, authenticatedUserId: data.id })
        .where(eq(peers.id, peer.id));
      return {
        success: true,
      };
    }
    case "channel.create": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          success: false,
          error: "Invalid connection",
        };
      }
      const existing = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.appId, appId), ops.eq(c.name, data.name)),
      });
      if (existing) {
        const [updated] = await db
          .update(channels)
          .set({
            auth: data.authMode,
            store: data.storeMessages,
          })
          .where(eq(channels.id, existing.id))
          .returning();
        if (!updated) {
          return {
            success: false,
            error: "Unknown error",
          };
        }
        return {
          success: true,
          channelId: updated.id,
        };
      } else {
        const [inserted] = await db
          .insert(channels)
          .values({
            appId,
            name: data.name,
            auth: data.authMode,
            store: data.storeMessages,
          })
          .returning();
        if (!inserted) {
          return {
            success: false,
            error: "Unknown error",
          };
        }
        return {
          success: true,
          channelId: inserted.id,
        };
      }
    }
    case "channel.delete": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          success: false,
          error: "Invalid connection",
        };
      }
      const channel = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.appId, appId), ops.eq(c.id, data.channelId)),
      });
      if (!channel) {
        return {
          success: false,
          error: "Channel not found",
        };
      }
      await db
        .delete(channels)
        .where(and(eq(channels.id, data.channelId), eq(channels.appId, appId)));
      return {
        success: true,
      };
    }
    case "channel.messages.delete": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          success: false,
          error: "Invalid connection",
        };
      }
      if (data.messageIds?.length) {
        await db
          .delete(storedChannelMessages)
          .where(
            and(
              eq(storedChannelMessages.channelId, data.channelId),
              eq(storedChannelMessages.appId, appId),
              inArray(storedChannelMessages.id, data.messageIds),
            ),
          );
      } else {
        await db
          .delete(storedChannelMessages)
          .where(
            and(
              eq(storedChannelMessages.channelId, data.channelId),
              eq(storedChannelMessages.appId, appId),
            ),
          );
      }
      return {
        success: true,
      };
    }
    case "global.messages.send": {
      const coordInst = getCoordinator();
      if (coordInst) {
        const res = await coordInst.distribute({
          id,
          appId,
          data: input,
        });
        const success = res.every((r) => r.response.success);
        if (success) {
          return {
            success,
          };
        } else {
          return {
            success,
            error: "Invalid request",
          };
        }
      }
      const peers = getPeers();
      const dbPeers = await db.query.peers.findMany({
        where: (p, ops) => ops.eq(p.appId, appId),
      });
      const peerIdSet = new Set();
      dbPeers.forEach((p) => peerIdSet.add(p.id));
      peers.forEach((peer) => {
        if (peerIdSet.has(peer.id)) {
          sendToPeer(peer, {
            id: id,
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
      return {
        success: true,
      };
    }
    case "channel.messages.send": {
      const coordInst = getCoordinator();
      if (coordInst) {
        const res = await coordInst.distribute({ id, appId, data: input });
        const success = res.every((r) => r.response.success);
        if (success) {
          return { success };
        }
        return {
          success,
          error: "Invalid request",
        };
      }
      const ch = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.id, data.channelId), ops.eq(c.appId, appId)),
      });
      if (!ch) {
        return {
          success: false,
          error: "Channel not found",
        };
      }
      const subscriptions = await db.query.peerChannelSubscriptions.findMany({
        where: (s, ops) =>
          ops.and(ops.eq(s.appId, appId), ops.eq(s.channelId, data.channelId)),
      });
      if (ch.store) {
        await db.insert(storedChannelMessages).values({
          id: id,
          appId,
          channelId: ch.id,
          data,
        });
      }
      const peers = getPeerMap();
      subscriptions.forEach((sub) => {
        const peer = peers.get(sub.peerId);
        if (peer) {
          sendToPeer(peer, {
            source: "message",
            id: id,
            data: {
              event: data.event,
              from: {
                source: "channel",
                channelId: ch.id,
              },
              message: data.message,
            },
          });
        }
      });
      return {
        success: true,
      };
    }
    case "user.messages.send": {
      const coordInst = getCoordinator();
      if (coordInst) {
        const res = await coordInst.distribute({ id, appId, data: input });
        const success = res.some((r) => r.response.success);
        if (success) {
          return { success };
        }
        return {
          success,
          error: "Peer not found",
        };
      }
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
        return {
          success: false,
          error: "Peer not found",
        };
      }
      const peer = getPeerMap().get(dbPeer.id);
      if (!peer) {
        return {
          success: false,
          error: "Peer not found",
        };
      }
      sendToPeer(peer, {
        source: "message",
        id: id,
        data: {
          event: data.event,
          from: {
            source: "direct",
          },
          message: data.message,
        },
      });
      return {
        success: true,
      };
    }
    case "channel.subscribers.add": {
      const coordInst = getCoordinator();
      const ch = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.appId, appId), ops.eq(c.id, data.channelId)),
        with: {
          messages: {
            columns: {
              id: true,
              createdAt: true,
            },
            orderBy: (m, { asc }) => [asc(m.createdAt)],
          },
        },
      });
      if (!ch) {
        return {
          success: false,
          error: "Channel not found",
        };
      }
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
        return {
          success: false,
          error: "Peer not found",
        };
      }
      if (ch.auth === "public") {
        if (!dbPeer.authenticatedUserId) {
          return {
            success: false,
            error: "Peer not authenticated",
          };
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
            eq(peerChannelSubscriptions.channelId, ch.id),
            not(eq(peers.id, dbPeer.id)),
          ),
        );
      if (coordInst) {
        await db.insert(peerChannelSubscriptions).values({
          appId,
          peerId: dbPeer.id,
          channelId: ch.id,
        });

        const res = await coordInst.distribute({ id, appId, data: input });
        const success = res.every((r) => r.response.success);
        if (success) {
          return { success };
        }
        return {
          success,
          error: "Invalid request",
        };
      }
      const peerMap = getPeerMap();
      const mainPeer = peerMap.get(dbPeer.id);
      if (mainPeer) {
        sendToPeer(mainPeer, {
          source: "metadata",
          id: id,
          data: {
            event: "join-channel",
            channelId: ch.id,
            channelAuthMode: ch.auth,
            channelName: ch.name,
            channelStoredMessages: ch.messages.map((x) => ({
              id: x.id,
              date: new UTCDate(x.createdAt),
            })),
            members: existingSubs.map((s) => ({
              id: s.peer.authenticatedUserId ?? s.peer.id,
              userInfo: ch.auth === "presence" ? s.peer.userInfo : undefined,
            })),
          },
        });
      }
      existingSubs.forEach((sub) => {
        const peer = peerMap.get(sub.peer.id);
        if (peer) {
          sendToPeer(peer, {
            source: "metadata",
            id: id,
            data: {
              event: "member-join",
              channelId: ch.id,
              member: {
                id: dbPeer.authenticatedUserId ?? dbPeer.id,
                userInfo: ch.auth === "presence" ? dbPeer.userInfo : undefined,
              },
            },
          });
        }
      });
      return {
        success: true,
      };
    }
    case "channel.subscribers.remove": {
      const coordInst = getCoordinator();
      const ch = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.appId, appId), ops.eq(c.id, data.channelId)),
      });
      if (!ch) {
        return {
          success: false,
          error: "Channel not found",
        };
      }
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
        return {
          success: false,
          error: "Peer not found",
        };
      }
      if (coordInst) {
        const isInChannel = await db.query.peerChannelSubscriptions.findFirst({
          where: (s, ops) =>
            ops.and(
              ops.eq(s.appId, appId),
              ops.eq(s.peerId, dbPeer.id),
              ops.eq(s.channelId, ch.id),
            ),
        });
        if (!isInChannel) {
          return {
            success: false,
            error: "Peer is not subscribed to channel",
          };
        }
        await db
          .delete(peerChannelSubscriptions)
          .where(eq(peerChannelSubscriptions.id, isInChannel.id));
        const res = await coordInst.distribute({ id, appId, data: input });
        const success = res.every((r) => r.response.success);
        if (success) {
          return { success };
        }
        return {
          success,
          error: "Invalid request",
        };
      }
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
            eq(peerChannelSubscriptions.channelId, ch.id),
          ),
        );
      const peerMap = getPeerMap();
      const mainPeer = peerMap.get(dbPeer.id);
      if (mainPeer) {
        sendToPeer(mainPeer, {
          data: {
            event: "leave-channel",
            channelId: ch.id,
          },
          id: id,
          source: "metadata",
        });
      }
      remainingSubs.forEach((sub) => {
        const peer = peerMap.get(sub.peer.id);
        if (peer) {
          sendToPeer(peer, {
            source: "metadata",
            id: id,
            data: {
              event: "member-leave",
              channelId: ch.id,
              member: {
                id: dbPeer.authenticatedUserId ?? dbPeer.id,
                userInfo: ch.auth === "presence" ? dbPeer.userInfo : undefined,
              },
            },
          });
        }
      });
      return {
        success: true,
      };
    }
  }
}
