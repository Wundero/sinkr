import type { Hooks } from "crossws";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";

import {
  ClientRequestStoredMessagesSchema,
  ServerRequestSchema,
} from "@sinkr/validators";

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
    if (message.text() === "ping") {
      peer.send("pong");
      return;
    }
    const db = getDB();
    const peerInfo = await db.query.peers.findFirst({
      where: (p, ops) => ops.eq(p.id, peer.id),
    });
    if (peerInfo?.type === "sink") {
      const body = message.json();
      const parsed = ClientRequestStoredMessagesSchema.safeParse(body);
      if (!parsed.success) {
        return;
      }
      const messages = await db.query.storedChannelMessages.findMany({
        where: (m, ops) =>
          ops.and(
            ops.eq(m.channelId, parsed.data.channelId),
            ops.eq(m.appId, peerInfo.appId),
            ops.inArray(m.id, parsed.data.messageIds),
          ),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });
      for (const message of messages) {
        sendToPeer(peer, {
          id: message.id,
          source: "message",
          data: {
            event: message.data.event,
            from: {
              channelId: message.data.channelId,
              source: "channel",
            },
            message: message.data.message,
          },
        });
      }
      return;
    }
    if (peerInfo?.type !== "source") {
      return;
    }
    const body = message.json<{
      data: unknown;
      id: string;
    }>();
    const parsed = ServerRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      peer.send({
        status: 400,
        id: body.id,
        error: parsed.error.toString(),
      });
      return;
    }
    const res = await handleSource(body.id, parsed.data, peerInfo.appId);
    peer.send({
      id: body.id,
      route: parsed.data.route,
      response: res,
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
          pcs.channelId,
          connectedChannels.map((c) => c.channelId),
        ),
      with: {
        channel: true,
      },
    });
    const peerMap = getPeerMap();
    for (const subscription of channelPeers) {
      const peer = peerMap.get(subscription.peerId);
      if (!peer) {
        continue;
      }
      sendToPeer(peer, {
        source: "metadata",
        id: v7(),
        data: {
          event: "member-leave",
          channelId: subscription.channelId,
          member: {
            id: subscription.peerId,
            userInfo:
              subscription.channel.auth === "presence"
                ? peerInfo?.userInfo
                : undefined,
          },
        },
      });
    }
  },
  async open(peer) {
    console.log(`ON OPEN: ${peer.id}`);
    try {
      const url = new URL(peer.request.url);
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
        id: v7(),
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
