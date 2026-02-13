import { useState, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { PRODUCTS_QUERY } from "../lib/shopify-queries.server";
import type { GeneratedImage } from "../lib/types";

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredImage: { url: string; altText: string | null } | null;
  images: { edges: Array<{ node: { id: string; url: string; altText: string | null } }> };
  variants: {
    edges: Array<{
      node: { id: string; title: string; price: string };
    }>;
  };
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";
  const after = url.searchParams.get("after") || undefined;

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

  // Load negative words for alt text generation
  const negativeWordsResult = await db
    .prepare("SELECT word FROM negative_words WHERE shop = ?")
    .bind(session.shop)
    .all();

  return {
    products,
    pageInfo,
    searchQuery,
    negativeWords: negativeWordsResult.results.map((r: any) => r.word as string),
  };
};

const STYLE_OPTIONS = [
  { value: "product-only", label: "Clean Product Shot" },
  { value: "lifestyle", label: "Lifestyle Scene" },
  { value: "white-background", label: "White Background" },
  { value: "custom", label: "Custom (describe below)" },
];

export default function AIImages() {
  const { products, pageInfo, searchQuery, negativeWords } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  // Search state
  const [search, setSearch] = useState(searchQuery);
  const searchFetcher = useFetcher();

  // Selected product
  const [selectedProduct, setSelectedProduct] = useState<ShopifyProduct | null>(null);

  // Generation settings
  const [mode, setMode] = useState<"generate" | "enhance">("generate");
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [style, setStyle] = useState("product-only");
  const [customPrompt, setCustomPrompt] = useState("");

  // Generated images
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [editableAltTexts, setEditableAltTexts] = useState<string[]>([]);

  // Fetchers
  const generateFetcher = useFetcher();
  const uploadFetcher = useFetcher();

  const isGenerating = generateFetcher.state !== "idle";
  const isUploading = uploadFetcher.state !== "idle";

  // Banner state
  const [banner, setBanner] = useState<{ tone: "info" | "success" | "warning" | "critical"; message: string } | null>(null);

  // Handle generate response
  useEffect(() => {
    if (generateFetcher.data) {
      const data = generateFetcher.data as any;
      if (data.error) {
        setBanner({ tone: "critical", message: data.error });
      } else if (data.image) {
        const newImage = data.image as GeneratedImage;
        setGeneratedImages((prev) => [...prev, newImage]);
        setEditableAltTexts((prev) => [...prev, newImage.altText]);
        setBanner({ tone: "success", message: "Image generated successfully! Review it below." });
        shopify.toast.show("Image generated");
      }
    }
  }, [generateFetcher.data, shopify]);

  // Handle upload response
  useEffect(() => {
    if (uploadFetcher.data) {
      const data = uploadFetcher.data as any;
      if (data.error) {
        setBanner({ tone: "critical", message: data.error });
      } else if (data.success) {
        setBanner({ tone: "success", message: "Image uploaded to Shopify product successfully!" });
        shopify.toast.show("Image uploaded to product");
        // Clear the uploaded image from the list
        if (data.uploadedIndex !== undefined) {
          setGeneratedImages((prev) => prev.filter((_, i) => i !== data.uploadedIndex));
          setEditableAltTexts((prev) => prev.filter((_, i) => i !== data.uploadedIndex));
        }
      }
    }
  }, [uploadFetcher.data, shopify]);

  const handleSearch = () => {
    searchFetcher.load(`/app/images?q=${encodeURIComponent(search)}`);
  };

  const handleSelectProduct = (product: ShopifyProduct) => {
    setSelectedProduct(product);
    setReferenceImageUrl(null);
    setGeneratedImages([]);
    setEditableAltTexts([]);
    setBanner(null);
    // Default to first image if enhancing
    if (product.images.edges.length > 0) {
      setReferenceImageUrl(product.images.edges[0].node.url);
    }
  };

  const handleGenerate = () => {
    if (!selectedProduct) return;
    setBanner(null);

    const styleLabel = STYLE_OPTIONS.find((s) => s.value === style)?.label || style;

    let prompt = "";
    if (mode === "enhance") {
      prompt = `Enhance this product image for "${selectedProduct.title}". Style: ${styleLabel}. Make it look professional and high-quality for an e-commerce store.`;
    } else {
      prompt = `Generate a high-quality e-commerce product photo for "${selectedProduct.title}". Style: ${styleLabel}. The image should be professional, well-lit, and suitable for an online store product listing.`;
    }

    if (customPrompt.trim()) {
      prompt += ` Additional instructions: ${customPrompt.trim()}`;
    }

    generateFetcher.submit(
      JSON.stringify({
        intent: "generate",
        productId: selectedProduct.id,
        productTitle: selectedProduct.title,
        existingImageUrl: mode === "enhance" ? referenceImageUrl : undefined,
        mode,
        prompt,
        style,
        negativeWords,
      }),
      {
        method: "POST",
        action: "/app/api/images",
        encType: "application/json",
      },
    );
  };

  const handleUpload = (imageIndex: number) => {
    if (!selectedProduct) return;

    const image = generatedImages[imageIndex];
    const altText = editableAltTexts[imageIndex];

    uploadFetcher.submit(
      JSON.stringify({
        intent: "upload",
        productId: selectedProduct.id,
        image: {
          base64Data: image.base64Data,
          mimeType: image.mimeType,
          altText,
        },
        uploadedIndex: imageIndex,
      }),
      {
        method: "POST",
        action: "/app/api/images",
        encType: "application/json",
      },
    );
  };

  return (
    <s-page heading="AI Image Generation">
      {banner && (
        <s-banner tone={banner.tone} dismissible onDismiss={() => setBanner(null)}>
          {banner.message}
        </s-banner>
      )}

      {/* Product Selection */}
      {!selectedProduct ? (
        <>
          <s-section>
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Select a product to generate or enhance images using AI. Generated images will include SEO-optimized alt text.
              </s-paragraph>
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
                  onClick={() => handleSelectProduct(product)}
                  style={{
                    borderRadius: "10px",
                    border: "2px solid var(--p-color-border)",
                    overflow: "hidden",
                    cursor: "pointer",
                    backgroundColor: "var(--p-color-bg-surface)",
                    transition: "border-color 0.15s",
                  }}
                >
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
                    <div style={{ marginTop: "4px" }}>
                      <s-badge tone="info">
                        {product.images.edges.length} image{product.images.edges.length !== 1 ? "s" : ""}
                      </s-badge>
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
                      `/app/images?q=${encodeURIComponent(search)}&after=${pageInfo.endCursor}`,
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
            onClick={handleGenerate}
            {...(isGenerating ? { loading: true } : {})}
            disabled={isGenerating}
          >
            {isGenerating ? "Generating..." : "Generate Image"}
          </s-button>

          {/* Selected Product Info */}
          <s-section>
            <s-stack direction="inline" gap="base" align="center">
              <s-button onClick={() => setSelectedProduct(null)} variant="tertiary">
                &larr; Back to Products
              </s-button>
              <s-heading>{selectedProduct.title}</s-heading>
              <s-badge>{selectedProduct.images.edges.length} existing images</s-badge>
            </s-stack>
          </s-section>

          {/* Mode Selection */}
          <s-section heading="Generation Mode">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <div
                  onClick={() => setMode("generate")}
                  style={{
                    flex: 1,
                    padding: "16px",
                    borderRadius: "12px",
                    border: `2px solid ${mode === "generate" ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
                    backgroundColor: mode === "generate" ? "var(--p-color-bg-surface-selected)" : "var(--p-color-bg-surface)",
                    cursor: "pointer",
                  }}
                >
                  <s-text fontWeight="semibold">Generate New</s-text>
                  <div>
                    <s-text variant="bodySm" tone="subdued">
                      Create a brand new product image from scratch using AI
                    </s-text>
                  </div>
                </div>
                <div
                  onClick={() => setMode("enhance")}
                  style={{
                    flex: 1,
                    padding: "16px",
                    borderRadius: "12px",
                    border: `2px solid ${mode === "enhance" ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
                    backgroundColor: mode === "enhance" ? "var(--p-color-bg-surface-selected)" : "var(--p-color-bg-surface)",
                    cursor: "pointer",
                  }}
                >
                  <s-text fontWeight="semibold">Enhance Existing</s-text>
                  <div>
                    <s-text variant="bodySm" tone="subdued">
                      Improve an existing product image with better styling
                    </s-text>
                  </div>
                </div>
              </s-stack>

              {/* Reference Image Picker (for enhance mode) */}
              {mode === "enhance" && selectedProduct.images.edges.length > 0 && (
                <div>
                  <s-text fontWeight="semibold">Select Reference Image</s-text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                      gap: "8px",
                      marginTop: "8px",
                    }}
                  >
                    {selectedProduct.images.edges.map((edge) => (
                      <div
                        key={edge.node.id}
                        onClick={() => setReferenceImageUrl(edge.node.url)}
                        style={{
                          borderRadius: "8px",
                          border: `2px solid ${referenceImageUrl === edge.node.url ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                      >
                        <img
                          src={edge.node.url}
                          alt={edge.node.altText || "Product image"}
                          style={{ width: "100%", aspectRatio: "1", objectFit: "cover" }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mode === "enhance" && selectedProduct.images.edges.length === 0 && (
                <s-banner tone="warning">
                  This product has no existing images to enhance. Switch to "Generate New" mode instead.
                </s-banner>
              )}
            </s-stack>
          </s-section>

          {/* Style & Prompt */}
          <s-section heading="Image Settings">
            <s-stack direction="block" gap="base">
              <s-select
                label="Image Style"
                value={style}
                onChange={(e: any) => setStyle(e.target.value)}
              >
                {STYLE_OPTIONS.map((opt) => (
                  <s-option key={opt.value} value={opt.value}>{opt.label}</s-option>
                ))}
              </s-select>

              <s-textarea
                label="Custom Instructions (optional)"
                value={customPrompt}
                onInput={(e: any) => setCustomPrompt(e.target.value)}
                placeholder="Describe what you want the AI to create or how to enhance the image. E.g., 'Place product on a wooden table with natural lighting' or 'Remove background and add soft shadows'"
                rows={4}
              />

              {isGenerating && (
                <s-banner tone="info">
                  <s-stack direction="block" gap="tight">
                    <s-text fontWeight="semibold">Generating image with AI...</s-text>
                    <s-progress-bar />
                    <s-text tone="subdued">This may take 10-30 seconds depending on complexity.</s-text>
                  </s-stack>
                </s-banner>
              )}
            </s-stack>
          </s-section>

          {/* Generated Images Preview */}
          {generatedImages.length > 0 && (
            <s-section heading="Generated Images">
              <s-stack direction="block" gap="loose">
                {generatedImages.map((image, idx) => (
                  <s-box key={idx} padding="base" borderWidth="base" borderRadius="base">
                    <s-stack direction="inline" gap="base">
                      <div style={{ width: "300px", flexShrink: 0 }}>
                        <img
                          src={`data:${image.mimeType};base64,${image.base64Data}`}
                          alt={editableAltTexts[idx]}
                          style={{
                            width: "100%",
                            borderRadius: "8px",
                            border: "1px solid var(--p-color-border)",
                          }}
                        />
                      </div>
                      <s-stack direction="block" gap="base" style={{ flex: 1 }}>
                        <s-text-field
                          label="Alt Text (SEO)"
                          value={editableAltTexts[idx]}
                          onInput={(e: any) => {
                            setEditableAltTexts((prev) => {
                              const next = [...prev];
                              next[idx] = e.target.value;
                              return next;
                            });
                          }}
                        />
                        <s-text variant="bodySm" tone="subdued">
                          Generated with: {image.prompt.substring(0, 100)}...
                        </s-text>
                        <s-stack direction="inline" gap="tight">
                          {isUploading ? (
                            <s-button variant="primary" loading>Uploading...</s-button>
                          ) : (
                            <s-button
                              onClick={() => handleUpload(idx)}
                              variant="primary"
                            >
                              Upload to Shopify
                            </s-button>
                          )}
                          <s-button
                            onClick={() => {
                              setGeneratedImages((prev) => prev.filter((_, i) => i !== idx));
                              setEditableAltTexts((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            variant="tertiary"
                            tone="critical"
                          >
                            Discard
                          </s-button>
                        </s-stack>
                      </s-stack>
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            </s-section>
          )}
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
