import { DurableObject } from "cloudflare:workers";

import { ServerEndpointSchema } from "@sinkr/validators";

import { handleSource, ws } from "./server";
import { getDB, init } from "./utils";

export class $DurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    init(env);
    ws.handleDurableInit(this, ctx, env);
  }

  async fetch(request: Request) {
    console.log("On durable object fetch");

    if (request.headers.get("Upgrade") === "websocket") {
      return ws.handleDurableUpgrade(this, request);
    }

    const reqUrl = new URL(request.url);
    const [_, appId] = reqUrl.pathname.split("/");
    if (!appId) {
      return new Response("Not found", { status: 404 });
    }
    const db = getDB();
    const app = await db.query.apps.findFirst({
      where: (a, ops) => ops.and(ops.eq(a.id, appId), ops.eq(a.enabled, true)),
    });
    if (!app) {
      return new Response("Not found", { status: 404 });
    }
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }
    const [authMethod, token] = authHeader.split(" ");
    if (!token || authMethod !== "Bearer") {
      return new Response("Unauthorized", { status: 401 });
    }
    if (token !== app.secretKey) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = await request.json().catch(() => null);
    const parsed = ServerEndpointSchema.safeParse(body);
    if (!parsed.success) {
      return new Response("Invalid request", { status: 400 });
    }
    const data = parsed.data;
    return handleSource(data, appId);
  }

  webSocketMessage(client: WebSocket, message: string | ArrayBuffer) {
    console.log("On durable object message");
    return ws.handleDurableMessage(this, client, message);
  }

  webSocketClose(
    client: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    console.log("On durable object close");
    return ws.handleDurableClose(this, client, code, reason, wasClean);
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return ws.handleUpgrade(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
