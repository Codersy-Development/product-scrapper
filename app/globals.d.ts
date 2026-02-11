declare module "*.css";

interface CloudflareEnv {
  DB: import("@cloudflare/workers-types").D1Database;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SCOPES: string;
  SHOPIFY_APP_URL: string;
  SHOP_CUSTOM_DOMAIN?: string;
  GEMINI_API_KEY: string;
  VALUE_FROM_CLOUDFLARE: string;
}
