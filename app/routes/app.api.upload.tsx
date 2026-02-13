import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { applyPricingToAllVariants } from "../lib/pricing.server";
import {
  PRODUCT_CREATE_MUTATION,
  PRODUCT_UPDATE_MUTATION,
  COLLECTION_ADD_PRODUCTS_MUTATION,
} from "../lib/shopify-queries.server";
import type { ScrapedProduct, StoreSettings } from "../lib/types";

interface UploadPayload {
  products: ScrapedProduct[];
  settings: StoreSettings;
  collectionIds: string[];
  sourceUrls: string[];
}

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;
  const payload: UploadPayload = await request.json();
  const { products, settings, collectionIds, sourceUrls } = payload;

  // Create import batch record
  const batchResult = await db
    .prepare(
      `INSERT INTO import_batches (shop, status, total_products, source_urls, settings_snapshot)
       VALUES (?, 'processing', ?, ?, ?)`,
    )
    .bind(
      session.shop,
      products.length,
      JSON.stringify(sourceUrls || []),
      JSON.stringify(settings),
    )
    .run();

  const batchId = batchResult.meta.last_row_id;
  let imported = 0;
  let failed = 0;
  const createdProductIds: string[] = [];

  for (const product of products) {
    try {
      // Apply pricing rules
      const processedVariants = applyPricingToAllVariants(product.variants, settings);

      // Build product input (ProductCreateInput only supports basic fields)
      const productInput: any = {
        title: product.title,
        descriptionHtml: product.description,
        vendor: settings.vendor || product.vendor,
        productType: product.productType,
        tags: product.tags,
        status: settings.product_status,
      };

      const response = await admin.graphql(PRODUCT_CREATE_MUTATION, {
        variables: { product: productInput },
      });
      const result: any = await response.json();
      const createdProduct = result.data?.productCreate?.product;

      if (createdProduct && !result.data?.productCreate?.userErrors?.length) {
        const productId = createdProduct.id;

        // Now update the product with variants and images using ProductUpdate
        const updateInput: any = {
          id: productId,
        };

        // Add images
        if (product.images.length > 0) {
          updateInput.images = product.images.map((img) => ({
            src: img.src,
            altText: img.alt || "",
          }));
        }

        // Add variants with options
        if (processedVariants.length > 0) {
          updateInput.variants = processedVariants.map((v) => ({
            price: v.price,
            compareAtPrice: v.compareAtPrice || undefined,
            sku: v.sku || undefined,
            weight: v.weight || undefined,
            weightUnit: v.weightUnit?.toUpperCase() || undefined,
            taxable: settings.vat_enabled,
            inventoryManagement: settings.track_inventory ? "SHOPIFY" : null,
            inventoryPolicy: settings.inventory_policy,
            options: [v.option1, v.option2, v.option3].filter(Boolean),
          }));
        }

        // Add options (variant options like Size, Color, etc.)
        if (product.options.length > 0) {
          updateInput.productOptions = product.options.map((o) => ({
            name: o.name,
            values: o.values.map((v: string) => ({ name: v })),
          }));
        }

        try {
          const updateResponse = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
            variables: { input: updateInput },
          });
          const updateResult: any = await updateResponse.json();

          if (updateResult.data?.productUpdate?.userErrors?.length > 0) {
            console.error("Product update errors:", updateResult.data.productUpdate.userErrors);
          }
        } catch (updateError) {
          console.error("Failed to update product with variants/images:", updateError);
        }

        createdProductIds.push(productId);
        imported++;
      } else {
        const errors = result.data?.productCreate?.userErrors;
        console.error("Product creation errors:", errors);
        failed++;
      }
    } catch (error) {
      console.error("Failed to create product:", error);
      failed++;
    }
  }

  // Assign to collections
  if (collectionIds.length > 0 && createdProductIds.length > 0) {
    for (const collectionId of collectionIds) {
      try {
        await admin.graphql(COLLECTION_ADD_PRODUCTS_MUTATION, {
          variables: {
            id: collectionId,
            productIds: createdProductIds,
          },
        });
      } catch (error) {
        console.error(`Failed to add products to collection ${collectionId}:`, error);
      }
    }
  }

  // Update batch record
  await db
    .prepare(
      `UPDATE import_batches SET status = 'completed', imported_products = ?, failed_products = ?, completed_at = unixepoch() WHERE id = ?`,
    )
    .bind(imported, failed, batchId)
    .run();

  return Response.json({ batchId, imported, failed, total: products.length });
};
