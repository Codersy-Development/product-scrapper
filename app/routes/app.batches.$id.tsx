import { useNavigate } from "react-router";
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

export const loader = async ({ request, params, context }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  const batch = await db
    .prepare("SELECT * FROM import_batches WHERE id = ? AND shop = ?")
    .bind(params.id, session.shop)
    .first();

  if (!batch) {
    throw new Response("Batch not found", { status: 404 });
  }

  return {
    batch: batch as unknown as ImportBatch,
  };
};

export default function BatchDetail() {
  const { batch } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatDuration = () => {
    if (!batch.completed_at) return "In progress...";
    const duration = batch.completed_at - batch.created_at;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  };

  const getStatusBadge = () => {
    if (batch.status === "completed") {
      return <s-badge tone="success">Completed</s-badge>;
    } else if (batch.status === "processing") {
      return <s-badge tone="info">Processing</s-badge>;
    } else if (batch.status === "failed") {
      return <s-badge tone="critical">Failed</s-badge>;
    }
    return <s-badge>{batch.status}</s-badge>;
  };

  const getSourceUrls = () => {
    try {
      const urls = JSON.parse(batch.source_urls);
      return Array.isArray(urls) ? urls : [];
    } catch {
      return [];
    }
  };

  const getSettings = () => {
    try {
      return JSON.parse(batch.settings_snapshot);
    } catch {
      return null;
    }
  };

  const sourceUrls = getSourceUrls();
  const settings = getSettings();
  const successRate = batch.imported_products && batch.total_products
    ? Math.round((batch.imported_products / batch.total_products) * 100)
    : 0;

  return (
    <s-page heading={`Import Batch #${batch.id}`}>
      <s-button slot="primary-action" onClick={() => navigate("/app/batches")} variant="tertiary">
        Back to History
      </s-button>

      {/* Status Overview */}
      <s-section heading="Status">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" align="center">
            <s-text fontWeight="semibold">Status:</s-text>
            {getStatusBadge()}
          </s-stack>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="tight">
                <s-text tone="subdued" variant="bodySm">Total Products</s-text>
                <s-heading>{batch.total_products}</s-heading>
              </s-stack>
            </s-box>

            {batch.status === "completed" && (
              <>
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="tight">
                    <s-text tone="subdued" variant="bodySm">Imported</s-text>
                    <s-heading>{batch.imported_products || 0}</s-heading>
                  </s-stack>
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="tight">
                    <s-text tone="subdued" variant="bodySm">Failed</s-text>
                    <s-heading>{batch.failed_products || 0}</s-heading>
                  </s-stack>
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="tight">
                    <s-text tone="subdued" variant="bodySm">Success Rate</s-text>
                    <s-heading>{successRate}%</s-heading>
                  </s-stack>
                </s-box>
              </>
            )}
          </div>
        </s-stack>
      </s-section>

      {/* Timeline */}
      <s-section heading="Timeline">
        <s-stack direction="block" gap="base">
          <div>
            <s-text tone="subdued" variant="bodySm">Started</s-text>
            <div><s-text>{formatDate(batch.created_at)}</s-text></div>
          </div>

          {batch.completed_at && (
            <>
              <div>
                <s-text tone="subdued" variant="bodySm">Completed</s-text>
                <div><s-text>{formatDate(batch.completed_at)}</s-text></div>
              </div>

              <div>
                <s-text tone="subdued" variant="bodySm">Duration</s-text>
                <div><s-text>{formatDuration()}</s-text></div>
              </div>
            </>
          )}
        </s-stack>
      </s-section>

      {/* Source URLs */}
      {sourceUrls.length > 0 && (
        <s-section heading={`Source URLs (${sourceUrls.length})`}>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              {sourceUrls.map((url: string, idx: number) => (
                <div key={idx} style={{
                  fontSize: "13px",
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                  padding: "4px 0"
                }}>
                  {url}
                </div>
              ))}
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Settings Snapshot */}
      {settings && (
        <s-section heading="Import Settings">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px" }}>
              {settings.vendor && (
                <div>
                  <s-text tone="subdued" variant="bodySm">Vendor</s-text>
                  <div><s-text>{settings.vendor}</s-text></div>
                </div>
              )}

              {settings.region && (
                <div>
                  <s-text tone="subdued" variant="bodySm">Region</s-text>
                  <div><s-text>{settings.region}</s-text></div>
                </div>
              )}

              {settings.language && (
                <div>
                  <s-text tone="subdued" variant="bodySm">Language</s-text>
                  <div><s-text>{settings.language}</s-text></div>
                </div>
              )}

              {settings.product_status && (
                <div>
                  <s-text tone="subdued" variant="bodySm">Product Status</s-text>
                  <div><s-text>{settings.product_status}</s-text></div>
                </div>
              )}

              {typeof settings.retail_price_multiplier === "number" && (
                <div>
                  <s-text tone="subdued" variant="bodySm">Price Multiplier</s-text>
                  <div><s-text>{settings.retail_price_multiplier}x</s-text></div>
                </div>
              )}

              {settings.price_rounding && (
                <div>
                  <s-text tone="subdued" variant="bodySm">Price Rounding</s-text>
                  <div><s-text>{settings.price_rounding}</s-text></div>
                </div>
              )}
            </div>
          </s-box>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
