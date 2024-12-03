import type {
  AdapterAccount,
  AdapterSession,
  AdapterUser,
  VerificationToken as AdapterVerificationToken,
} from "@auth/core/adapters";
import type { D1Database as WorkerDatabase } from "@cloudflare/workers-types";
import type { D1Database as MiniflareD1Database } from "@miniflare/d1";
import { isDate } from "@auth/core/adapters";

import {
  CREATE_ACCOUNT_SQL,
  CREATE_SESSION_SQL,
  CREATE_USER_SQL,
  CREATE_VERIFICATION_TOKEN_SQL,
  DELETE_ACCOUNT_BY_PROVIDER_AND_PROVIDER_ACCOUNT_ID_SQL,
  DELETE_ACCOUNT_BY_USER_ID_SQL,
  DELETE_SESSION_BY_USER_ID_SQL,
  DELETE_SESSION_SQL,
  DELETE_USER_SQL,
  DELETE_VERIFICATION_TOKEN_SQL,
  GET_ACCOUNT_BY_ID_SQL,
  GET_SESSION_BY_TOKEN_SQL,
  GET_USER_BY_ACCOUNTL_SQL,
  GET_USER_BY_EMAIL_SQL,
  GET_USER_BY_ID_SQL,
  GET_VERIFICATION_TOKEN_BY_IDENTIFIER_AND_TOKEN_SQL,
  UPDATE_SESSION_BY_SESSION_TOKEN_SQL,
  UPDATE_USER_BY_ID_SQL,
} from "./queries";

/**
 * @type @cloudflare/workers-types.D1Database | @miniflare/d1.D1Database
 */
export type D1Database = WorkerDatabase | MiniflareD1Database;

type AdapterExt = AdapterUser & {
  role: "ADMIN" | "USER";
};

// format is borrowed from the supabase adapter, graciously
function format<T>(obj: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      delete obj[key];
    }

    if (isDate(value)) {
      obj[key] = new Date(value);
    }
  }

  return obj as T;
}

// D1 doesnt like undefined, it wants null when calling bind
function cleanBindings(bindings: unknown[]) {
  return bindings.map((e) => (e === undefined ? null : e));
}

export async function createRecord<RecordType>(
  db: D1Database,
  CREATE_SQL: string,
  bindings: unknown[],
  GET_SQL: string,
  getBindings: unknown[],
) {
  try {
    bindings = cleanBindings(bindings);
    await db
      .prepare(CREATE_SQL)
      .bind(...bindings)
      .run();
    return await getRecord<RecordType>(db, GET_SQL, getBindings);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    console.error(e.message, e.cause?.message);
    throw e;
  }
}

export async function getRecord<RecordType>(
  db: D1Database,
  SQL: string,
  bindings: unknown[],
): Promise<RecordType | null> {
  try {
    bindings = cleanBindings(bindings);
    const res = await db
      .prepare(SQL)
      .bind(...bindings)
      .first();
    if (res) {
      return format<RecordType>(res);
    } else {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    console.error(e.message, e.cause?.message);
    throw e;
  }
}

export async function updateRecord(
  db: D1Database,
  SQL: string,
  bindings: unknown[],
) {
  try {
    bindings = cleanBindings(bindings);
    return await db
      .prepare(SQL)
      .bind(...bindings)
      .run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    console.error(e.message, e.cause?.message);
    throw e;
  }
}

export async function deleteRecord(
  db: D1Database,
  SQL: string,
  bindings: unknown[],
) {
  try {
    bindings = cleanBindings(bindings);
    await db
      .prepare(SQL)
      .bind(...bindings)
      .run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    console.error(e.message, e.cause?.message);
    throw e;
  }
}

export function CustomD1Adapter(db: D1Database) {
  // we need to run migrations if we dont have the right tables

  return {
    async createUser(user: AdapterUser) {
      const id: string = crypto.randomUUID();
      const createBindings = [
        id,
        user.name,
        user.email,
        user.emailVerified?.toISOString(),
        user.image,
      ];
      const getBindings = [id];

      const newUser = await createRecord<AdapterExt>(
        db,
        CREATE_USER_SQL,
        createBindings,
        GET_USER_BY_ID_SQL,
        getBindings,
      );
      if (newUser) return newUser;
      throw new Error("Error creating user: Cannot get user after creation.");
    },
    async getUser(id: string) {
      return await getRecord<AdapterExt>(db, GET_USER_BY_ID_SQL, [id]);
    },
    async getUserByEmail(email: string) {
      return await getRecord<AdapterExt>(db, GET_USER_BY_EMAIL_SQL, [email]);
    },
    async getUserByAccount({
      providerAccountId,
      provider,
    }: {
      providerAccountId: string;
      provider: string;
    }) {
      return await getRecord<AdapterExt>(db, GET_USER_BY_ACCOUNTL_SQL, [
        providerAccountId,
        provider,
      ]);
    },
    async updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
      const params = await getRecord<AdapterExt>(db, GET_USER_BY_ID_SQL, [
        user.id,
      ]);
      if (params) {
        // copy any properties not in the update into the existing one and use that for bind params
        // covers the scenario where the user arg doesnt have all of the current users properties
        Object.assign(params, user);
        const res = await updateRecord(db, UPDATE_USER_BY_ID_SQL, [
          params.name,
          params.email,
          params.emailVerified?.toISOString(),
          params.image,
          params.id,
        ]);
        if (res.success) {
          const user = await getRecord<AdapterExt>(db, GET_USER_BY_ID_SQL, [
            params.id,
          ]);
          if (user) return user;
          throw new Error(
            "Error updating user: Cannot get user after updating.",
          );
        }
      }
      throw new Error("Error updating user: Failed to run the update SQL.");
    },
    async deleteUser(userId: string) {
      // miniflare doesn't support batch operations or multiline sql statements
      await deleteRecord(db, DELETE_ACCOUNT_BY_USER_ID_SQL, [userId]);
      await deleteRecord(db, DELETE_SESSION_BY_USER_ID_SQL, [userId]);
      await deleteRecord(db, DELETE_USER_SQL, [userId]);
      return null;
    },
    async linkAccount(a: AdapterAccount) {
      // convert user_id to userId and provider_account_id to providerAccountId
      const id = crypto.randomUUID();
      const createBindings = [
        id,
        a.userId,
        a.type,
        a.provider,
        a.providerAccountId,
        a.refresh_token,
        a.access_token,
        a.expires_at,
        a.token_type,
        a.scope,
        a.id_token,
        a.session_state,
        a.oauth_token ?? null,
        a.oauth_token_secret ?? null,
      ];
      const getBindings = [id];
      return await createRecord<AdapterAccount>(
        db,
        CREATE_ACCOUNT_SQL,
        createBindings,
        GET_ACCOUNT_BY_ID_SQL,
        getBindings,
      );
    },
    async unlinkAccount({
      providerAccountId,
      provider,
    }: {
      providerAccountId: string;
      provider: string;
    }) {
      await deleteRecord(
        db,
        DELETE_ACCOUNT_BY_PROVIDER_AND_PROVIDER_ACCOUNT_ID_SQL,
        [provider, providerAccountId],
      );
    },
    async createSession({
      sessionToken,
      userId,
      expires,
    }: {
      sessionToken: string;
      userId: string;
      expires: Date;
    }) {
      const id = crypto.randomUUID();
      const createBindings = [id, sessionToken, userId, expires.toISOString()];
      const getBindings = [sessionToken];
      const session = await createRecord<AdapterSession>(
        db,
        CREATE_SESSION_SQL,
        createBindings,
        GET_SESSION_BY_TOKEN_SQL,
        getBindings,
      );
      if (session) return session;
      throw new Error(`Couldn't create session`);
    },
    async getSessionAndUser(sessionToken: string) {
      const session = await getRecord<AdapterSession>(
        db,
        GET_SESSION_BY_TOKEN_SQL,
        [sessionToken],
      );
      if (session === null) return null;

      const user = await getRecord<AdapterExt>(db, GET_USER_BY_ID_SQL, [
        session.userId,
      ]);
      if (user === null) return null;

      return { session, user };
    },
    async updateSession({
      sessionToken,
      expires,
    }: {
      sessionToken: string;
      expires?: Date;
    }) {
      if (expires === undefined) {
        await deleteRecord(db, DELETE_SESSION_SQL, [sessionToken]);
        return null;
      }
      const session = await getRecord<AdapterSession>(
        db,
        GET_SESSION_BY_TOKEN_SQL,
        [sessionToken],
      );
      if (!session) return null;
      session.expires = expires;
      await updateRecord(db, UPDATE_SESSION_BY_SESSION_TOKEN_SQL, [
        expires.toISOString(),
        sessionToken,
      ]);
      return await getRecord<AdapterSession>(db, GET_SESSION_BY_TOKEN_SQL, [
        sessionToken,
      ]);
    },
    async deleteSession(sessionToken: string) {
      await deleteRecord(db, DELETE_SESSION_SQL, [sessionToken]);
      return null;
    },
    async createVerificationToken({
      identifier,
      expires,
      token,
    }: {
      identifier: string;
      expires: Date;
      token: string;
    }) {
      return await createRecord<AdapterVerificationToken>(
        db,
        CREATE_VERIFICATION_TOKEN_SQL,
        [identifier, expires.toISOString(), token],
        GET_VERIFICATION_TOKEN_BY_IDENTIFIER_AND_TOKEN_SQL,
        [identifier, token],
      );
    },
    async useVerificationToken({
      identifier,
      token,
    }: {
      identifier: string;
      token: string;
    }) {
      const verificationToken = await getRecord<AdapterVerificationToken>(
        db,
        GET_VERIFICATION_TOKEN_BY_IDENTIFIER_AND_TOKEN_SQL,
        [identifier, token],
      );
      if (!verificationToken) return null;
      await deleteRecord(db, DELETE_VERIFICATION_TOKEN_SQL, [
        identifier,
        token,
      ]);
      return verificationToken;
    },
  };
}
