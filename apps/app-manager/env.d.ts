// Generated by Wrangler by running `wrangler types --env-interface CloudflareEnv env.d.ts --experimental-include-runtime`

interface CloudflareEnv {
	AUTH_SECRET: string;
	AUTH_GITHUB_ID: string;
	AUTH_GITHUB_SECRET: string;
	DEPLOYMENT_ENV: string;
	DEPLOYMENT_URL: string;
	NEXTJS_ENV: string;
	DATABASE: D1Database;
	ASSETS: Fetcher;
}
