import type { Peer } from "crossws";
import type { z } from "zod";
import { UTCDate } from "@date-fns/utc";
import crossws from "crossws/adapters/cloudflare-durable";
import { and, eq, inArray, not } from "drizzle-orm";

import type {
  ClientReceiveSchema,
  ServerEndpointSchema,
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

type ServerMessage = z.infer<typeof ServerEndpointSchema>;

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

export async function handleSource(
  id: string,
  data: ServerMessage,
  appId: string,
): Promise<{
  status: number;
  data?: unknown;
}> {
  const db = getDB();
  switch (data.route) {
    case "authenticate": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          status: 401,
        };
      }
      const peer = await db.query.peers.findFirst({
        where: (p, ops) =>
          ops.and(ops.eq(p.appId, appId), ops.eq(p.id, data.peerId)),
      });
      if (!peer) {
        return {
          status: 404,
        };
      }
      await db
        .update(peers)
        .set({ userInfo: data.userInfo, authenticatedUserId: data.id })
        .where(eq(peers.id, peer.id));
      return {
        status: 200,
      };
    }
    case "createChannel": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          status: 401,
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
            status: 500,
          };
        }
        return {
          status: 200,
          data: updated.id,
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
            status: 500,
          };
        }
        return {
          status: 200,
          data: inserted.id,
        };
      }
    }
    case "deleteChannel": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          status: 401,
        };
      }
      const channel = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.appId, appId), ops.eq(c.id, data.channelId)),
      });
      if (!channel) {
        return {
          status: 404,
        };
      }
      await db
        .delete(channels)
        .where(and(eq(channels.id, data.channelId), eq(channels.appId, appId)));
      return {
        status: 200,
      };
    }
    case "deleteMessages": {
      const coordInst = getCoordinator();
      if (!coordInst) {
        return {
          status: 401,
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
        status: 200,
      };
    }
    case "broadcast": {
      const coordInst = getCoordinator();
      if (coordInst) {
        const res = await coordInst.distribute({ id, appId, data });
        const maxStatus = res.reduce((a, v) => Math.max(a, v.status), 0);
        return {
          status: maxStatus,
        };
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
        status: 200,
      };
    }
    case "channel": {
      const coordInst = getCoordinator();
      if (coordInst) {
        const res = await coordInst.distribute({ id, appId, data });
        const maxStatus = res.reduce((a, v) => Math.max(a, v.status), 0);
        return {
          status: maxStatus,
        };
      }
      const ch = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.id, data.channelId), ops.eq(c.appId, appId)),
      });
      if (!ch) {
        return {
          status: 404,
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
        status: 200,
      };
    }
    case "direct": {
      const coordInst = getCoordinator();
      if (coordInst) {
        const res = await coordInst.distribute({ id, appId, data });
        const maxStatus = res.reduce((a, v) => Math.max(a, v.status), 0);
        return {
          status: maxStatus,
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
          status: 404,
        };
      }
      const peer = getPeerMap().get(dbPeer.id);
      if (!peer) {
        return {
          status: 404,
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
        status: 200,
      };
    }
    case "subscribe": {
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
          status: 404,
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
          status: 404,
        };
      }
      if (ch.auth === "public") {
        if (!dbPeer.authenticatedUserId) {
          return {
            status: 401,
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

        const res = await coordInst.distribute({ id, appId, data });
        const maxStatus = res.reduce((a, v) => Math.max(a, v.status), 0);
        return {
          status: maxStatus,
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
        status: 200,
      };
    }
    case "unsubscribe": {
      const coordInst = getCoordinator();
      const ch = await db.query.channels.findFirst({
        where: (c, ops) =>
          ops.and(ops.eq(c.appId, appId), ops.eq(c.id, data.channelId)),
      });
      if (!ch) {
        return {
          status: 404,
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
          status: 404,
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
            status: 404,
          };
        }
        await db
          .delete(peerChannelSubscriptions)
          .where(eq(peerChannelSubscriptions.id, isInChannel.id));
        const res = await coordInst.distribute({ id, appId, data });
        const maxStatus = res.reduce((a, v) => Math.max(a, v.status), 0);
        return {
          status: maxStatus,
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
        status: 200,
      };
    }
  }
}
