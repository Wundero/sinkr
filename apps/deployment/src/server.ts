import type { Peer } from "crossws";
import type { z } from "zod";
import crossws from "crossws/adapters/cloudflare-durable";
import { and, eq } from "drizzle-orm";

import type {
  ClientReceiveSchema,
  ServerEndpointSchema,
} from "@sinkr/validators";

import { peerChannelSubscriptions, peers } from "./db/schema";
import { hooks } from "./hooks";
import { getDB, requiresAuthentication } from "./utils";

type ServerMessage = z.infer<typeof ServerEndpointSchema>;

type ClientReception = z.infer<typeof ClientReceiveSchema>;

export const ws = crossws({
  hooks,
});

export function getPeers() {
  const firstPeer = ws.peers.values().next().value;
  if (!firstPeer) {
    console.log(
      "peer get: none",
      [...ws.peers].map((p) => p.id),
    );
    return new Set<Peer>();
  }
  const all = firstPeer.peers;
  console.log(
    "peer get",
    [...all].map((p) => p.id),
    [...ws.peers].map((p) => p.id),
  );
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

export async function handleSource(data: ServerMessage, appId: string) {
  const db = getDB();
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
}
