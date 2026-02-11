import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  parseShopifyUrl,
  scrapeProductUrl,
  scrapeCollectionUrl,
  deduplicateProducts,
} from "../lib/scraper.server";
import type { ScrapedProduct } from "../lib/types";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const urls = (formData.get("urls") as string || "").split("\n").filter((u) => u.trim());
  const importType = (formData.get("type") as string) || "product";

  const results: ScrapedProduct[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url) continue;

    try {
      const parsed = parseShopifyUrl(url, importType as "product" | "collection");

      if (parsed.type === "product") {
        const product = await scrapeProductUrl(parsed.store, parsed.handle);
        results.push(product);
      } else {
        const products = await scrapeCollectionUrl(parsed.store, parsed.handle);
        results.push(...products);
      }
    } catch (error: any) {
      errors.push({ url, error: error.message || "Failed to scrape" });
    }
  }

  const deduped = deduplicateProducts(results);

  return Response.json({ products: deduped, errors });
};
