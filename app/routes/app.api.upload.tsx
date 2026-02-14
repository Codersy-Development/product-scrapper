import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { applyPricingToAllVariants, detectCurrency } from "../lib/pricing.server";
import { enhanceProductImage } from "../lib/gemini.server";
import { optimizeProduct } from "../lib/gemini.server";
import {
  PRODUCT_CREATE_MUTATION,
  PRODUCT_CREATE_MEDIA_MUTATION,
  PRODUCT_VARIANT_BULK_UPDATE_MUTATION,
  COLLECTION_ADD_PRODUCTS_MUTATION,
  STAGED_UPLOADS_CREATE_MUTATION,
} from "../lib/shopify-queries.server";
import type { ScrapedProduct, StoreSettings, ProductImage } from "../lib/types";

interface UploadPayload {
  products: ScrapedProduct[];
  settings: StoreSettings;
  collectionIds: string[];
  sourceUrls: string[];
  enhanceImages?: boolean;
  optimizeContent?: boolean;
  titleTemplateId?: string;
  descTemplateId?: string;
  negativeWords?: string[];
}

async function uploadBase64ImageToShopify(
  base64Data: string,
  mimeType: string,
  filename: string,
  admin: any,
): Promise<string> {
  // Step 1: Request staged upload URL from Shopify
  const stagedUploadResponse = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
    variables: {
      input: [
        {
          filename,
          mimeType,
          resource: "IMAGE",
          httpMethod: "POST",
        },
      ],
    },
  });

  const stagedUploadResult: any = await stagedUploadResponse.json();
  const stagedTarget = stagedUploadResult.data?.stagedUploadsCreate?.stagedTargets?.[0];

  if (!stagedTarget) {
    throw new Error("Failed to get staged upload URL from Shopify");
  }

  // Step 2: Convert base64 to blob
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });

  // Step 3: Upload to staged URL
  const formData = new FormData();
  for (const param of stagedTarget.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", blob, filename);

  const uploadResponse = await fetch(stagedTarget.url, {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload image to Shopify CDN: ${uploadResponse.status}`);
  }

  // Step 4: Return the resourceUrl from staged target
  return stagedTarget.resourceUrl;
}

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;
  const geminiApiKey = context.cloudflare.env.GEMINI_API_KEY;
  const payload: UploadPayload = await request.json();
  const {
    products,
    settings,
    collectionIds,
    sourceUrls,
    enhanceImages,
    optimizeContent,
    titleTemplateId,
    descTemplateId,
    negativeWords = [],
  } = payload;

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

  // Detect currencies for conversion
  const sourceCurrency = "USD"; // Default to USD for scraped products
  const targetCurrency = detectCurrency(settings.region);

  // Load templates if content optimization is requested
  let titlePrompt: string | null = null;
  let descPrompt: string | null = null;
  if (optimizeContent && geminiApiKey) {
    if (titleTemplateId) {
      const titleTemplate = await db
        .prepare("SELECT title_prompt FROM prompt_templates WHERE id = ? AND shop = ?")
        .bind(titleTemplateId, session.shop)
        .first();
      titlePrompt = (titleTemplate?.title_prompt as string) || null;
    }
    if (descTemplateId) {
      const descTemplate = await db
        .prepare("SELECT description_prompt FROM prompt_templates WHERE id = ? AND shop = ?")
        .bind(descTemplateId, session.shop)
        .first();
      descPrompt = (descTemplate?.description_prompt as string) || null;
    }
  }

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    try {
      console.log(`\n--- Processing product ${i + 1}/${products.length}: "${product.title}" ---`);

      // Optimize content if requested
      let processedProduct = product;
      if (optimizeContent && geminiApiKey) {
        try {
          console.log(`Optimizing content for "${product.title}"...`);
          const optimized = await optimizeProduct(
            product,
            titlePrompt,
            descPrompt,
            negativeWords,
            geminiApiKey,
            settings.alt_text_optimization,
          );
          processedProduct = optimized as any;
          console.log(`Successfully optimized content for "${product.title}"`);
        } catch (optError) {
          console.error(`Failed to optimize content for "${product.title}":`, optError);
          // Continue with original product
        }
      }

      // Apply pricing rules with currency conversion
      const processedVariants = applyPricingToAllVariants(
        processedProduct.variants,
        settings,
        sourceCurrency,
        targetCurrency,
      );

      console.log(`Processed ${processedVariants.length} variants for "${processedProduct.title}". First variant price: ${processedVariants[0]?.price}`);

      // Enhance images if requested
      let processedImages: ProductImage[] = processedProduct.images;
      if (enhanceImages && geminiApiKey && processedProduct.images.length > 0) {
        processedImages = [];
        for (let i = 0; i < processedProduct.images.length; i++) {
          const img = processedProduct.images[i];
          try {
            console.log(`Enhancing image ${i + 1}/${processedProduct.images.length} for "${processedProduct.title}"...`);

            const { base64Data, mimeType } = await enhanceProductImage(
              img.src,
              processedProduct.title,
              product.description, // Pass original description for context
              i,
              processedProduct.images.length,
              geminiApiKey,
            );

            // Upload enhanced image to Shopify with product name
            const cleanName = processedProduct.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .substring(0, 50);
            const uploadedUrl = await uploadBase64ImageToShopify(
              base64Data,
              mimeType,
              `${cleanName}-${i + 1}.${mimeType.split('/')[1]}`,
              admin,
            );

            processedImages.push({
              ...img,
              src: uploadedUrl,
              alt: img.alt || `${processedProduct.title} - Image ${i + 1}`,
            });

            console.log(`Successfully enhanced and uploaded image ${i + 1} for "${processedProduct.title}"`);
          } catch (enhanceError) {
            console.error(`Failed to enhance image ${i + 1} for "${processedProduct.title}":`, enhanceError);
            // Fall back to original image
            processedImages.push(img);
          }
        }
      }

      // Create product with basic fields only (productCreate doesn't support nested media/variants)
      const productInput: any = {
        title: processedProduct.title,
        descriptionHtml: processedProduct.description,
        vendor: settings.vendor || processedProduct.vendor,
        productType: processedProduct.productType,
        tags: processedProduct.tags,
        status: settings.product_status,
      };

      console.log(`Creating product "${processedProduct.title}" with tags:`, processedProduct.tags);

      const response = await admin.graphql(PRODUCT_CREATE_MUTATION, {
        variables: { product: productInput },
      });
      const result: any = await response.json();
      const createdProduct = result.data?.productCreate?.product;

      if (createdProduct) {
        console.log(`Product created: ${createdProduct.id}, tags: ${createdProduct.tags}`);
      }

      if (createdProduct && !result.data?.productCreate?.userErrors?.length) {
        const productId = createdProduct.id;

        // Update the default variant with price and weight data
        // Shopify automatically creates one variant when we create a product
        if (createdProduct.variants?.edges?.length > 0) {
          const defaultVariantId = createdProduct.variants.edges[0].node.id;
          const firstVariant = processedVariants[0];

          try {
            // Map weight unit to Shopify's enum values
            const weightUnitMap: Record<string, string> = {
              kg: "KILOGRAMS",
              g: "GRAMS",
              lb: "POUNDS",
              oz: "OUNCES",
              kilograms: "KILOGRAMS",
              grams: "GRAMS",
              pounds: "POUNDS",
              ounces: "OUNCES",
            };
            const weightUnit = weightUnitMap[firstVariant.weightUnit?.toLowerCase() || "kg"] || "KILOGRAMS";

            console.log(`Updating variant for "${processedProduct.title}":`, {
              variantId: defaultVariantId,
              price: firstVariant.price,
              compareAtPrice: firstVariant.compareAtPrice,
              sku: firstVariant.sku,
              weight: firstVariant.weight,
              weightUnit,
            });

            const variantUpdateResponse = await admin.graphql(PRODUCT_VARIANT_BULK_UPDATE_MUTATION, {
              variables: {
                productId,
                variants: [
                  {
                    id: defaultVariantId,
                    price: firstVariant.price,
                    compareAtPrice: firstVariant.compareAtPrice || null,
                    sku: firstVariant.sku || null,
                    weight: firstVariant.weight > 0 ? firstVariant.weight : null,
                    weightUnit: weightUnit,
                  },
                ],
              },
            });

            const variantUpdateResult: any = await variantUpdateResponse.json();

            if (variantUpdateResult.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
              console.error(`Variant update errors for "${processedProduct.title}":`,
                variantUpdateResult.data.productVariantsBulkUpdate.userErrors);
            } else {
              console.log(`Successfully updated variant for "${processedProduct.title}"`);
            }
          } catch (variantError) {
            console.error(`Failed to update variant for "${processedProduct.title}":`, variantError);
          }
        }

        // Add images using productCreateMedia if we have any
        if (processedImages.length > 0) {
          try {
            const mediaInput = processedImages.map((img, idx) => ({
              originalSource: img.src,
              alt: img.alt || `${processedProduct.title} - Image ${idx + 1}`,
              mediaContentType: "IMAGE",
            }));

            await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
              variables: {
                productId,
                media: mediaInput,
              },
            });
          } catch (mediaError) {
            console.error(`Failed to add media to product "${processedProduct.title}":`, mediaError);
          }
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

    // Add delay between products to avoid rate limiting (especially important with AI optimization)
    if (i < products.length - 1 && (optimizeContent || enhanceImages)) {
      const delayMs = 1000; // 1 second between products
      console.log(`Waiting ${delayMs}ms before next product...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
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
