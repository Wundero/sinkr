import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  tablesFilter: ['/^(?!.*_cf_KV).*$/'],
  schema: "./src/server/db/schema.ts",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
});
