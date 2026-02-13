import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  DEFAULT_STORE_SETTINGS,
  DEFAULT_NEGATIVE_WORDS,
  PRICE_ROUNDING_OPTIONS,
  LANGUAGE_OPTIONS,
} from "../lib/types";
import type { StoreSettings } from "../lib/types";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  const settingsRow = await db
    .prepare("SELECT * FROM store_settings WHERE shop = ?")
    .bind(session.shop)
    .first();

  const negativeWordsResult = await db
    .prepare("SELECT word FROM negative_words WHERE shop = ?")
    .bind(session.shop)
    .all();

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

  const negativeWords = negativeWordsResult.results.map((r) => r.word as string);

  return { settings, negativeWords };
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save_settings") {
    await db
      .prepare(
        `INSERT OR REPLACE INTO store_settings
        (shop, vendor, language, region, default_inventory, track_inventory,
         retail_price_multiplier, compare_at_price_multiplier, retail_price_manual,
         compare_at_price_manual, price_rounding, product_status, sales_channels,
         vat_enabled, alt_text_optimization, variant_pricing, inventory_policy,
         product_tags_enabled, product_type_enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
      )
      .bind(
        session.shop,
        formData.get("vendor") || "",
        formData.get("language") || "English",
        formData.get("region") || "",
        Number(formData.get("default_inventory")) || 99,
        formData.get("track_inventory") === "true" ? 1 : 0,
        Number(formData.get("retail_price_multiplier")) || 1,
        Number(formData.get("compare_at_price_multiplier")) || 0,
        formData.get("retail_price_manual") === "true" ? 1 : 0,
        formData.get("compare_at_price_manual") === "true" ? 1 : 0,
        formData.get("price_rounding") || ".95",
        formData.get("product_status") || "ACTIVE",
        formData.get("sales_channels") === "true" ? 1 : 0,
        formData.get("vat_enabled") === "true" ? 1 : 0,
        formData.get("alt_text_optimization") === "true" ? 1 : 0,
        formData.get("variant_pricing") === "true" ? 1 : 0,
        formData.get("inventory_policy") || "CONTINUE",
        formData.get("product_tags_enabled") === "true" ? 1 : 0,
        formData.get("product_type_enabled") === "true" ? 1 : 0,
      )
      .run();

    return { success: true };
  }

  if (intent === "save_negative_words") {
    const words = JSON.parse(formData.get("words") as string) as string[];

    // Delete existing
    await db.prepare("DELETE FROM negative_words WHERE shop = ?").bind(session.shop).run();

    // Insert new
    for (const word of words) {
      if (word.trim()) {
        await db
          .prepare("INSERT OR IGNORE INTO negative_words (shop, word) VALUES (?, ?)")
          .bind(session.shop, word.trim())
          .run();
      }
    }

    return { success: true };
  }

  return { error: "Unknown action" };
};

export default function Settings() {
  const { settings, negativeWords: initialNegativeWords } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [vendor, setVendor] = useState(settings.vendor);
  const [language, setLanguage] = useState(settings.language);
  const [region, setRegion] = useState(settings.region);
  const [defaultInventory, setDefaultInventory] = useState(String(settings.default_inventory));
  const [trackInventory, setTrackInventory] = useState(settings.track_inventory);
  const [retailMultiplier, setRetailMultiplier] = useState(String(settings.retail_price_multiplier));
  const [compareAtMultiplier, setCompareAtMultiplier] = useState(String(settings.compare_at_price_multiplier));
  const [retailManual, setRetailManual] = useState(settings.retail_price_manual);
  const [compareAtManual, setCompareAtManual] = useState(settings.compare_at_price_manual);
  const [priceRounding, setPriceRounding] = useState(settings.price_rounding);
  const [productStatus, setProductStatus] = useState(settings.product_status);
  const [salesChannels, setSalesChannels] = useState(settings.sales_channels);
  const [vatEnabled, setVatEnabled] = useState(settings.vat_enabled);
  const [altText, setAltText] = useState(settings.alt_text_optimization);
  const [variantPricing, setVariantPricing] = useState(settings.variant_pricing);
  const [inventoryPolicy, setInventoryPolicy] = useState(settings.inventory_policy);
  const [productTags, setProductTags] = useState(settings.product_tags_enabled);
  const [productType, setProductType] = useState(settings.product_type_enabled);

  // Negative words state
  const [negativeWords, setNegativeWords] = useState<string[]>(initialNegativeWords);
  const [newWord, setNewWord] = useState("");
  const [showNegativeWords, setShowNegativeWords] = useState(false);

  const isSubmitting = fetcher.state !== "idle";

  const handleSaveSettings = () => {
    fetcher.submit(
      {
        intent: "save_settings",
        vendor,
        language,
        region,
        default_inventory: defaultInventory,
        track_inventory: String(trackInventory),
        retail_price_multiplier: retailMultiplier,
        compare_at_price_multiplier: compareAtMultiplier,
        retail_price_manual: String(retailManual),
        compare_at_price_manual: String(compareAtManual),
        price_rounding: priceRounding,
        product_status: productStatus,
        sales_channels: String(salesChannels),
        vat_enabled: String(vatEnabled),
        alt_text_optimization: String(altText),
        variant_pricing: String(variantPricing),
        inventory_policy: inventoryPolicy,
        product_tags_enabled: String(productTags),
        product_type_enabled: String(productType),
      },
      { method: "POST" },
    );
    shopify.toast.show("Settings saved");
  };

  const addNegativeWord = () => {
    if (newWord.trim() && !negativeWords.includes(newWord.trim())) {
      const updated = [...negativeWords, newWord.trim()];
      setNegativeWords(updated);
      setNewWord("");
      fetcher.submit(
        { intent: "save_negative_words", words: JSON.stringify(updated) },
        { method: "POST" },
      );
    }
  };

  const removeNegativeWord = (word: string) => {
    const updated = negativeWords.filter((w) => w !== word);
    setNegativeWords(updated);
    fetcher.submit(
      { intent: "save_negative_words", words: JSON.stringify(updated) },
      { method: "POST" },
    );
  };

  const resetNegativeWords = () => {
    setNegativeWords([...DEFAULT_NEGATIVE_WORDS]);
    fetcher.submit(
      { intent: "save_negative_words", words: JSON.stringify(DEFAULT_NEGATIVE_WORDS) },
      { method: "POST" },
    );
    shopify.toast.show("Reset to default list");
  };

  return (
    <s-page heading="Store Settings">
      <s-button
        slot="primary-action"
        onClick={handleSaveSettings}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save Settings
      </s-button>

      <s-section heading="Store Settings">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <div style={{ flex: 1 }}>
              <s-text-field
                label="Product Vendor"
                value={vendor}
                onInput={(e: any) => setVendor(e.target.value)}
                placeholder="Your store name"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
                Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--p-color-border)",
                  fontSize: "14px",
                  backgroundColor: "var(--p-color-bg-surface)",
                }}
              >
                {LANGUAGE_OPTIONS.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
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

          <s-stack direction="inline" gap="base" align="center">
            <s-text>Track Inventory</s-text>
            <input
              type="checkbox"
              checked={trackInventory}
              onChange={(e) => setTrackInventory(e.target.checked)}
              style={{ width: "40px", height: "20px" }}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Pricing">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <div style={{ flex: 1 }}>
              <s-text-field
                label="Retail Price Multiplier"
                type="number"
                value={retailMultiplier}
                onInput={(e: any) => setRetailMultiplier(e.target.value)}
                step="0.1"
              />
              <s-stack direction="inline" gap="tight" align="center">
                <s-text variant="bodySm">Manual</s-text>
                <input
                  type="checkbox"
                  checked={retailManual}
                  onChange={(e) => setRetailManual(e.target.checked)}
                />
              </s-stack>
            </div>
            <div style={{ flex: 1 }}>
              <s-text-field
                label="Compare at Price Multiplier"
                type="number"
                value={compareAtMultiplier}
                onInput={(e: any) => setCompareAtMultiplier(e.target.value)}
                step="0.1"
              />
              <s-stack direction="inline" gap="tight" align="center">
                <s-text variant="bodySm">Manual</s-text>
                <input
                  type="checkbox"
                  checked={compareAtManual}
                  onChange={(e) => setCompareAtManual(e.target.checked)}
                />
              </s-stack>
            </div>
          </s-stack>

          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
              Price Rounding
            </label>
            <select
              value={priceRounding}
              onChange={(e) => setPriceRounding(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--p-color-border)",
                fontSize: "14px",
                backgroundColor: "var(--p-color-bg-surface)",
              }}
            >
              {PRICE_ROUNDING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Product Defaults">
        <s-stack direction="block" gap="base">
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: 500 }}>
              Product Status
            </label>
            <select
              value={productStatus}
              onChange={(e) => setProductStatus(e.target.value as "ACTIVE" | "DRAFT")}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--p-color-border)",
                fontSize: "14px",
                backgroundColor: "var(--p-color-bg-surface)",
              }}
            >
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>

          <s-stack direction="block" gap="tight">
            <ToggleRow label="Sales Channels" description="Publish products to sales channels" checked={salesChannels} onChange={setSalesChannels} />
            <ToggleRow label="VAT" description="Enable VAT for products" checked={vatEnabled} onChange={setVatEnabled} />
            <ToggleRow label="Alt Text" description="Optimize image alt text for SEO" checked={altText} onChange={setAltText} />
            <ToggleRow label="Variant Pricing" description="Force all variants to have the same price" checked={variantPricing} onChange={setVariantPricing} />
            <ToggleRow
              label="Inventory Policy"
              description="Continue selling even when out of stock"
              checked={inventoryPolicy === "CONTINUE"}
              onChange={(v) => setInventoryPolicy(v ? "CONTINUE" : "DENY")}
            />
            <ToggleRow label="Product Tags" description="Generate optimized tags with AI" checked={productTags} onChange={setProductTags} />
            <ToggleRow label="Product Type" description="Let AI determine the best product type" checked={productType} onChange={setProductType} />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Negative Words">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Words that will never appear in AI-generated content. These are filtered out during optimization.
          </s-paragraph>
          <s-stack direction="inline" gap="tight">
            <s-button onClick={() => setShowNegativeWords(!showNegativeWords)} variant="tertiary">
              {showNegativeWords ? "Hide" : "Manage"} Negative Words ({negativeWords.length})
            </s-button>
            <s-button onClick={resetNegativeWords} variant="tertiary">
              Reset to Default List
            </s-button>
          </s-stack>

          {showNegativeWords && (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="tight">
                  <s-text-field
                    label="Add word to exclude"
                    value={newWord}
                    onInput={(e: any) => setNewWord(e.target.value)}
                    placeholder="Type a word..."
                    onKeyDown={(e: any) => {
                      if (e.key === "Enter") addNegativeWord();
                    }}
                  />
                  <s-button onClick={addNegativeWord}>+ Add</s-button>
                </s-stack>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {negativeWords.map((word) => (
                    <span
                      key={word}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "4px 12px",
                        borderRadius: "16px",
                        backgroundColor: "var(--p-color-bg-surface-secondary)",
                        border: "1px solid var(--p-color-border)",
                        fontSize: "13px",
                      }}
                    >
                      {word}
                      <button
                        onClick={() => removeNegativeWord(word)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "14px",
                          padding: "0 2px",
                          color: "var(--p-color-text-secondary)",
                        }}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid var(--p-color-border-subdued)",
      }}
    >
      <div>
        <s-text fontWeight="semibold">{label}</s-text>
        <div>
          <s-text variant="bodySm" tone="subdued">
            {description}
          </s-text>
        </div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: "40px", height: "20px", accentColor: "var(--p-color-bg-fill-brand)" }}
      />
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
