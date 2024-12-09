import type { Hooks } from "crossws";
import { eq } from "drizzle-orm";

import { ServerEndpointSchema } from "@sinkr/validators";

import { peers } from "./db/schema";
import { getPeerMap, handleSource, sendToPeer } from "./server";
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
  async message(peer, message) {
    const db = getDB();
    const peerInfo = await db.query.peers.findFirst({
      where: (p, ops) => ops.eq(p.id, peer.id),
    });
    if (peerInfo?.type !== "source") {
      return;
    }
    const body = message.json<{
      data: unknown;
      id: string;
    }>();
    const parsed = ServerEndpointSchema.safeParse(body.data);
    if (!parsed.success) {
      peer.send({
        status: 400,
        id: body.id,
        error: parsed.error.toString(),
      });
      return;
    }
    const res = await handleSource(parsed.data, peerInfo.appId);
    peer.send({
      status: res.status,
      id: body.id,
    });
  },
  async close(peer) {
    console.log(`ON CLOSE: ${peer.id}`);
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
    console.log(`ON OPEN: ${peer.id}`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const url = new URL(peer.request!.url!);
      const [_, appId] = url.pathname.split("/");
      if (!appId) {
        peer.close(4000, "Invalid application");
        return;
      }
      const appKey =
        url.searchParams.get("sinkrKey") ?? url.searchParams.get("appKey");
      const db = getDB();
      const app = await db.query.apps.findFirst({
        where: (a, ops) =>
          ops.and(ops.eq(a.id, appId), ops.eq(a.enabled, true)),
      });
      if (appKey && appKey !== app?.secretKey) {
        peer.close(4000, "Invalid application");
        return;
      }
      const type = appKey ? "source" : "sink";
      await db.insert(peers).values({
        id: peer.id,
        appId: appId,
        type,
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
