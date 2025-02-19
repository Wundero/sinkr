import type { z } from "zod";
import { relations, sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v7 } from "uuid";

import type { ChannelMessagesSendRequestSchema } from "@sinkr/validators";

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

export const appRelations = relations(apps, ({ many }) => ({
  peers: many(peers),
  channels: many(channels),
  peerChannelSubscriptions: many(peerChannelSubscriptions),
  storedChannelMessages: many(storedChannelMessages),
}));

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

export const peerRelations = relations(peers, ({ one, many }) => ({
  app: one(apps, {
    fields: [peers.appId],
    references: [apps.id],
  }),
  subscriptions: many(peerChannelSubscriptions),
}));

export const channels = sqliteTable(
  "channel",
  {
    id: text().primaryKey().$default(v7),
    appId: text()
      .notNull()
      .references(() => apps.id, {
        onDelete: "cascade",
      }),
    name: text().notNull(),
    auth: text({ enum: ["public", "private", "presence"] })
      .notNull()
      .default("public"),
    store: integer({ mode: "boolean" }).notNull().default(false),
  },
  (channel) => [
    index("channel_appIdx").on(channel.appId),
    index("channel_authIdx").on(channel.name),
    uniqueIndex("channel_unique").on(channel.name, channel.appId),
  ],
);

export const channelRelations = relations(channels, ({ one, many }) => ({
  app: one(apps, {
    fields: [channels.appId],
    references: [apps.id],
  }),
  subscriptions: many(peerChannelSubscriptions),
  messages: many(storedChannelMessages),
}));

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
    channelId: text()
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
      }),
  },
  (peerChannelSubscription) => [
    index("pcs_channelIdx").on(peerChannelSubscription.channelId),
    index("pcs_appIdx").on(peerChannelSubscription.appId),
    index("pcs_peerIdx").on(peerChannelSubscription.peerId),
    uniqueIndex("pcs_unique").on(
      peerChannelSubscription.appId,
      peerChannelSubscription.peerId,
      peerChannelSubscription.channelId,
    ),
  ],
);

export const peerChannelSubscriptionRelations = relations(
  peerChannelSubscriptions,
  ({ one }) => ({
    channel: one(channels, {
      fields: [peerChannelSubscriptions.channelId],
      references: [channels.id],
    }),
    app: one(apps, {
      fields: [peerChannelSubscriptions.appId],
      references: [apps.id],
    }),
    peer: one(peers, {
      fields: [peerChannelSubscriptions.peerId],
      references: [peers.id],
    }),
  }),
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
    channelId: text()
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
      }),
    createdAt: text()
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    data: blob({ mode: "json" })
      .$type<z.infer<typeof ChannelMessagesSendRequestSchema>["request"]>()
      .notNull(),
  },
  (storedChannelMessage) => [
    index("scm_appIdx").on(storedChannelMessage.appId),
    index("scm_channelIdx").on(storedChannelMessage.channelId),
    index("scm_comboIdx").on(
      storedChannelMessage.appId,
      storedChannelMessage.channelId,
    ),
  ],
);

export const storedChannelMessageRelations = relations(
  storedChannelMessages,
  ({ one }) => ({
    app: one(apps, {
      fields: [storedChannelMessages.appId],
      references: [apps.id],
    }),
    channel: one(channels, {
      fields: [storedChannelMessages.channelId],
      references: [channels.id],
    }),
  }),
);
