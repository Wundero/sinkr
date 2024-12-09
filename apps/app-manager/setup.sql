CREATE TABLE
    IF NOT EXISTS "accounts" (
        "id" text NOT NULL,
        "userId" text NOT NULL DEFAULT NULL,
        "type" text NOT NULL DEFAULT NULL,
        "provider" text NOT NULL DEFAULT NULL,
        "providerAccountId" text NOT NULL DEFAULT NULL,
        "refresh_token" text DEFAULT NULL,
        "access_token" text DEFAULT NULL,
        "expires_at" number DEFAULT NULL,
        "token_type" text DEFAULT NULL,
        "scope" text DEFAULT NULL,
        "id_token" text DEFAULT NULL,
        "session_state" text DEFAULT NULL,
        "oauth_token_secret" text DEFAULT NULL,
        "oauth_token" text DEFAULT NULL,
        PRIMARY KEY (id)
    );

CREATE TABLE
    IF NOT EXISTS "sessions" (
        "id" text NOT NULL,
        "sessionToken" text NOT NULL,
        "userId" text NOT NULL DEFAULT NULL,
        "expires" datetime NOT NULL DEFAULT NULL,
        PRIMARY KEY (sessionToken)
    );

CREATE TABLE
    IF NOT EXISTS "users" (
        "id" text NOT NULL DEFAULT '',
        "name" text DEFAULT NULL,
        "email" text DEFAULT NULL,
        "emailVerified" datetime DEFAULT NULL,
        "image" text DEFAULT NULL,
        "role" text DEFAULT 'USER',
        PRIMARY KEY (id)
    );

CREATE TABLE
    IF NOT EXISTS "verification_tokens" (
        "identifier" text NOT NULL,
        "token" text NOT NULL DEFAULT NULL,
        "expires" datetime NOT NULL DEFAULT NULL,
        PRIMARY KEY (token)
    );

CREATE TABLE
    IF NOT EXISTS `app` (
        `id` text PRIMARY KEY NOT NULL,
        `name` text NOT NULL,
        `secretKey` text NOT NULL,
        `enabled` integer DEFAULT true
    );

CREATE UNIQUE INDEX IF NOT EXISTS `app_secretKey_unique` ON `app` (`secretKey`);

CREATE TABLE
    IF NOT EXISTS `peerChannelSubscription` (
        `id` text PRIMARY KEY NOT NULL,
        `appId` text NOT NULL,
        `peerId` text NOT NULL,
        `channel` text NOT NULL,
        FOREIGN KEY (`appId`) REFERENCES `app` (`id`) ON UPDATE no action ON DELETE cascade,
        FOREIGN KEY (`peerId`) REFERENCES `peer` (`id`) ON UPDATE no action ON DELETE cascade
    );

CREATE INDEX IF NOT EXISTS `pcs_channelIdx` ON `peerChannelSubscription` (`channel`);

CREATE INDEX IF NOT EXISTS `pcs_appIdx` ON `peerChannelSubscription` (`appId`);

CREATE INDEX IF NOT EXISTS `pcs_peerIdx` ON `peerChannelSubscription` (`peerId`);

CREATE UNIQUE INDEX IF NOT EXISTS `pcs_unique` ON `peerChannelSubscription` (`appId`, `peerId`, `channel`);

CREATE TABLE
    IF NOT EXISTS `peer` (
        `id` text PRIMARY KEY NOT NULL,
        `appId` text NOT NULL,
        `type` text NOT NULL DEFAULT 'sink',
        `authenticatedUserId` text,
        `userInfo` text,
        FOREIGN KEY (`appId`) REFERENCES `app` (`id`) ON UPDATE no action ON DELETE cascade
    );

CREATE INDEX IF NOT EXISTS `peer_appIdx` ON `peer` (`appId`);

CREATE INDEX IF NOT EXISTS `peer_authIdx` ON `peer` (`authenticatedUserId`);

CREATE UNIQUE INDEX IF NOT EXISTS `peer_unique` ON `peer` (`id`, `appId`);