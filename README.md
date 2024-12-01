# Sinkr
Synchronize data to your clients in real time with websockets. Deploy on your own infrastructure!

## How to use
To deploy your own Sinkr instance, follow these steps:

1. Clone this repository
2. Run `pnpm install` in the root directory
3. In Cloudflare, ensure you have a domain you want to deploy to.
4. In GitHub, create a new GitHub OAuth app
   1. Make sure the app has the callback URL set to `<your domain>/api/auth/callback/github`
   2. Save your client ID and secret
5. Setup your Cloudflare workers
   1. Run `cd apps/app-manager`
   2. Run `pnpm wrangler login` to authenticate Wrangler
   3. Run `pnpm wrangler d1 create <your-database-name>` to create a D1 database.
      1. Copy the resulting database info (ID and name) into **BOTH** `apps/app-manager/wrangler.toml` AND `apps/deployment/wrangler.toml`
   4. In Cloudflare, create a new API token with `d1:write`
   5. Add the following environment variables to your environment:
      1. `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID
      2. `CLOUDFLARE_DATABASE_ID`: the Database ID of your D1 databasae
      3. `CLOUDFLARE_D1_TOKEN`: the API token created in step 4
   6. Run `pnpm drizzle-kit push` to push the database schema to your database
   7. Update `apps/app-manager/src/server/auth.ts:32` to add your own GitHub login as an administrator
   8. Add the following Cloudflare secrets:
      1. Run `pnpm wrangler secret put AUTH_SECRET`
      2. Paste a random, securely generated string of characters. I recommend using `openssl rand -base64 32`
      3. Run `pnpm wrangler secret put AUTH_GITHUB_ID`
      4. Paste your GitHub OAuth client ID from the app created in step 3
      5. Run `pnpm wrangler secret put AUTH_GITHUB_SECRET`
      6. Paste your GitHub OAuth client secret from the app created in step 3
   9. Run `pnpm deploy` to deploy your App Manager
   10. Run `cd ../deployment`
   11. Run `pnpm deploy` to deploy your Websocket manager
   12. Link your app manager and worker to your domain. 
       1. Make sure the subdomain you choose for your app manager matches the url you put into GitHub
6. Install the SDK in your app code
   1. For TypeScript apps of any kind, simply install `@sinkr/core` from JSR.
   2. For React apps, install `@sinkr/react` from JSR. This also exports `@sinkr/core` so installing both is not strictly necessary.
   3. For Python apps of any kind, install `sinkr` from PyPI
7. Done! Start sending and receiving messages!