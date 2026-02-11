import { useState, useMemo, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { COLLECTIONS_QUERY } from "../lib/shopify-queries.server";
import type { ScrapedProduct, PromptTemplate, StoreSettings, ScrapeResult } from "../lib/types";
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

export default function ImportProducts() {
  const { templates, settings: defaultSettings, collections, negativeWords } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  // Step management
  const [step, setStep] = useState<ImportStep>("input");

  // Step 1 - Input
  const [importType, setImportType] = useState<"collection" | "product">("collection");
  const [urls, setUrls] = useState("");

  // Scraped products
  const [products, setProducts] = useState<ScrapedProduct[]>([]);
  const [scrapeErrors, setScrapeErrors] = useState<Array<{ url: string; error: string }>>([]);
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
  const [defaultInventory, setDefaultInventory] = useState(String(defaultSettings.default_inventory));
  const [trackInventory, setTrackInventory] = useState(defaultSettings.track_inventory);
  const [retailMultiplier, setRetailMultiplier] = useState(String(defaultSettings.retail_price_multiplier));
  const [compareAtMultiplier, setCompareAtMultiplier] = useState(String(defaultSettings.compare_at_price_multiplier));
  const [retailManual, setRetailManual] = useState(defaultSettings.retail_price_manual);
  const [compareAtManual, setCompareAtManual] = useState(defaultSettings.compare_at_price_manual);
  const [priceRounding, setPriceRounding] = useState(defaultSettings.price_rounding);
  const [productStatus, setProductStatus] = useState(defaultSettings.product_status);
  const [salesChannels, setSalesChannels] = useState(defaultSettings.sales_channels);
  const [vatEnabled, setVatEnabled] = useState(defaultSettings.vat_enabled);
  const [altText, setAltText] = useState(defaultSettings.alt_text_optimization);
  const [variantPricing, setVariantPricing] = useState(defaultSettings.variant_pricing);
  const [inventoryPolicy, setInventoryPolicy] = useState(defaultSettings.inventory_policy);

  // Fetchers
  const scrapeFetcher = useFetcher<ScrapeResult>();
  const optimizeFetcher = useFetcher();
  const uploadFetcher = useFetcher();

  const isScrapingLoading = scrapeFetcher.state !== "idle";
  const isOptimizing = optimizeFetcher.state !== "idle";
  const isUploading = uploadFetcher.state !== "idle";

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
          shopify.toast.show(`${data.failed} products failed`, { isError: true });
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
      if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
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
    const selectedProducts = products.filter((p) => selectedIds.has(p.externalId));
    optimizeFetcher.submit(
      JSON.stringify({
        products: selectedProducts,
        titleTemplateId: titleTemplateId ? Number(titleTemplateId) : undefined,
        descriptionTemplateId: descTemplateId ? Number(descTemplateId) : undefined,
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
    const selectedProducts = products.filter((p) => selectedIds.has(p.externalId));
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

  return (
    <s-page heading="Import from Shopify Store">
      {step === "input" && (
        <>
          <s-section>
            <s-paragraph>Choose how you want to import products</s-paragraph>
            <s-stack direction="inline" gap="base" style={{ marginTop: "12px" }}>
              <div
                onClick={() => setImportType("collection")}
                style={{
                  flex: 1,
                  padding: "16px",
                  borderRadius: "12px",
                  border: `2px solid ${importType === "collection" ? "var(--p-color-border-interactive)" : "var(--p-color-border)"}`,
                  backgroundColor: importType === "collection" ? "var(--p-color-bg-surface-selected)" : "var(--p-color-bg-surface)",
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
                  backgroundColor: importType === "product" ? "var(--p-color-bg-surface-selected)" : "var(--p-color-bg-surface)",
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
              <s-text-field
                label={importType === "collection" ? "Collection URL" : "Product URLs (one per line)"}
                value={urls}
                onInput={(e: any) => setUrls(e.target.value)}
                placeholder={
                  importType === "collection"
                    ? "https://store.myshopify.com/collections/collection-name"
                    : "https://store.myshopify.com/products/product-handle"
                }
                multiline={importType === "product"}
              />

              <s-box padding="base" background="subdued" borderRadius="base">
                <s-text tone="caution" fontWeight="semibold">Make sure:</s-text>
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
                  <s-list-item>Duplicate URLs with different parameters will be merged</s-list-item>
                </s-unordered-list>
              </s-box>

              <s-button
                onClick={handleScrape}
                variant="primary"
                {...(isScrapingLoading ? { loading: true } : {})}
              >
                {isScrapingLoading ? "Importing..." : "Import Products"}
              </s-button>

              {scrapeErrors.length > 0 && (
                <s-box padding="base" background="critical-subdued" borderRadius="base">
                  <s-text tone="critical" fontWeight="semibold">Errors:</s-text>
                  {scrapeErrors.map((err, i) => (
                    <s-paragraph key={i}>
                      <s-text tone="critical">{err.url}: {err.error}</s-text>
                    </s-paragraph>
                  ))}
                </s-box>
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
                <s-heading>
                  {products.length} Products Found{" "}
                  <s-text tone="subdued">({totalVariants} total variants)</s-text>
                </s-heading>
              </s-stack>

              <s-stack direction="inline" gap="base" align="center">
                <s-text>Selected: {selectedIds.size} products</s-text>
                <s-button onClick={selectAll} variant="tertiary">Select All</s-button>
                <s-button onClick={deselectAll} variant="tertiary">Deselect All</s-button>
              </s-stack>

              {/* Filters */}
              <s-stack direction="inline" gap="tight" align="end">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label=""
                    value={search}
                    onInput={(e: any) => setSearch(e.target.value)}
                    placeholder="Search products..."
                  />
                </div>
                <s-text-field
                  label=""
                  type="number"
                  value={minPrice}
                  onInput={(e: any) => setMinPrice(e.target.value)}
                  placeholder="Min price"
                  style={{ width: "120px" }}
                />
                <s-text-field
                  label=""
                  type="number"
                  value={maxPrice}
                  onInput={(e: any) => setMaxPrice(e.target.value)}
                  placeholder="Max price"
                  style={{ width: "120px" }}
                />
              </s-stack>

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
                <s-button onClick={() => { setStep("input"); setProducts([]); }} variant="tertiary">
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
            {isUploading ? "Uploading..." : `Import ${selectedIds.size} Products to Shopify`}
          </s-button>

          <s-section heading="Listing Settings">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                    Template Title
                  </label>
                  <select
                    value={titleTemplateId}
                    onChange={(e) => setTitleTemplateId(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">No template (default AI)</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                    Template Description
                  </label>
                  <select
                    value={descTemplateId}
                    onChange={(e) => setDescTemplateId(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">No template (default AI)</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </s-stack>

              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                  Collections
                </label>
                <select
                  multiple
                  value={selectedCollections}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                    setSelectedCollections(selected);
                  }}
                  style={{ ...selectStyle, height: "100px" }}
                >
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <s-text variant="bodySm" tone="subdued">
                  Hold Ctrl/Cmd to select multiple collections
                </s-text>
              </div>

              <s-button
                onClick={handleOptimize}
                variant="primary"
                {...(isOptimizing ? { loading: true } : {})}
              >
                {isOptimizing ? "Optimizing with AI..." : "Optimize with AI"}
              </s-button>
            </s-stack>
          </s-section>

          <s-section heading="Store Settings">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Product Vendor"
                    value={vendor}
                    onInput={(e: any) => setVendor(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                    Language
                  </label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectStyle}>
                    {LANGUAGE_OPTIONS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </s-stack>

              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Region"
                    value={region}
                    onInput={(e: any) => setRegion(e.target.value)}
                    placeholder="e.g., United Kingdom"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Default Inventory"
                    type="number"
                    value={defaultInventory}
                    onInput={(e: any) => setDefaultInventory(e.target.value)}
                  />
                </div>
              </s-stack>

              <ToggleRow label="Track Inventory" checked={trackInventory} onChange={setTrackInventory} />

              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Retail Price Multiplier"
                    type="number"
                    value={retailMultiplier}
                    onInput={(e: any) => setRetailMultiplier(e.target.value)}
                    step="0.1"
                  />
                  <label style={{ fontSize: "12px" }}>
                    <input type="checkbox" checked={retailManual} onChange={(e) => setRetailManual(e.target.checked)} />
                    {" "}Manual
                  </label>
                </div>
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Compare at Price Multiplier"
                    type="number"
                    value={compareAtMultiplier}
                    onInput={(e: any) => setCompareAtMultiplier(e.target.value)}
                    step="0.1"
                  />
                  <label style={{ fontSize: "12px" }}>
                    <input type="checkbox" checked={compareAtManual} onChange={(e) => setCompareAtManual(e.target.checked)} />
                    {" "}Manual
                  </label>
                </div>
              </s-stack>

              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                  Price Rounding
                </label>
                <select value={priceRounding} onChange={(e) => setPriceRounding(e.target.value)} style={selectStyle}>
                  {PRICE_ROUNDING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                  Product Status
                </label>
                <select
                  value={productStatus}
                  onChange={(e) => setProductStatus(e.target.value as "ACTIVE" | "DRAFT")}
                  style={selectStyle}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="DRAFT">Draft</option>
                </select>
              </div>

              <ToggleRow label="Sales Channels" checked={salesChannels} onChange={setSalesChannels} />
              <ToggleRow label="VAT" checked={vatEnabled} onChange={setVatEnabled} />
              <ToggleRow label="Alt Text Optimization" checked={altText} onChange={setAltText} />
              <ToggleRow label="Variant Pricing (same price)" checked={variantPricing} onChange={setVariantPricing} />
              <ToggleRow
                label="Continue Selling When Out of Stock"
                checked={inventoryPolicy === "CONTINUE"}
                onChange={(v) => setInventoryPolicy(v ? "CONTINUE" : "DENY")}
              />
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => setStep("select")} variant="tertiary">Back</s-button>
              <s-button
                onClick={handleUpload}
                variant="primary"
                {...(isUploading ? { loading: true } : {})}
              >
                {isUploading ? "Uploading..." : `Import ${selectedIds.size} Products`}
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
              <s-paragraph>
                Please wait while we create {selectedIds.size} products in your store.
                This may take a few minutes for large batches.
              </s-paragraph>
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
          top: "8px",
          right: "8px",
          width: "20px",
          height: "20px",
          borderRadius: "4px",
          border: "2px solid",
          borderColor: selected ? "var(--p-color-border-interactive)" : "var(--p-color-border)",
          backgroundColor: selected ? "var(--p-color-bg-fill-brand)" : "var(--p-color-bg-surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        {selected && (
          <span style={{ color: "white", fontSize: "12px", fontWeight: "bold" }}>
            ✓
          </span>
        )}
      </div>

      {/* Image */}
      <div style={{ aspectRatio: "1", overflow: "hidden", backgroundColor: "#f5f5f5" }}>
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
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
          <span style={{ fontSize: "11px", color: "#666" }}>
            {product.variants.length} variant{product.variants.length !== 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>${price}</span>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <s-text fontWeight="semibold">{label}</s-text>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: "40px", height: "20px", accentColor: "var(--p-color-bg-fill-brand)" }}
      />
    </div>
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
