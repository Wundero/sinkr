import type { Hooks } from "crossws";
import { eq } from "drizzle-orm";

import { peers } from "./db/schema";
import { getPeerMap, sendToPeer } from "./server";
import { getDB } from "./utils";

export const hooks = {
  async upgrade(request) {
    const url = new URL(request.url);
    const [_, appId] = url.pathname.split("/");
    if (!appId) {
      return new Response("Invalid application", { status: 404 });
    }
    const db = getDB();
    const app = await db.query.apps.findFirst({
      where: (a, ops) => ops.and(ops.eq(a.id, appId), ops.eq(a.enabled, true)),
    });
    if (!app) {
      return new Response("Invalid application", { status: 404 });
    }
  },
  async close(peer) {
    const db = getDB();
    const connectedChannels = await db.query.peerChannelSubscriptions.findMany({
      where: (pcs, ops) => ops.eq(pcs.peerId, peer.id),
    });
    const peerInfo = await db.query.peers.findFirst({
      where: (p, ops) => ops.eq(p.id, peer.id),
    });
    await db.delete(peers).where(eq(peers.id, peer.id));
    const channelPeers = await db.query.peerChannelSubscriptions.findMany({
      where: (pcs, ops) =>
        ops.inArray(
          pcs.channel,
          connectedChannels.map((c) => c.channel),
        ),
    });
    const newChannelCounts = new Map<string, number>();
    for (const subscription of channelPeers) {
      const count = newChannelCounts.get(subscription.channel) ?? 0;
      newChannelCounts.set(subscription.channel, count + 1);
    }
    const peerMap = getPeerMap();
    for (const subscription of channelPeers) {
      const peer = peerMap.get(subscription.peerId);
      if (!peer) {
        continue;
      }
      if (peerInfo && subscription.channel.startsWith("presence-")) {
        sendToPeer(peer, {
          source: "metadata",
          data: {
            event: "member-leave",
            channel: subscription.channel,
            member: {
              id: peerInfo.authenticatedUserId ?? peerInfo.id,
              userInfo: peerInfo.userInfo,
            },
          },
        });
      } else {
        sendToPeer(peer, {
          source: "metadata",
          data: {
            event: "count",
            channel: subscription.channel,
            count: newChannelCounts.get(subscription.channel) ?? 0,
          },
        });
      }
    }
  },
  async open(peer) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const url = new URL(peer.request!.url!);
      const [_, appId] = url.pathname.split("/");
      const db = getDB();
      await db.insert(peers).values({
        id: peer.id,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        appId: appId!,
      });
      sendToPeer(peer, {
        source: "metadata",
        data: {
          event: "init",
          peerId: peer.id,
        },
      });
    } catch (error) {
      peer.close(4000, "Failed to open socket");
      console.error("Failed to open websocket peer", error);
    }
  },
} satisfies Partial<Hooks>;
