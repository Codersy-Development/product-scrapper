import { D1Database } from "@cloudflare/workers-types";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";

// Define type for the global DB and env
declare global {
  var shopifyDb: D1Database | undefined;
  var shopifyAppInstance: ReturnType<typeof shopifyApp> | undefined;
  var shopifyEnv: Record<string, string> | undefined;
}

// Create a D1 session storage adapter
class D1SessionStorage implements SessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    const db = globalThis.shopifyDb;
    if (!db) {
      console.error("D1 database not initialized");
      return false;
    }

    try {
      // Extract user info from onlineAccessInfo if available
      const userInfo = session.onlineAccessInfo
        ? {
            userId: session.onlineAccessInfo.associated_user?.id || null,
            firstName:
              session.onlineAccessInfo.associated_user?.first_name || null,
            lastName:
              session.onlineAccessInfo.associated_user?.last_name || null,
            email: session.onlineAccessInfo.associated_user?.email || null,
            accountOwner: session.onlineAccessInfo.associated_user
              ?.account_owner
              ? 1
              : 0,
            locale: session.onlineAccessInfo.associated_user?.locale || null,
            collaborator: session.onlineAccessInfo.associated_user?.collaborator
              ? 1
              : 0,
            emailVerified: session.onlineAccessInfo.associated_user
              ?.email_verified
              ? 1
              : 0,
          }
        : {
            userId: null,
            firstName: null,
            lastName: null,
            email: null,
            accountOwner: 0,
            locale: null,
            collaborator: 0,
            emailVerified: 0,
          };

      await db
        .prepare(
          `
        INSERT OR REPLACE INTO sessions
        (id, shop, state, isOnline, scope, accessToken, expires, userId, firstName, lastName, email, accountOwner, locale, collaborator, emailVerified, refreshToken, refreshTokenExpires)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .bind(
          session.id || null,
          session.shop || null,
          session.state || null,
          session.isOnline ? 1 : 0,
          session.scope || null,
          session.accessToken || null,
          session.expires ? session.expires.getTime() : null,
          userInfo.userId,
          userInfo.firstName,
          userInfo.lastName,
          userInfo.email,
          userInfo.accountOwner,
          userInfo.locale,
          userInfo.collaborator,
          userInfo.emailVerified,
          session.refreshToken || null,
          session.refreshTokenExpires
            ? session.refreshTokenExpires.getTime()
            : null,
        )
        .run();
      return true;
    } catch (error) {
      console.error("Failed to store session:", error);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const db = globalThis.shopifyDb;
    if (!db) {
      console.error("D1 database not initialized");
      return undefined;
    }

    try {
      const result = await db
        .prepare(
          `
        SELECT * FROM sessions WHERE id = ?
      `,
        )
        .bind(id || null)
        .first();

      if (!result) return undefined;

      const session = new Session({
        id: result.id as string,
        shop: result.shop as string,
        state: result.state as string,
        isOnline: Boolean(result.isOnline),
      });

      session.scope = result.scope as string;
      session.accessToken = result.accessToken as string;

      if (result.expires) {
        session.expires = new Date(result.expires as number);
      }

      // Load refresh token data for offline access tokens
      if (result.refreshToken) {
        session.refreshToken = result.refreshToken as string;
      }

      if (result.refreshTokenExpires) {
        session.refreshTokenExpires = new Date(
          result.refreshTokenExpires as number,
        );
      }

      // Reconstruct onlineAccessInfo if we have user data
      if (result.userId) {
        session.onlineAccessInfo = {
          expires_in: result.expires
            ? Math.floor(((result.expires as number) - Date.now()) / 1000)
            : 0,
          associated_user_scope: result.scope as string,
          associated_user: {
            id: result.userId as number,
            first_name: result.firstName as string,
            last_name: result.lastName as string,
            email: result.email as string,
            account_owner: Boolean(result.accountOwner),
            locale: result.locale as string,
            collaborator: Boolean(result.collaborator),
            email_verified: Boolean(result.emailVerified),
          },
        };
      }

      return session;
    } catch (error) {
      console.error("Failed to load session:", error);
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    const db = globalThis.shopifyDb;
    if (!db) {
      console.error("D1 database not initialized");
      return false;
    }

    try {
      await db
        .prepare(
          `
        DELETE FROM sessions WHERE id = ?
      `,
        )
        .bind(id || null)
        .run();
      return true;
    } catch (error) {
      console.error("Failed to delete session:", error);
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    const db = globalThis.shopifyDb;
    if (!db) {
      console.error("D1 database not initialized");
      return false;
    }

    try {
      for (const id of ids) {
        await this.deleteSession(id);
      }
      return true;
    } catch (error) {
      console.error("Failed to delete sessions:", error);
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const db = globalThis.shopifyDb;
    if (!db) {
      console.error("D1 database not initialized");
      return [];
    }

    try {
      const results = await db
        .prepare(
          `
        SELECT * FROM sessions WHERE shop = ?
      `,
        )
        .bind(shop || null)
        .all();

      return results.results.map((result) => {
        const session = new Session({
          id: result.id as string,
          shop: result.shop as string,
          state: result.state as string,
          isOnline: Boolean(result.isOnline),
        });

        session.scope = result.scope as string;
        session.accessToken = result.accessToken as string;

        if (result.expires) {
          session.expires = new Date(result.expires as number);
        }

        // Load refresh token data for offline access tokens
        if (result.refreshToken) {
          session.refreshToken = result.refreshToken as string;
        }

        if (result.refreshTokenExpires) {
          session.refreshTokenExpires = new Date(
            result.refreshTokenExpires as number,
          );
        }

        // Reconstruct onlineAccessInfo if we have user data
        if (result.userId) {
          session.onlineAccessInfo = {
            expires_in: result.expires
              ? Math.floor(((result.expires as number) - Date.now()) / 1000)
              : 0,
            associated_user_scope: result.scope as string,
            associated_user: {
              id: result.userId as number,
              first_name: result.firstName as string,
              last_name: result.lastName as string,
              email: result.email as string,
              account_owner: Boolean(result.accountOwner),
              locale: result.locale as string,
              collaborator: Boolean(result.collaborator),
              email_verified: Boolean(result.emailVerified),
            },
          };
        }

        return session;
      });
    } catch (error) {
      console.error("Failed to find sessions by shop:", error);
      return [];
    }
  }
}

// Create a single instance of the session storage
const sessionStorage = new D1SessionStorage();

// Function to get or create the Shopify app instance
// Env is set per-request via setupShopify() called from workers/app.ts
function getShopifyApp() {
  if (!globalThis.shopifyAppInstance) {
    const env = globalThis.shopifyEnv || {};

    globalThis.shopifyAppInstance = shopifyApp({
      apiKey: env.SHOPIFY_API_KEY || "",
      apiSecretKey: env.SHOPIFY_API_SECRET || "",
      apiVersion: ApiVersion.April26,
      scopes: env.SCOPES?.split(","),
      appUrl: env.SHOPIFY_APP_URL || "",
      authPathPrefix: "/auth",
      sessionStorage,
      distribution: AppDistribution.AppStore,
      // future: {
      //   expiringOfflineAccessTokens: true, // Enable expiring offline tokens
      // },
      ...(env.SHOP_CUSTOM_DOMAIN
        ? { customShopDomains: [env.SHOP_CUSTOM_DOMAIN] }
        : {}),
    });
  }
  return globalThis.shopifyAppInstance;
}

export const apiVersion = ApiVersion.April26;

// Lazy-load the shopify app when these functions are called
export const addDocumentResponseHeaders = (
  response: Response,
  request: Request,
) => {
  return getShopifyApp().addDocumentResponseHeaders(response, request);
};

export const authenticate = {
  admin: (request: Request) => {
    return getShopifyApp().authenticate.admin(request);
  },
  public: (request: Request) => {
    return getShopifyApp().authenticate.public(request);
  },
  webhook: (request: Request) => {
    return getShopifyApp().authenticate.webhook(request);
  },
};

export const unauthenticated = {
  admin: (request: Request) => {
    return getShopifyApp().unauthenticated.admin(request);
  },
  public: (request: Request) => {
    return getShopifyApp().unauthenticated.public(request);
  },
};

export const login = (request: Request) => {
  return getShopifyApp().login(request);
};

export const registerWebhooks = (request: Request) => {
  return getShopifyApp().registerWebhooks(request);
};

// Function to initialize the database for the session storage
export async function initializeDb(db: D1Database) {
  try {
    // Create the sessions table if it doesn't exist - all on one line
    await db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, shop TEXT NOT NULL, state TEXT, isOnline INTEGER, scope TEXT, accessToken TEXT, expires INTEGER, userId INTEGER, firstName TEXT, lastName TEXT, email TEXT, accountOwner INTEGER, locale TEXT, collaborator INTEGER, emailVerified INTEGER, refreshToken TEXT, refreshTokenExpires INTEGER)`,
    );

    // Set the global DB instance
    globalThis.shopifyDb = db;

    console.log("D1 database initialized successfully for session storage");
    return true;
  } catch (error) {
    console.error("Failed to initialize D1 database:", error);
    return false;
  }
}

// Initialize Shopify with environment from Cloudflare Workers context
export function setupShopify(env: any) {
  // Store env globally so getShopifyApp() can access it
  if (env && !globalThis.shopifyEnv) {
    globalThis.shopifyEnv = env;
  }

  // Set D1 database binding immediately (table is created by migrations)
  if (env?.DB && !globalThis.shopifyDb) {
    globalThis.shopifyDb = env.DB;
    console.log("D1 database initialized for session storage");
  }
}

export default {
  apiVersion,
  authenticate,
  unauthenticated,
  login,
  registerWebhooks,
  addDocumentResponseHeaders,
};
