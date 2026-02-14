import { Link } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface ImportBatch {
  id: number;
  shop: string;
  status: string;
  total_products: number;
  imported_products: number | null;
  failed_products: number | null;
  source_urls: string;
  settings_snapshot: string;
  created_at: number;
  completed_at: number | null;
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  // Load all batches for this shop, most recent first
  const batchesResult = await db
    .prepare(
      `SELECT * FROM import_batches
       WHERE shop = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .bind(session.shop)
    .all();

  return {
    batches: batchesResult.results as unknown as ImportBatch[],
  };
};

export default function Batches() {
  const { batches } = useLoaderData<typeof loader>();

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const getStatusBadge = (batch: ImportBatch) => {
    if (batch.status === "completed") {
      return <s-badge tone="success">Completed</s-badge>;
    } else if (batch.status === "processing") {
      return <s-badge tone="info">Processing</s-badge>;
    } else if (batch.status === "failed") {
      return <s-badge tone="critical">Failed</s-badge>;
    }
    return <s-badge>{batch.status}</s-badge>;
  };

  const getSourceUrls = (batch: ImportBatch) => {
    try {
      const urls = JSON.parse(batch.source_urls);
      return Array.isArray(urls) ? urls : [];
    } catch {
      return [];
    }
  };

  return (
    <s-page heading="Import History">
      <s-section>
        <s-paragraph>
          View all your product import batches and their status.
        </s-paragraph>
      </s-section>

      {batches.length === 0 ? (
        <s-section>
          <s-box padding="base" style={{ textAlign: "center" }}>
            <s-stack direction="block" gap="base" align="center">
              <div style={{ fontSize: "48px" }}>📦</div>
              <s-heading>No import history yet</s-heading>
              <s-paragraph>
                <s-text tone="subdued">
                  Your product imports will appear here once you start importing products.
                </s-text>
              </s-paragraph>
              <Link to="/app/import" style={{ textDecoration: "none" }}>
                <s-button variant="primary">Import Products</s-button>
              </Link>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {batches.map((batch) => {
              const sourceUrls = getSourceUrls(batch);
              const successRate = batch.imported_products && batch.total_products
                ? Math.round((batch.imported_products / batch.total_products) * 100)
                : 0;

              return (
                <Link
                  key={batch.id}
                  to={`/app/batches/${batch.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    style={{
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      backgroundColor: "var(--p-color-bg-surface)",
                    }}
                  >
                    <s-stack direction="block" gap="base">
                      {/* Header Row */}
                      <s-stack direction="inline" gap="base" align="center">
                        <div style={{ flex: 1 }}>
                          <s-stack direction="inline" gap="base" align="center">
                            <s-text fontWeight="semibold">Batch #{batch.id}</s-text>
                            {getStatusBadge(batch)}
                          </s-stack>
                        </div>
                        <s-text tone="subdued" variant="bodySm">
                          {formatDate(batch.created_at)}
                        </s-text>
                      </s-stack>

                      {/* Stats Row */}
                      <s-stack direction="inline" gap="base">
                        <div style={{ flex: 1 }}>
                          <s-text variant="bodySm" tone="subdued">
                            Total Products
                          </s-text>
                          <div>
                            <s-text fontWeight="semibold">{batch.total_products}</s-text>
                          </div>
                        </div>

                        {batch.status === "completed" && (
                          <>
                            <div style={{ flex: 1 }}>
                              <s-text variant="bodySm" tone="subdued">
                                Imported
                              </s-text>
                              <div>
                                <s-text fontWeight="semibold" tone="success">
                                  {batch.imported_products || 0}
                                </s-text>
                              </div>
                            </div>

                            {(batch.failed_products || 0) > 0 && (
                              <div style={{ flex: 1 }}>
                                <s-text variant="bodySm" tone="subdued">
                                  Failed
                                </s-text>
                                <div>
                                  <s-text fontWeight="semibold" tone="critical">
                                    {batch.failed_products}
                                  </s-text>
                                </div>
                              </div>
                            )}

                            <div style={{ flex: 1 }}>
                              <s-text variant="bodySm" tone="subdued">
                                Success Rate
                              </s-text>
                              <div>
                                <s-text fontWeight="semibold">{successRate}%</s-text>
                              </div>
                            </div>
                          </>
                        )}
                      </s-stack>

                      {/* Source URLs */}
                      {sourceUrls.length > 0 && (
                        <div>
                          <s-text variant="bodySm" tone="subdued">
                            Source: {sourceUrls.length} URL{sourceUrls.length > 1 ? "s" : ""}
                          </s-text>
                        </div>
                      )}
                    </s-stack>
                  </s-box>
                </Link>
              );
            })}
          </div>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
