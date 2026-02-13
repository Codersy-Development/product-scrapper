export interface ScrapedProduct {
  externalId: number;
  title: string;
  handle: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  images: ProductImage[];
  variants: ProductVariant[];
  options: ProductOption[];
  sourceUrl: string;
  sourceStore: string;
}

export interface ProductImage {
  src: string;
  alt: string | null;
  position: number;
}

export interface ProductVariant {
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string;
  weight: number;
  weightUnit: string;
  inventoryQuantity: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

export interface ProductOption {
  name: string;
  values: string[];
}

export interface OptimizedProduct extends ScrapedProduct {
  originalTitle: string;
  originalDescription: string;
}

export interface StoreSettings {
  id?: number;
  shop: string;
  vendor: string;
  language: string;
  region: string;
  default_inventory: number;
  track_inventory: boolean;
  retail_price_multiplier: number;
  compare_at_price_multiplier: number;
  retail_price_manual: boolean;
  compare_at_price_manual: boolean;
  price_rounding: string;
  product_status: "ACTIVE" | "DRAFT";
  sales_channels: boolean;
  vat_enabled: boolean;
  alt_text_optimization: boolean;
  variant_pricing: boolean;
  inventory_policy: "CONTINUE" | "DENY";
  product_tags_enabled: boolean;
  product_type_enabled: boolean;
}

export interface PromptTemplate {
  id: number;
  shop: string;
  name: string;
  title_prompt: string;
  description_prompt: string;
  created_at: number;
  updated_at: number;
}

export interface ImportBatch {
  id: number;
  shop: string;
  status: "pending" | "processing" | "completed" | "failed";
  total_products: number;
  imported_products: number;
  failed_products: number;
  source_urls: string;
  settings_snapshot: string;
  created_at: number;
  completed_at: number | null;
}

export interface ScrapeResult {
  products: ScrapedProduct[];
  errors: Array<{ url: string; error: string }>;
}

export interface UploadResult {
  batchId: number;
  imported: number;
  failed: number;
  total: number;
}

export interface ImageGenerationRequest {
  productId: string;
  productTitle: string;
  existingImageUrl?: string;
  mode: "generate" | "enhance";
  prompt: string;
  style: "product-only" | "lifestyle" | "white-background" | "custom";
}

export interface GeneratedImage {
  base64Data: string;
  mimeType: string;
  altText: string;
  prompt: string;
}

export interface ImageGenerationResult {
  productId: string;
  productTitle: string;
  images: GeneratedImage[];
  error?: string;
}

export const DEFAULT_NEGATIVE_WORDS = [
  "Shipping",
  "Payment",
  "Warranty",
  "Dropshipping",
  "China",
  "Hongkong",
  "Free",
  "Customer service",
  "Return",
  "Contact",
];

export const DEFAULT_STORE_SETTINGS: Omit<StoreSettings, "shop"> = {
  vendor: "",
  language: "English",
  region: "",
  default_inventory: 99,
  track_inventory: true,
  retail_price_multiplier: 1.0,
  compare_at_price_multiplier: 0,
  retail_price_manual: false,
  compare_at_price_manual: false,
  price_rounding: ".95",
  product_status: "ACTIVE",
  sales_channels: true,
  vat_enabled: true,
  alt_text_optimization: true,
  variant_pricing: false,
  inventory_policy: "CONTINUE",
  product_tags_enabled: false,
  product_type_enabled: false,
};

export const PRICE_ROUNDING_OPTIONS = [
  { label: "X.99", value: ".99" },
  { label: "X.95", value: ".95" },
  { label: "X.00 (Whole)", value: ".00" },
  { label: "X.90", value: ".90" },
  { label: "X.49", value: ".49" },
  { label: "X.50", value: ".50" },
];

export const LANGUAGE_OPTIONS = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Japanese",
  "Korean",
  "Chinese",
  "Arabic",
  "Turkish",
];
