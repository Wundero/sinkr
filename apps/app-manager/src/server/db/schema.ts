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
  (app) => [index("secIdx").on(app.secretKey)],
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
  (peer) => [
    index("appIdx").on(peer.appId),
    index("authIdx").on(peer.authenticatedUserId),
    uniqueIndex("unique").on(peer.id, peer.appId),
  ],
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
  (peerChannelSubscription) => [
    index("channelIdx").on(peerChannelSubscription.channel),
    index("appIdx").on(peerChannelSubscription.appId),
    index("peerIdx").on(peerChannelSubscription.peerId),
    uniqueIndex("unique").on(
      peerChannelSubscription.appId,
      peerChannelSubscription.peerId,
      peerChannelSubscription.channel,
    ),
  ],
);
