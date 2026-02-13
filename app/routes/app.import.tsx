import { useState, useMemo, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { COLLECTIONS_QUERY } from "../lib/shopify-queries.server";
import type {
  ScrapedProduct,
  PromptTemplate,
  StoreSettings,
  ScrapeResult,
} from "../lib/types";
import {
  DEFAULT_STORE_SETTINGS,
  PRICE_ROUNDING_OPTIONS,
  LANGUAGE_OPTIONS,
} from "../lib/types";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  // Load templates
  const templatesResult = await db
    .prepare("SELECT * FROM prompt_templates WHERE shop = ? ORDER BY name")
    .bind(session.shop)
    .all();

  // Load store settings
  const settingsRow = await db
    .prepare("SELECT * FROM store_settings WHERE shop = ?")
    .bind(session.shop)
    .first();

  // Load negative words
  const negativeWordsResult = await db
    .prepare("SELECT word FROM negative_words WHERE shop = ?")
    .bind(session.shop)
    .all();

  // Load collections from Shopify
  let collections: Array<{ id: string; title: string; handle: string }> = [];
  try {
    const response = await admin.graphql(COLLECTIONS_QUERY, {
      variables: { first: 100 },
    });
    const data: any = await response.json();
    collections = (data.data?.collections?.edges || []).map((edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      handle: edge.node.handle,
    }));
  } catch (error) {
    console.error("Failed to load collections:", error);
  }

  const settings: StoreSettings = settingsRow
    ? {
        ...(settingsRow as any),
        track_inventory: Boolean(settingsRow.track_inventory),
        retail_price_manual: Boolean(settingsRow.retail_price_manual),
        compare_at_price_manual: Boolean(settingsRow.compare_at_price_manual),
        sales_channels: Boolean(settingsRow.sales_channels),
        vat_enabled: Boolean(settingsRow.vat_enabled),
        alt_text_optimization: Boolean(settingsRow.alt_text_optimization),
        variant_pricing: Boolean(settingsRow.variant_pricing),
        product_tags_enabled: Boolean(settingsRow.product_tags_enabled),
        product_type_enabled: Boolean(settingsRow.product_type_enabled),
      }
    : { ...DEFAULT_STORE_SETTINGS, shop: session.shop };

  return {
    templates: templatesResult.results as unknown as PromptTemplate[],
    settings,
    collections,
    negativeWords: negativeWordsResult.results.map((r) => r.word as string),
  };
};

type ImportStep = "input" | "select" | "settings" | "uploading";

const STEP_LABELS = ["Input", "Select", "Settings", "Upload"];
const STEP_KEYS: ImportStep[] = ["input", "select", "settings", "uploading"];

export default function ImportProducts() {
  const {
    templates,
    settings: defaultSettings,
    collections,
    negativeWords,
  } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  // Step management
  const [step, setStep] = useState<ImportStep>("input");

  // Step 1 - Input
  const [importType, setImportType] = useState<"collection" | "product">(
    "collection",
  );
  const [urls, setUrls] = useState("");

  // Scraped products
  const [products, setProducts] = useState<ScrapedProduct[]>([]);
  const [scrapeErrors, setScrapeErrors] = useState<
    Array<{ url: string; error: string }>
  >([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Filters
  const [search, setSearch] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  // Settings (Step 3)
  const [titleTemplateId, setTitleTemplateId] = useState<string>("");
  const [descTemplateId, setDescTemplateId] = useState<string>("");
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [vendor, setVendor] = useState(defaultSettings.vendor);
  const [language, setLanguage] = useState(defaultSettings.language);
  const [region, setRegion] = useState(defaultSettings.region);
  const [defaultInventory, setDefaultInventory] = useState(
    String(defaultSettings.default_inventory),
  );
  const [trackInventory, setTrackInventory] = useState(
    defaultSettings.track_inventory,
  );
  const [retailMultiplier, setRetailMultiplier] = useState(
    String(defaultSettings.retail_price_multiplier),
  );
  const [compareAtMultiplier, setCompareAtMultiplier] = useState(
    String(defaultSettings.compare_at_price_multiplier),
  );
  const [retailManual, setRetailManual] = useState(
    defaultSettings.retail_price_manual,
  );
  const [compareAtManual, setCompareAtManual] = useState(
    defaultSettings.compare_at_price_manual,
  );
  const [priceRounding, setPriceRounding] = useState(
    defaultSettings.price_rounding,
  );
  const [productStatus, setProductStatus] = useState(
    defaultSettings.product_status,
  );
  const [salesChannels, setSalesChannels] = useState(
    defaultSettings.sales_channels,
  );
  const [vatEnabled, setVatEnabled] = useState(defaultSettings.vat_enabled);
  const [altText, setAltText] = useState(defaultSettings.alt_text_optimization);
  const [variantPricing, setVariantPricing] = useState(
    defaultSettings.variant_pricing,
  );
  const [inventoryPolicy, setInventoryPolicy] = useState(
    defaultSettings.inventory_policy,
  );

  // Fetchers
  const scrapeFetcher = useFetcher<ScrapeResult>();
  const optimizeFetcher = useFetcher();
  const uploadFetcher = useFetcher();

  const isScrapingLoading = scrapeFetcher.state !== "idle";
  const isOptimizing = optimizeFetcher.state !== "idle";
  const isUploading = uploadFetcher.state !== "idle";

  // Set default template on load (Fashion template if available)
  useEffect(() => {
    if (templates.length > 0 && !titleTemplateId && !descTemplateId) {
      // Look for a fashion template or use the first one
      const fashionTemplate = templates.find(t =>
        t.name.toLowerCase().includes('fashion') ||
        t.name.toLowerCase().includes('default')
      );
      const defaultTemplate = fashionTemplate || templates[0];
      setTitleTemplateId(String(defaultTemplate.id));
      setDescTemplateId(String(defaultTemplate.id));
    }
  }, [templates]);

  // Handle scrape response
  useEffect(() => {
    if (scrapeFetcher.data) {
      const data = scrapeFetcher.data as ScrapeResult;
      if (data.products) {
        setProducts(data.products);
        setScrapeErrors(data.errors || []);
        // Auto-select all
        setSelectedIds(new Set(data.products.map((p) => p.externalId)));
        if (data.products.length > 0) {
          setStep("select");
          shopify.toast.show(`Found ${data.products.length} products`);
        } else {
          shopify.toast.show("No products found", { isError: true });
        }
      }
    }
  }, [scrapeFetcher.data, shopify]);

  // Handle optimize response
  useEffect(() => {
    if (optimizeFetcher.data) {
      const data = optimizeFetcher.data as any;
      if (data.products) {
        setProducts(data.products);
        shopify.toast.show("Products optimized with AI");
        if (data.warnings?.length) {
          console.warn("Optimization warnings:", data.warnings);
        }
      }
    }
  }, [optimizeFetcher.data, shopify]);

  // Handle upload response
  useEffect(() => {
    if (uploadFetcher.data) {
      const data = uploadFetcher.data as any;
      if (data.imported !== undefined) {
        shopify.toast.show(`Imported ${data.imported}/${data.total} products`);
        if (data.failed > 0) {
          shopify.toast.show(`${data.failed} products failed`, {
            isError: true,
          });
        }
        setStep("input");
        setProducts([]);
        setUrls("");
      }
    }
  }, [uploadFetcher.data, shopify]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (search && !p.title.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (minPrice || maxPrice) {
        const price = parseFloat(p.variants[0]?.price || "0");
        if (minPrice && price < parseFloat(minPrice)) return false;
        if (maxPrice && price > parseFloat(maxPrice)) return false;
      }
      return true;
    });
  }, [products, search, minPrice, maxPrice]);

  const totalVariants = products.reduce((sum, p) => sum + p.variants.length, 0);

  const handleScrape = () => {
    if (!urls.trim()) return;
    scrapeFetcher.submit(
      { urls, type: importType },
      { method: "POST", action: "/app/api/scrape" },
    );
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredProducts.map((p) => p.externalId)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleOptimize = () => {
    const selectedProducts = products.filter((p) =>
      selectedIds.has(p.externalId),
    );
    optimizeFetcher.submit(
      JSON.stringify({
        products: selectedProducts,
        titleTemplateId: titleTemplateId ? Number(titleTemplateId) : undefined,
        descriptionTemplateId: descTemplateId
          ? Number(descTemplateId)
          : undefined,
        optimizeAltText: altText,
      }),
      {
        method: "POST",
        action: "/app/api/optimize",
        encType: "application/json",
      },
    );
  };

  const handleUpload = () => {
    const selectedProducts = products.filter((p) =>
      selectedIds.has(p.externalId),
    );
    setStep("uploading");
    uploadFetcher.submit(
      JSON.stringify({
        products: selectedProducts,
        settings: {
          ...defaultSettings,
          vendor,
          language,
          region,
          default_inventory: Number(defaultInventory),
          track_inventory: trackInventory,
          retail_price_multiplier: Number(retailMultiplier),
          compare_at_price_multiplier: Number(compareAtMultiplier),
          retail_price_manual: retailManual,
          compare_at_price_manual: compareAtManual,
          price_rounding: priceRounding,
          product_status: productStatus,
          sales_channels: salesChannels,
          vat_enabled: vatEnabled,
          alt_text_optimization: altText,
          variant_pricing: variantPricing,
          inventory_policy: inventoryPolicy,
        },
        collectionIds: selectedCollections,
        sourceUrls: urls.split("\n").filter(Boolean),
      }),
      {
        method: "POST",
        action: "/app/api/upload",
        encType: "application/json",
      },
    );
  };

  const stepIndex = STEP_KEYS.indexOf(step);

  return (
    <s-page heading="Import from Shopify Store">
      {/* Step Indicator */}
      <s-section>
        <s-stack direction="inline" gap="base" align="center">
          {STEP_LABELS.map((label, idx) => {
            const isActive = idx === stepIndex;
            const isCompleted = idx < stepIndex;
            return (
              <s-stack
                key={label}
                direction="inline"
                gap="tight"
                align="center"
              >
                <s-badge
                  tone={isActive ? "info" : isCompleted ? "success" : undefined}
                >
                  {isCompleted ? "\u2713" : String(idx + 1)}
                </s-badge>
                <s-text
                  fontWeight={isActive ? "semibold" : "regular"}
                  tone={isActive ? undefined : "subdued"}
                >
                  {label}
                </s-text>
                {idx < STEP_LABELS.length - 1 && (
                  <s-text tone="subdued">&mdash;</s-text>
                )}
              </s-stack>
            );
          })}
        </s-stack>
      </s-section>

      {step === "input" && (
        <>
          <s-section>
            <s-paragraph>Choose how you want to import products</s-paragraph>
            <s-stack
              direction="inline"
              gap="base"
              style={{ marginTop: "12px" }}
            >
              <div
                onClick={() => setImportType("collection")}
                style={{
                  flex: 1,
                  padding: "16px",
                  borderRadius: "12px",
                  border: `2px solid ${importType === "collection" ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
                  backgroundColor:
                    importType === "collection"
                      ? "var(--p-color-bg-surface-selected)"
                      : "var(--p-color-bg-surface)",
                  cursor: "pointer",
                }}
              >
                <s-text fontWeight="semibold">Collection Import</s-text>
                <div>
                  <s-text variant="bodySm" tone="subdued">
                    Import all products from a collection
                  </s-text>
                </div>
              </div>
              <div
                onClick={() => setImportType("product")}
                style={{
                  flex: 1,
                  padding: "16px",
                  borderRadius: "12px",
                  border: `2px solid ${importType === "product" ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
                  backgroundColor:
                    importType === "product"
                      ? "var(--p-color-bg-surface-selected)"
                      : "var(--p-color-bg-surface)",
                  cursor: "pointer",
                }}
              >
                <s-text fontWeight="semibold">Product Import</s-text>
                <div>
                  <s-text variant="bodySm" tone="subdued">
                    Import specific products
                  </s-text>
                </div>
              </div>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="block" gap="base">
              {importType === "collection" ? (
                <s-text-field
                  label="Collection URL"
                  value={urls}
                  onInput={(e: any) => setUrls(e.target.value)}
                  placeholder="https://store.myshopify.com/collections/collection-name"
                />
              ) : (
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: "600" }}>
                    Product URLs (one per line)
                  </label>
                  <textarea
                    value={urls}
                    onChange={(e) => setUrls(e.target.value)}
                    placeholder="https://store.myshopify.com/products/product-handle&#10;https://store.myshopify.com/products/another-product&#10;https://store.myshopify.com/products/third-product"
                    rows={6}
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #c9cccf",
                      borderRadius: "4px",
                      fontFamily: "inherit",
                      fontSize: "14px",
                      resize: "vertical"
                    }}
                  />
                </div>
              )}

              <s-banner tone="info">
                <s-text fontWeight="semibold">Make sure:</s-text>
                <s-unordered-list>
                  <s-list-item>URL must be from a Shopify store</s-list-item>
                  <s-list-item>
                    {importType === "collection"
                      ? "URL must contain /collections/"
                      : "URL must contain /products/"}
                  </s-list-item>
                  <s-list-item>
                    {importType === "collection"
                      ? "This will import all products from the collection"
                      : "Separate multiple URLs with new lines"}
                  </s-list-item>
                  <s-list-item>
                    Duplicate URLs with different parameters will be merged
                  </s-list-item>
                </s-unordered-list>
              </s-banner>

              <s-button
                onClick={handleScrape}
                variant="primary"
                {...(isScrapingLoading ? { loading: true } : {})}
              >
                {isScrapingLoading ? "Importing..." : "Import Products"}
              </s-button>

              {scrapeErrors.length > 0 && (
                <s-banner tone="critical">
                  <s-text fontWeight="semibold">
                    Errors occurred during import:
                  </s-text>
                  <s-unordered-list>
                    {scrapeErrors.map((err, i) => (
                      <s-list-item key={i}>
                        {err.url}: {err.error}
                      </s-list-item>
                    ))}
                  </s-unordered-list>
                </s-banner>
              )}
            </s-stack>
          </s-section>
        </>
      )}

      {step === "select" && (
        <>
          <s-button
            slot="primary-action"
            onClick={() => setStep("settings")}
            disabled={selectedIds.size === 0}
          >
            Next Step ({selectedIds.size} selected)
          </s-button>

          <s-section>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" align="center">
                <s-heading>{products.length} Products Found</s-heading>
                <s-badge>{totalVariants} variants</s-badge>
              </s-stack>

              <s-stack direction="inline" gap="base" align="center">
                <s-badge tone="info">{selectedIds.size} selected</s-badge>
                <s-button onClick={selectAll} variant="tertiary">
                  Select All
                </s-button>
                <s-button onClick={deselectAll} variant="tertiary">
                  Deselect All
                </s-button>
              </s-stack>

              {/* Filters */}
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-text>Filter Products</s-text>
                  <s-stack direction="inline" gap="base">
                    <div style={{ flex: 1 }}>
                      <s-text-field
                        label="Search"
                        value={search}
                        onInput={(e: any) => setSearch(e.target.value)}
                        placeholder="Search by title..."
                      />
                    </div>
                    <div style={{ width: "140px" }}>
                      <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>
                        Min Price
                      </label>
                      <input
                        type="number"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                        placeholder="0.00"
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #c9cccf",
                          borderRadius: "4px",
                          fontSize: "14px"
                        }}
                      />
                    </div>
                    <div style={{ width: "140px" }}>
                      <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500" }}>
                        Max Price
                      </label>
                      <input
                        type="number"
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value)}
                        placeholder="999.00"
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          border: "1px solid #c9cccf",
                          borderRadius: "4px",
                          fontSize: "14px"
                        }}
                      />
                    </div>
                  </s-stack>
                </s-stack>
              </s-box>

              {/* Product Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: "12px",
                }}
              >
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.externalId}
                    product={product}
                    selected={selectedIds.has(product.externalId)}
                    onToggle={() => toggleSelect(product.externalId)}
                  />
                ))}
              </div>

              <s-stack direction="inline" gap="base">
                <s-button
                  onClick={() => {
                    setStep("input");
                    setProducts([]);
                  }}
                  variant="tertiary"
                >
                  Back
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </>
      )}

      {step === "settings" && (
        <>
          <s-button
            slot="primary-action"
            onClick={handleUpload}
            {...(isUploading ? { loading: true } : {})}
          >
            {isUploading
              ? "Uploading..."
              : `Import ${selectedIds.size} Products to Shopify`}
          </s-button>

          <s-section heading="Listing Settings">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-select
                    label="Template Title"
                    value={titleTemplateId}
                    onChange={(e: any) => setTitleTemplateId(e.target.value)}
                  >
                    <s-option value="">No template (default AI)</s-option>
                    {templates.map((t) => (
                      <s-option key={t.id} value={String(t.id)}>
                        {t.name}
                      </s-option>
                    ))}
                  </s-select>
                </div>
                <div style={{ flex: 1 }}>
                  <s-select
                    label="Template Description"
                    value={descTemplateId}
                    onChange={(e: any) => setDescTemplateId(e.target.value)}
                  >
                    <s-option value="">No template (default AI)</s-option>
                    {templates.map((t) => (
                      <s-option key={t.id} value={String(t.id)}>
                        {t.name}
                      </s-option>
                    ))}
                  </s-select>
                </div>
              </s-stack>

              <div>
                <div style={{ marginBottom: "4px", fontWeight: "600" }}>Collections</div>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "8px" }}>
                  Select collections to assign products to
                </div>
                <s-box
                  padding="tight"
                  borderWidth="base"
                  borderRadius="base"
                  style={{
                    maxHeight: "150px",
                    overflow: "auto",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {collections.map((c) => (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={selectedCollections.includes(c.id)}
                          onChange={(e) => {
                            setSelectedCollections((prev) =>
                              e.target.checked
                                ? [...prev, c.id]
                                : prev.filter((id) => id !== c.id)
                            );
                          }}
                        />
                        <span>{c.title}</span>
                      </label>
                    ))}
                  </div>
                </s-box>
              </div>

              {isOptimizing ? (
                <s-banner tone="info">
                  <s-stack direction="block" gap="tight">
                    <s-text fontWeight="semibold">
                      Optimizing products with AI...
                    </s-text>
                    <s-progress-bar />
                    <s-text tone="subdued">
                      This may take a moment depending on the number of
                      products.
                    </s-text>
                  </s-stack>
                </s-banner>
              ) : (
                <s-button onClick={handleOptimize} variant="primary">
                  Optimize with AI
                </s-button>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Product Information">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Product Vendor"
                    value={vendor}
                    onChange={(e: any) => setVendor(e.target.value)}
                    placeholder="Your brand name"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <s-select
                    label="Language"
                    value={language}
                    onChange={(e: any) => setLanguage(e.target.value)}
                  >
                    {LANGUAGE_OPTIONS.map((l) => (
                      <s-option key={l} value={l}>
                        {l}
                      </s-option>
                    ))}
                  </s-select>
                </div>
              </s-stack>

              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Region"
                    value={region}
                    onChange={(e: any) => setRegion(e.target.value)}
                    placeholder="e.g., United Kingdom"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <s-select
                    label="Product Status"
                    value={productStatus}
                    onChange={(e: any) => setProductStatus(e.target.value)}
                  >
                    <s-option value="ACTIVE">Active</s-option>
                    <s-option value="DRAFT">Draft</s-option>
                  </s-select>
                </div>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Pricing">
            <s-stack direction="block" gap="base">
              <s-banner tone="info">
                <s-stack direction="block" gap="base">
                  <s-text>How pricing works:</s-text>
                  <s-unordered-list>
                    <s-list-item>
                      <strong>Multiplier Examples:</strong> Use 0.97 for 3% lower, 1.00 for same price, 1.10 for 10% higher
                    </s-list-item>
                    <s-list-item>
                      <strong>Currency Conversion:</strong> Prices will be converted to your region's currency (e.g., GBP for UK) using current exchange rates
                    </s-list-item>
                    <s-list-item>
                      <strong>Keep Original:</strong> Check "Keep original price" to use the competitor's exact price (after currency conversion)
                    </s-list-item>
                  </s-unordered-list>
                </s-stack>
              </s-banner>

              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Retail Price Multiplier"
                    value={retailMultiplier}
                    onInput={(e: any) => setRetailMultiplier(e.target.value)}
                  />
                  <div style={{ marginTop: "4px", fontSize: "13px", color: "#666" }}>
                    Applied after currency conversion
                  </div>
                  <div style={{ marginTop: "8px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        checked={retailManual}
                        onChange={(e) => setRetailManual(e.target.checked)}
                      />
                      <span>Keep original price (ignore multiplier)</span>
                    </label>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Compare at Price Multiplier"
                    value={compareAtMultiplier}
                    onInput={(e: any) => setCompareAtMultiplier(e.target.value)}
                  />
                  <div style={{ marginTop: "4px", fontSize: "13px", color: "#666" }}>
                    The "was" price shown to customers
                  </div>
                  <div style={{ marginTop: "8px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        checked={compareAtManual}
                        onChange={(e) => setCompareAtManual(e.target.checked)}
                      />
                      <span>Keep original price (ignore multiplier)</span>
                    </label>
                  </div>
                </div>
              </s-stack>

              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-select
                    label="Price Rounding"
                    value={priceRounding}
                    onChange={(e: any) => setPriceRounding(e.target.value)}
                  >
                    {PRICE_ROUNDING_OPTIONS.map((opt) => (
                      <s-option key={opt.value} value={opt.value}>
                        {opt.label}
                      </s-option>
                    ))}
                  </s-select>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", paddingBottom: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      checked={vatEnabled}
                      onChange={(e) => setVatEnabled(e.target.checked)}
                    />
                    <span>Enable VAT</span>
                  </label>
                </div>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section heading="Inventory">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Default Inventory"
                    value={defaultInventory}
                    onInput={(e: any) => setDefaultInventory(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", paddingBottom: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      checked={trackInventory}
                      onChange={(e) => setTrackInventory(e.target.checked)}
                    />
                    <span>Track Inventory</span>
                  </label>
                </div>
              </s-stack>

              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={inventoryPolicy === "CONTINUE"}
                  onChange={(e) =>
                    setInventoryPolicy(e.target.checked ? "CONTINUE" : "DENY")
                  }
                />
                <span>Continue Selling When Out of Stock</span>
              </label>
            </s-stack>
          </s-section>

          <s-section heading="Additional Options">
            <s-stack direction="block" gap="base">
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={salesChannels}
                  onChange={(e) => setSalesChannels(e.target.checked)}
                />
                <span>Publish to Sales Channels</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={altText}
                  onChange={(e) => setAltText(e.target.checked)}
                />
                <span>Optimize Image Alt Text with AI</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={variantPricing}
                  onChange={(e) => setVariantPricing(e.target.checked)}
                />
                <span>Use Same Price for All Variants</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={false}
                  onChange={(e) => {/* TODO: AI image improvement */}}
                />
                <span>🎨 Enhance Product Images with AI (experimental)</span>
              </label>
              <div style={{ marginLeft: "32px", fontSize: "13px", color: "#666" }}>
                Automatically improve competitor images using AI before importing
              </div>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => setStep("select")} variant="tertiary">
                Back
              </s-button>
              <s-button
                onClick={handleUpload}
                variant="primary"
                {...(isUploading ? { loading: true } : {})}
              >
                {isUploading
                  ? "Uploading..."
                  : `Import ${selectedIds.size} Products`}
              </s-button>
            </s-stack>
          </s-section>
        </>
      )}

      {step === "uploading" && (
        <s-section>
          <s-box padding="extraLoose" style={{ textAlign: "center" }}>
            <s-stack direction="block" gap="base" align="center">
              <s-heading>Uploading products to Shopify...</s-heading>
              <s-progress-bar />
              <s-paragraph>
                Please wait while we create {selectedIds.size} products in your
                store. This may take a few minutes for large batches.
              </s-paragraph>
              <s-badge tone="info">Processing</s-badge>
            </s-stack>
          </s-box>
        </s-section>
      )}
    </s-page>
  );
}

function ProductCard({
  product,
  selected,
  onToggle,
}: {
  product: ScrapedProduct;
  selected: boolean;
  onToggle: () => void;
}) {
  const firstImage = product.images[0];
  const price = product.variants[0]?.price || "0.00";

  return (
    <div
      onClick={onToggle}
      style={{
        position: "relative",
        borderRadius: "10px",
        border: `2px solid ${selected ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
        overflow: "hidden",
        cursor: "pointer",
        backgroundColor: "var(--p-color-bg-surface)",
        transition: "border-color 0.15s",
      }}
    >
      {/* Checkbox */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          width: "24px",
          height: "24px",
          borderRadius: "6px",
          border: "2px solid",
          borderColor: selected
            ? "#2C6ECB"
            : "#c9cccf",
          backgroundColor: selected
            ? "#2C6ECB"
            : "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
          transition: "all 0.15s ease"
        }}
      >
        {selected && (
          <span
            style={{ color: "white", fontSize: "14px", fontWeight: "bold" }}
          >
            ✓
          </span>
        )}
      </div>

      {/* Image */}
      <div
        style={{
          aspectRatio: "1",
          overflow: "hidden",
          backgroundColor: "#f5f5f5",
        }}
      >
        {firstImage ? (
          <img
            src={firstImage.src}
            alt={firstImage.alt || product.title}
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

      {/* Info */}
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "4px",
          }}
        >
          <span style={{ fontSize: "11px", color: "#666" }}>
            {product.variants.length} variant
            {product.variants.length !== 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>${price}</span>
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
