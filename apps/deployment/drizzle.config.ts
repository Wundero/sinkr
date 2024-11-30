import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  driver: "d1-http",
  dbCredentials: {
    // @ts-expect-error - Process is defined here because this is run via CLI
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    // @ts-expect-error - Process is defined here because this is run via CLI
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    // @ts-expect-error - Process is defined here because this is run via CLI
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
});
