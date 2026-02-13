import type { ScrapedProduct, ProductImage, ProductVariant, ProductOption } from "./types";

interface ParsedUrl {
  store: string;
  handle: string;
  type: "product" | "collection";
}

export function parseShopifyUrl(url: string, defaultType: "product" | "collection"): ParsedUrl {
  const trimmed = url.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }

  const store = parsed.hostname;
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  // /collections/{handle}
  if (pathParts[0] === "collections" && pathParts[1]) {
    // If there's /products after collection, it's still a collection URL
    return { store, handle: pathParts[1], type: "collection" };
  }

  // /products/{handle}
  if (pathParts[0] === "products" && pathParts[1]) {
    return { store, handle: pathParts[1], type: "product" };
  }

  // Fall back to the default type if path doesn't clearly indicate
  if (pathParts.length > 0) {
    return { store, handle: pathParts[pathParts.length - 1], type: defaultType };
  }

  throw new Error(`Could not parse handle from URL: ${trimmed}`);
}

export function normalizeProduct(raw: any, sourceUrl: string, sourceStore: string): ScrapedProduct {
  const images: ProductImage[] = (raw.images || []).map((img: any, idx: number) => ({
    src: img.src || "",
    alt: img.alt || null,
    position: img.position || idx + 1,
  }));

  const variants: ProductVariant[] = (raw.variants || []).map((v: any) => ({
    title: v.title || "Default",
    price: String(v.price || "0.00"),
    compareAtPrice: v.compare_at_price ? String(v.compare_at_price) : null,
    sku: v.sku || "",
    weight: v.weight || 0,
    weightUnit: v.weight_unit || "kg",
    inventoryQuantity: v.inventory_quantity || 0,
    option1: v.option1 || null,
    option2: v.option2 || null,
    option3: v.option3 || null,
  }));

  const options: ProductOption[] = (raw.options || []).map((opt: any) => ({
    name: opt.name || "",
    values: opt.values || [],
  }));

  return {
    externalId: raw.id,
    title: raw.title || "",
    handle: raw.handle || "",
    description: raw.body_html || "",
    vendor: raw.vendor || "",
    productType: raw.product_type || "",
    tags: typeof raw.tags === "string" ? raw.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : (raw.tags || []),
    images,
    variants,
    options,
    sourceUrl,
    sourceStore,
  };
}

export function deduplicateProducts(products: ScrapedProduct[]): ScrapedProduct[] {
  const seen = new Map<string, ScrapedProduct>();
  for (const product of products) {
    const key = `${product.sourceStore}:${product.externalId}`;
    if (!seen.has(key)) {
      seen.set(key, product);
    }
  }
  return Array.from(seen.values());
}

export async function scrapeProductUrl(store: string, handle: string): Promise<ScrapedProduct> {
  const response = await fetch(`https://${store}/products/${handle}.json`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": `https://${store}/`,
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching product ${handle} from ${store}`);
  }
  const data: any = await response.json();
  return normalizeProduct(data.product, `https://${store}/products/${handle}`, store);
}

export async function scrapeCollectionUrl(store: string, handle: string): Promise<ScrapedProduct[]> {
  const products: ScrapedProduct[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://${store}/collections/${handle}/products.json?limit=250&page=${page}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Referer": `https://${store}/collections/${handle}`,
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching collection ${handle} from ${store} (page ${page})`);
    }
    const data: any = await response.json();

    if (!data.products || data.products.length === 0) break;

    for (const product of data.products) {
      products.push(
        normalizeProduct(product, `https://${store}/collections/${handle}`, store)
      );
    }

    if (data.products.length < 250) break;
    page++;
  }

  return products;
}
