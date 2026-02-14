import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  let templateCount = 0;
  let batchCount = 0;
  let totalImported = 0;
  const recentBatches: any[] = [];

  try {
    const templateResult = await db
      .prepare("SELECT COUNT(*) as count FROM prompt_templates WHERE shop = ?")
      .bind(session.shop)
      .first();
    templateCount = (templateResult?.count as number) || 0;

    const batchResult = await db
      .prepare("SELECT COUNT(*) as count FROM import_batches WHERE shop = ?")
      .bind(session.shop)
      .first();
    batchCount = (batchResult?.count as number) || 0;

    const importedResult = await db
      .prepare(
        "SELECT COALESCE(SUM(imported_products), 0) as total FROM import_batches WHERE shop = ?",
      )
      .bind(session.shop)
      .first();
    totalImported = (importedResult?.total as number) || 0;

    const recentResult = await db
      .prepare(
        "SELECT * FROM import_batches WHERE shop = ? ORDER BY created_at DESC LIMIT 5",
      )
      .bind(session.shop)
      .all();
    recentBatches.push(...recentResult.results);
  } catch {
    // Tables may not exist yet on first run
  }

  return { shop: session.shop, templateCount, batchCount, totalImported, recentBatches };
};

export default function Dashboard() {
  const { shop, templateCount, batchCount, totalImported, recentBatches } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Product Scrapper">
      <s-section>
        <s-paragraph>
          Welcome back! Manage your product imports, optimize content with AI, and keep your store updated.
        </s-paragraph>
      </s-section>

      <s-section heading="Quick Actions">
        <s-stack direction="block" gap="base">
          {/* First Row */}
          <s-stack direction="inline" gap="base">
            <Link to="/app/import" style={{ textDecoration: "none", flex: 1 }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                style={{
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  backgroundColor: "var(--p-color-bg-surface-hover)"
                }}
              >
                <s-stack direction="block" gap="tight" align="center">
                  <div style={{ fontSize: "48px", lineHeight: "1" }}>📦</div>
                  <s-heading>Import Products</s-heading>
                  <s-paragraph>
                    <s-text tone="subdued">Scrape products from external Shopify stores</s-text>
                  </s-paragraph>
                </s-stack>
              </s-box>
            </Link>
            <Link to="/app/optimize" style={{ textDecoration: "none", flex: 1 }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                style={{
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  backgroundColor: "var(--p-color-bg-surface-hover)"
                }}
              >
                <s-stack direction="block" gap="tight" align="center">
                  <div style={{ fontSize: "48px", lineHeight: "1" }}>✨</div>
                  <s-heading>Optimize Products</s-heading>
                  <s-paragraph>
                    <s-text tone="subdued">
                      Enhance existing products with AI-optimized content
                    </s-text>
                  </s-paragraph>
                </s-stack>
              </s-box>
            </Link>
          </s-stack>
          {/* Second Row */}
          <s-stack direction="inline" gap="base">
            <Link to="/app/batches" style={{ textDecoration: "none", flex: 1 }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                style={{
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  backgroundColor: "var(--p-color-bg-surface-hover)"
                }}
              >
                <s-stack direction="block" gap="tight" align="center">
                  <div style={{ fontSize: "48px", lineHeight: "1" }}>📊</div>
                  <s-heading>Import History</s-heading>
                  <s-paragraph>
                    <s-text tone="subdued">View all import batches and their status</s-text>
                  </s-paragraph>
                </s-stack>
              </s-box>
            </Link>
            <Link to="/app/templates" style={{ textDecoration: "none", flex: 1 }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                style={{
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  backgroundColor: "var(--p-color-bg-surface-hover)"
                }}
              >
                <s-stack direction="block" gap="tight" align="center">
                  <div style={{ fontSize: "48px", lineHeight: "1" }}>📝</div>
                  <s-heading>Templates</s-heading>
                  <s-paragraph>
                    <s-text tone="subdued">Create and manage prompt templates</s-text>
                  </s-paragraph>
                </s-stack>
              </s-box>
            </Link>
          </s-stack>
          {/* Third Row */}
          <s-stack direction="inline" gap="base">
            <Link to="/app/images" style={{ textDecoration: "none", flex: 1 }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                style={{
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  backgroundColor: "var(--p-color-bg-surface-hover)"
                }}
              >
                <s-stack direction="block" gap="tight" align="center">
                  <div style={{ fontSize: "48px", lineHeight: "1" }}>🖼️</div>
                  <s-heading>AI Images</s-heading>
                  <s-paragraph>
                    <s-text tone="subdued">Generate and enhance product images with AI</s-text>
                  </s-paragraph>
                </s-stack>
              </s-box>
            </Link>
            <Link to="/app/settings" style={{ textDecoration: "none", flex: 1 }}>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                style={{
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                  backgroundColor: "var(--p-color-bg-surface-hover)"
                }}
              >
                <s-stack direction="block" gap="tight" align="center">
                  <div style={{ fontSize: "48px", lineHeight: "1" }}>⚙️</div>
                  <s-heading>Settings</s-heading>
                  <s-paragraph>
                    <s-text tone="subdued">Configure default import settings</s-text>
                  </s-paragraph>
                </s-stack>
              </s-box>
            </Link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" style={{ flex: 1, textAlign: "center" }}>
            <s-heading>{totalImported}</s-heading>
            <s-text tone="subdued">Products Imported</s-text>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" style={{ flex: 1, textAlign: "center" }}>
            <s-heading>{batchCount}</s-heading>
            <s-text tone="subdued">Import Batches</s-text>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" style={{ flex: 1, textAlign: "center" }}>
            <s-heading>{templateCount}</s-heading>
            <s-text tone="subdued">Templates</s-text>
          </s-box>
        </s-stack>
      </s-section>

      {recentBatches.length > 0 && (
        <s-section heading="Recent Imports">
          <s-stack direction="block" gap="tight">
            {recentBatches.map((batch: any) => (
              <s-box key={batch.id} padding="tight" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="base" align="center">
                  <s-badge
                    tone={
                      batch.status === "completed"
                        ? "success"
                        : batch.status === "failed"
                          ? "critical"
                          : "warning"
                    }
                  >
                    {batch.status}
                  </s-badge>
                  <s-text fontWeight="semibold">
                    {batch.imported_products}/{batch.total_products} products
                  </s-text>
                  <s-text tone="subdued" variant="bodySm">
                    {new Date(batch.created_at * 1000).toLocaleDateString()}
                  </s-text>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Store">
        <s-paragraph>
          <s-text fontWeight="semibold">Connected Store:</s-text>
        </s-paragraph>
        <s-paragraph>
          <s-text>{shop}</s-text>
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Getting Started">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/settings">Configure your store settings</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/templates">Create prompt templates</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/import">Import your first products</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
