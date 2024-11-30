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
    secretKey: text().unique().notNull(),
    enabled: integer({ mode: "boolean" }).default(true),
  },
  (app) => ({
    secIdx: index("secIdx").on(app.secretKey),
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
    authenticatedUserId: text(),
    userInfo: text({
      mode: "json",
    }),
  },
  (peer) => ({
    appIdx: index("appIdx").on(peer.appId),
    authIdx: index("authIdx").on(peer.authenticatedUserId),
    unique: uniqueIndex("unique").on(peer.id, peer.appId),
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
    channelIdx: index("channelIdx").on(peerChannelSubscription.channel),
    appIdx: index("appIdx").on(peerChannelSubscription.appId),
    peerIdx: index("peerIdx").on(peerChannelSubscription.peerId),
    unique: uniqueIndex("unique").on(
      peerChannelSubscription.appId,
      peerChannelSubscription.peerId,
      peerChannelSubscription.channel,
    ),
  }),
);
