import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

export const apps = sqliteTable(
  "app",
  {
    id: text().primaryKey().$default(v7),
    name: text().notNull(),
    secretKey: text().unique().notNull(),
    enabled: integer({ mode: "boolean" }).default(true),
  },
  (app) => ({
    app_secIdx: index("secIdx").on(app.secretKey),
  }),
);

export const peers = sqliteTable(
  "peer",
  {
    id: text().primaryKey().$default(v7),
    appId: text()
      .notNull()
      .references(() => apps.id, {
        onDelete: "cascade",
      }),
    type: text({ enum: ["source", "sink"] })
      .notNull()
      .default("sink"),
    authenticatedUserId: text(),
    userInfo: text({
      mode: "json",
    }),
  },
  (peer) => ({
    peer_appIdx: index("appIdx").on(peer.appId),
    peer_authIdx: index("authIdx").on(peer.authenticatedUserId),
    peer_unique: uniqueIndex("unique").on(peer.id, peer.appId),
  }),
);

export const peerChannelSubscriptions = sqliteTable(
  "peerChannelSubscription",
  {
    id: text().primaryKey().$default(v7),
    appId: text()
      .notNull()
      .references(() => apps.id, {
        onDelete: "cascade",
      }),
    peerId: text()
      .notNull()
      .references(() => peers.id, {
        onDelete: "cascade",
      }),
    channel: text().notNull(),
  },
  (peerChannelSubscription) => ({
    pcs_channelIdx: index("channelIdx").on(peerChannelSubscription.channel),
    pcs_appIdx: index("appIdx").on(peerChannelSubscription.appId),
    pcs_peerIdx: index("peerIdx").on(peerChannelSubscription.peerId),
    pcs_unique: uniqueIndex("unique").on(
      peerChannelSubscription.appId,
      peerChannelSubscription.peerId,
      peerChannelSubscription.channel,
    ),
  }),
);
