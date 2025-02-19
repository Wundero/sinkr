import { AsyncLocalStorage } from "async_hooks";
import { DurableObject } from "cloudflare:workers";

import type {
  RouteRequestSchema,
  RouteResponseSchema,
  ServerRoute,
} from "@sinkr/validators";
import { ServerRequestSchema } from "@sinkr/validators";

import { getCoordinatorInstance, getPeers, handleSource, ws } from "./server";
import { getDB, init } from "./utils";

export const MAX_CONNECTIONS_PER_OBJECT = 500;

const coordinatorCtx = new AsyncLocalStorage<ObjectCoordinator>();

export function getCoordinator() {
  return coordinatorCtx.getStore();
}

export class ObjectCoordinator extends DurableObject<Env> {
  private sql: SqlStorage;
  private handlerCache = new Map<string, DurableObjectStub<SocketHandler>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    init(env);
    ws.handleDurableInit(this, ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`CREATE TABLE IF NOT EXISTS handler(
        id TEXT PRIMARY KEY,
        conns INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS handler_conns ON handler(conns);
      `);
  }

  private getBinding(id: string) {
    const cached = this.handlerCache.get(id);
    if (cached) {
      return cached;
    }
    const binding = this.env.SocketHandler;
    const objId = binding.idFromString(id);
    const obj = binding.get(objId);
    this.handlerCache.set(id, obj);
    return obj;
  }

  async distribute<TRoute extends ServerRoute>({
    id,
    appId,
    data,
  }: {
    id: string;
    appId: string;
    data: RouteRequestSchema<TRoute>;
  }): Promise<({ id: string } & RouteResponseSchema<TRoute>)[]> {
    const cursor = this.sql.exec<{ id: string }>("SELECT id FROM handler;");
    const promises = [];
    for (const { id: handlerId } of cursor) {
      const handler = this.getBinding(handlerId);
      promises.push(handler.process({ id, appId, data }));
    }
    return Promise.all(promises);
  }

  updateConnections(bindingId: string, connections: number) {
    this.sql.exec(
      `UPDATE handler SET conns = ? WHERE id = ?;`,
      connections,
      bindingId,
    );
  }

  async fetch(request: Request) {
    return coordinatorCtx.run(this, async () => {
      if (request.headers.get("Upgrade") === "websocket") {
        const reqUrl = new URL(request.url);
        const appKey =
          reqUrl.searchParams.get("sinkrKey") ??
          reqUrl.searchParams.get("appKey");
        if (
          appKey ||
          request.headers.get("Authorization") ===
            `Bearer ${this.env.COORDINATION_SECRET}`
        ) {
          return ws.handleDurableUpgrade(this, request);
        }

        const [handler] = this.sql
          .exec<{
            id: string;
          }>(
            `SELECT id FROM handler WHERE conns <= ${MAX_CONNECTIONS_PER_OBJECT} ORDER BY conns ASC LIMIT 1;`,
          )
          .toArray();
        const cached = handler ? this.handlerCache.get(handler.id) : null;
        if (cached) {
          return cached.fetch(request);
        }
        const binding = this.env.SocketHandler;
        const id = handler
          ? binding.idFromString(handler.id)
          : binding.newUniqueId();
        if (!handler) {
          this.sql.exec(
            `INSERT INTO handler(id, conns) VALUES (?, 0);`,
            id.toString(),
          );
        }
        const bound = binding.get(id);
        this.handlerCache.set(id.toString(), bound);
        return bound.fetch(request);
      }

      if (request.method === "POST") {
        const reqUrl = new URL(request.url);
        const [_, appId] = reqUrl.pathname.split("/");
        if (!appId) {
          return new Response("Not found", { status: 404 });
        }
        const db = getDB();
        const app = await db.query.apps.findFirst({
          where: (a, ops) =>
            ops.and(ops.eq(a.id, appId), ops.eq(a.enabled, true)),
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
        const bodyBuf = (await request.json().catch(() => null)) as {
          data: unknown;
          id: string;
        };
        const { data: body, id } = bodyBuf;
        const parsed = ServerRequestSchema.safeParse(body);
        if (!parsed.success || "response" in parsed.data) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Invalid request",
            }),
            { status: 400 },
          );
        }
        const data = parsed.data;
        const info = await handleSource(id, data, appId);
        return new Response(
          JSON.stringify({
            id,
            route: data.route,
            response: info,
          }),
          {
            status: info.success ? 200 : 400,
          },
        );
      }

      return new Response("Not found", {
        status: 404,
      });
    });
  }

  webSocketMessage(client: WebSocket, message: string | ArrayBuffer) {
    return coordinatorCtx.run(this, () => {
      console.log("On durable object message");
      return ws.handleDurableMessage(this, client, message);
    });
  }

  webSocketClose(
    client: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    return coordinatorCtx.run(this, () => {
      console.log("On durable object close");
      if (code === 1000) {
        return ws.handleDurableClose(this, client, 4192, "Done", wasClean);
      }
      return ws.handleDurableClose(this, client, code, reason, wasClean);
    });
  }
}

export class SocketHandler extends DurableObject<Env> {
  private coordinator: DurableObjectStub<ObjectCoordinator>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    init(env);
    ws.handleDurableInit(this, ctx, env);
    this.coordinator = getCoordinatorInstance(env);
  }

  private async updateCoordinator() {
    const conns = getPeers().size;
    await this.coordinator.updateConnections(this.ctx.id.toString(), conns);
  }

  async process<TRoute extends ServerRoute>({
    id,
    data,
    appId,
  }: {
    id: string;
    appId: string;
    data: RouteRequestSchema<TRoute>;
  }): Promise<RouteResponseSchema<TRoute> & { id: string }> {
    const info = await handleSource<TRoute>(id, data, appId);
    return {
      id,
      route: data.route,
      response: info,
    } as RouteResponseSchema<TRoute> & { id: string };
  }

  async fetch(request: Request) {
    console.log("On durable object fetch");

    if (request.headers.get("Upgrade") === "websocket") {
      const res = await ws.handleDurableUpgrade(this, request);
      this.ctx.waitUntil(this.updateCoordinator());
      return res;
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
    const bodyBuf = (await request.json().catch(() => null)) as {
      data: unknown;
      id: string;
    };
    const { data: body, id } = bodyBuf;
    const parsed = ServerRequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request",
        }),
        { status: 400 },
      );
    }
    const data = parsed.data;
    const info = await this.process({ id, data, appId });
    return new Response(JSON.stringify(info), {
      status: info.response.success ? 200 : 400,
    });
  }

  webSocketMessage(client: WebSocket, message: string | ArrayBuffer) {
    console.log("On durable object message");
    return ws.handleDurableMessage(this, client, message);
  }

  async webSocketClose(
    client: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    console.log("On durable object close");
    await ws.handleDurableClose(this, client, code, reason, wasClean);
    this.ctx.waitUntil(this.updateCoordinator());
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return ws.handleUpgrade(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
