import {
  blob,
  index,
  int,
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
  (app) => [index("app_secIdx").on(app.secretKey)],
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
    index("peer_appIdx").on(peer.appId),
    index("peer_authIdx").on(peer.authenticatedUserId),
    uniqueIndex("peer_unique").on(peer.id, peer.appId),
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
    channelFlags: int().notNull().default(0),
  },
  (peerChannelSubscription) => [
    index("pcs_channelIdx").on(peerChannelSubscription.channel),
    index("pcs_appIdx").on(peerChannelSubscription.appId),
    index("pcs_peerIdx").on(peerChannelSubscription.peerId),
    uniqueIndex("pcs_unique").on(
      peerChannelSubscription.appId,
      peerChannelSubscription.peerId,
      peerChannelSubscription.channel,
    ),
  ],
);

export const storedChannelMessages = sqliteTable(
  "storedChannelMessages",
  {
    id: text().primaryKey(),
    appId: text()
      .notNull()
      .references(() => apps.id, {
        onDelete: "cascade",
      }),
    channel: text().notNull(),
    channelFlags: int().notNull().default(0),
    data: blob().notNull(),
  },
  (storedChannelMessage) => [
    index("scm_appIdx").on(storedChannelMessage.appId),
    index("scm_channelIdx").on(storedChannelMessage.channel),
    index("scm_comboIdx").on(
      storedChannelMessage.appId,
      storedChannelMessage.channel,
    ),
  ],
);
