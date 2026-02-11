import { useState, useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { PRODUCTS_QUERY, PRODUCT_UPDATE_MUTATION } from "../lib/shopify-queries.server";
import type { PromptTemplate, ScrapedProduct } from "../lib/types";

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  featuredImage: { url: string; altText: string | null } | null;
  images: { edges: Array<{ node: { id: string; url: string; altText: string | null } }> };
  variants: {
    edges: Array<{
      node: { id: string; title: string; price: string; compareAtPrice: string | null; sku: string };
    }>;
  };
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const after = url.searchParams.get("after") || undefined;

  // Fetch products from Shopify
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: {
      first: 24,
      after: after || undefined,
      query: searchQuery || undefined,
    },
  });
  const data: any = await response.json();
  const productsData = data.data?.products;

  const products: ShopifyProduct[] = (productsData?.edges || []).map(
    (edge: any) => edge.node,
  );
  const pageInfo = productsData?.pageInfo || { hasNextPage: false, endCursor: null };

  // Load templates
  const templatesResult = await db
    .prepare("SELECT * FROM prompt_templates WHERE shop = ? ORDER BY name")
    .bind(session.shop)
    .all();

  return {
    products,
    pageInfo,
    templates: templatesResult.results as unknown as PromptTemplate[],
    searchQuery,
  };
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const payload = await request.json();
  const { products: optimizedProducts } = payload as {
    products: Array<{
      id: string;
      title: string;
      descriptionHtml: string;
      images: Array<{ id: string; altText: string }>;
    }>;
  };

  let updated = 0;
  let failed = 0;

  for (const product of optimizedProducts) {
    try {
      await admin.graphql(PRODUCT_UPDATE_MUTATION, {
        variables: {
          input: {
            id: product.id,
            title: product.title,
            descriptionHtml: product.descriptionHtml,
          },
        },
      });
      updated++;
    } catch (error) {
      console.error(`Failed to update product ${product.id}:`, error);
      failed++;
    }
  }

  return Response.json({ updated, failed, total: optimizedProducts.length });
};

export default function OptimizeProducts() {
  const { products, pageInfo, templates, searchQuery } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(searchQuery);
  const [titleTemplateId, setTitleTemplateId] = useState<string>("");
  const [descTemplateId, setDescTemplateId] = useState<string>("");
  const [optimizedData, setOptimizedData] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const searchFetcher = useFetcher();
  const optimizeFetcher = useFetcher();
  const updateFetcher = useFetcher();

  const isOptimizing = optimizeFetcher.state !== "idle";
  const isUpdating = updateFetcher.state !== "idle";

  // Handle optimize response
  useEffect(() => {
    if (optimizeFetcher.data) {
      const data = optimizeFetcher.data as any;
      if (data.products) {
        setOptimizedData(data.products);
        setShowPreview(true);
        shopify.toast.show(`Optimized ${data.products.length} products`);
      }
    }
  }, [optimizeFetcher.data, shopify]);

  // Handle update response
  useEffect(() => {
    if (updateFetcher.data) {
      const data = updateFetcher.data as any;
      if (data.updated !== undefined) {
        shopify.toast.show(`Updated ${data.updated}/${data.total} products`);
        setShowPreview(false);
        setOptimizedData([]);
        setSelectedIds(new Set());
      }
    }
  }, [updateFetcher.data, shopify]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(products.map((p) => p.id)));
  };

  const handleSearch = () => {
    searchFetcher.load(`/app/optimize?q=${encodeURIComponent(search)}`);
  };

  const handleOptimize = () => {
    const selectedProducts = products.filter((p) => selectedIds.has(p.id));

    // Convert to ScrapedProduct format for the AI optimizer
    const productsForAI: ScrapedProduct[] = selectedProducts.map((p) => ({
      externalId: 0,
      title: p.title,
      handle: p.handle,
      description: p.descriptionHtml,
      vendor: p.vendor,
      productType: p.productType,
      tags: p.tags,
      images: p.images.edges.map((e, idx) => ({
        src: e.node.url,
        alt: e.node.altText,
        position: idx + 1,
      })),
      variants: p.variants.edges.map((e) => ({
        title: e.node.title,
        price: e.node.price,
        compareAtPrice: e.node.compareAtPrice,
        sku: e.node.sku,
        weight: 0,
        weightUnit: "kg",
        inventoryQuantity: 0,
        option1: null,
        option2: null,
        option3: null,
      })),
      options: [],
      sourceUrl: "",
      sourceStore: "",
    }));

    optimizeFetcher.submit(
      JSON.stringify({
        products: productsForAI,
        titleTemplateId: titleTemplateId ? Number(titleTemplateId) : undefined,
        descriptionTemplateId: descTemplateId ? Number(descTemplateId) : undefined,
        optimizeAltText: true,
      }),
      {
        method: "POST",
        action: "/app/api/optimize",
        encType: "application/json",
      },
    );
  };

  const handleApplyChanges = () => {
    const selectedProducts = products.filter((p) => selectedIds.has(p.id));

    // Map optimized data back to Shopify product IDs
    const updates = selectedProducts.map((p, idx) => {
      const optimized = optimizedData[idx];
      return {
        id: p.id,
        title: optimized?.title || p.title,
        descriptionHtml: optimized?.description || p.descriptionHtml,
        images: p.images.edges.map((e, imgIdx) => ({
          id: e.node.id,
          altText: optimized?.images?.[imgIdx]?.alt || e.node.altText || "",
        })),
      };
    });

    updateFetcher.submit(
      JSON.stringify({ products: updates }),
      {
        method: "POST",
        encType: "application/json",
      },
    );
  };

  return (
    <s-page heading="Optimize Existing Products">
      {!showPreview ? (
        <>
          <s-section>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="tight" align="end">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label=""
                    value={search}
                    onInput={(e: any) => setSearch(e.target.value)}
                    placeholder="Search products..."
                    onKeyDown={(e: any) => { if (e.key === "Enter") handleSearch(); }}
                  />
                </div>
                <s-button onClick={handleSearch}>Search</s-button>
              </s-stack>

              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                    Title Template
                  </label>
                  <select
                    value={titleTemplateId}
                    onChange={(e) => setTitleTemplateId(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">Default AI optimization</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                    Description Template
                  </label>
                  <select
                    value={descTemplateId}
                    onChange={(e) => setDescTemplateId(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">Default AI optimization</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </s-stack>

              <s-stack direction="inline" gap="tight">
                <s-text>Selected: {selectedIds.size} products</s-text>
                <s-button onClick={selectAll} variant="tertiary">Select All</s-button>
                <s-button onClick={() => setSelectedIds(new Set())} variant="tertiary">Deselect All</s-button>
                <s-button
                  onClick={handleOptimize}
                  variant="primary"
                  disabled={selectedIds.size === 0}
                  {...(isOptimizing ? { loading: true } : {})}
                >
                  {isOptimizing ? "Optimizing..." : `Optimize ${selectedIds.size} Products`}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: "12px",
              }}
            >
              {products.map((product) => (
                <div
                  key={product.id}
                  onClick={() => toggleSelect(product.id)}
                  style={{
                    position: "relative",
                    borderRadius: "10px",
                    border: `2px solid ${selectedIds.has(product.id) ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
                    overflow: "hidden",
                    cursor: "pointer",
                    backgroundColor: "var(--p-color-bg-surface)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "8px",
                      right: "8px",
                      width: "20px",
                      height: "20px",
                      borderRadius: "4px",
                      border: "2px solid",
                      borderColor: selectedIds.has(product.id)
                        ? "var(--p-color-border-interactive)"
                        : "var(--p-color-border)",
                      backgroundColor: selectedIds.has(product.id)
                        ? "var(--p-color-bg-fill-brand)"
                        : "var(--p-color-bg-surface)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 1,
                    }}
                  >
                    {selectedIds.has(product.id) && (
                      <span style={{ color: "white", fontSize: "12px", fontWeight: "bold" }}>
                        ✓
                      </span>
                    )}
                  </div>

                  <div style={{ aspectRatio: "1", overflow: "hidden", backgroundColor: "#f5f5f5" }}>
                    {product.featuredImage ? (
                      <img
                        src={product.featuredImage.url}
                        alt={product.featuredImage.altText || product.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#999",
                        }}
                      >
                        No image
                      </div>
                    )}
                  </div>

                  <div style={{ padding: "8px" }}>
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {product.title}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                      <span style={{ fontSize: "11px", color: "#666" }}>
                        {product.variants.edges.length} variant
                        {product.variants.edges.length !== 1 ? "s" : ""}
                      </span>
                      <span style={{ fontSize: "12px", fontWeight: 600 }}>
                        ${product.variants.edges[0]?.node.price || "0.00"}
                      </span>
                    </div>
                    <div style={{ marginTop: "2px" }}>
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor:
                            product.status === "ACTIVE"
                              ? "var(--p-color-bg-fill-success)"
                              : "var(--p-color-bg-surface-secondary)",
                          color: product.status === "ACTIVE" ? "white" : "inherit",
                        }}
                      >
                        {product.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pageInfo.hasNextPage && (
              <div style={{ textAlign: "center", marginTop: "16px" }}>
                <s-button
                  onClick={() =>
                    searchFetcher.load(
                      `/app/optimize?q=${encodeURIComponent(search)}&after=${pageInfo.endCursor}`,
                    )
                  }
                  variant="tertiary"
                >
                  Load More
                </s-button>
              </div>
            )}
          </s-section>
        </>
      ) : (
        <>
          <s-button
            slot="primary-action"
            onClick={handleApplyChanges}
            {...(isUpdating ? { loading: true } : {})}
          >
            {isUpdating ? "Applying..." : "Apply Changes to Shopify"}
          </s-button>

          <s-section heading="Optimization Preview">
            <s-stack direction="block" gap="loose">
              {optimizedData.map((optimized, idx) => {
                const original = products.find((p) => selectedIds.has(p.id));
                if (!original) return null;
                return (
                  <s-box
                    key={idx}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-stack direction="block" gap="tight">
                      <s-heading>{optimized.originalTitle || original.title}</s-heading>
                      <s-stack direction="inline" gap="loose">
                        <div style={{ flex: 1 }}>
                          <s-text fontWeight="semibold" tone="subdued">Original Title</s-text>
                          <s-paragraph>{optimized.originalTitle || original.title}</s-paragraph>
                        </div>
                        <div style={{ flex: 1 }}>
                          <s-text fontWeight="semibold" tone="success">Optimized Title</s-text>
                          <s-paragraph>{optimized.title}</s-paragraph>
                        </div>
                      </s-stack>
                      <s-stack direction="inline" gap="loose">
                        <div style={{ flex: 1 }}>
                          <s-text fontWeight="semibold" tone="subdued">Original Description</s-text>
                          <s-box padding="tight" background="subdued" borderRadius="base">
                            <div
                              style={{ fontSize: "12px", maxHeight: "120px", overflow: "auto" }}
                              dangerouslySetInnerHTML={{
                                __html: (optimized.originalDescription || original.descriptionHtml || "").substring(0, 500),
                              }}
                            />
                          </s-box>
                        </div>
                        <div style={{ flex: 1 }}>
                          <s-text fontWeight="semibold" tone="success">Optimized Description</s-text>
                          <s-box padding="tight" background="subdued" borderRadius="base">
                            <div
                              style={{ fontSize: "12px", maxHeight: "120px", overflow: "auto" }}
                              dangerouslySetInnerHTML={{
                                __html: (optimized.description || "").substring(0, 500),
                              }}
                            />
                          </s-box>
                        </div>
                      </s-stack>
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => { setShowPreview(false); setOptimizedData([]); }} variant="tertiary">
                Back
              </s-button>
              <s-button
                onClick={handleApplyChanges}
                variant="primary"
                {...(isUpdating ? { loading: true } : {})}
              >
                Apply Changes
              </s-button>
            </s-stack>
          </s-section>
        </>
      )}
    </s-page>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "8px",
  border: "1px solid var(--p-color-border)",
  fontSize: "14px",
  backgroundColor: "var(--p-color-bg-surface)",
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
