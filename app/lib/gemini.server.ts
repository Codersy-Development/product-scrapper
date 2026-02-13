import type { ScrapedProduct, OptimizedProduct, GeneratedImage } from "./types";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const GEMINI_IMAGE_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data: any = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Gemini API");
  }
  return text.trim();
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:html|json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "").trim();
}

function removeNegativeWords(text: string, negativeWords: string[]): string {
  let result = text;
  for (const word of negativeWords) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    result = result.replace(regex, "");
  }
  // Clean up double spaces left by removals
  return result.replace(/\s{2,}/g, " ").trim();
}

export async function optimizeProduct(
  product: ScrapedProduct,
  titlePrompt: string | null,
  descriptionPrompt: string | null,
  negativeWords: string[],
  apiKey: string,
  optimizeAltText: boolean = true,
): Promise<OptimizedProduct> {
  const negativeClause =
    negativeWords.length > 0
      ? `\n\nIMPORTANT: The following words must NEVER appear in the output: ${negativeWords.join(", ")}`
      : "";

  // Optimize title
  const titlePromptFull = titlePrompt
    ? `${titlePrompt}\n\nOriginal product title: "${product.title}"\nProduct type: "${product.productType}"\nVendor: "${product.vendor}"${negativeClause}\n\nReturn ONLY the optimized title text, nothing else.`
    : `Optimize this product title for SEO and conversions. Make it compelling, keyword-rich, and under 70 characters.\n\nOriginal title: "${product.title}"\nProduct type: "${product.productType}"${negativeClause}\n\nReturn ONLY the optimized title, nothing else.`;

  let optimizedTitle: string;
  try {
    optimizedTitle = await callGemini(titlePromptFull, apiKey);
    optimizedTitle = stripCodeFences(optimizedTitle);
    // Remove surrounding quotes if Gemini added them
    optimizedTitle = optimizedTitle.replace(/^["']|["']$/g, "");
  } catch (error) {
    console.error(`Failed to optimize title for "${product.title}":`, error);
    optimizedTitle = product.title;
  }

  // Optimize description
  const descPromptFull = descriptionPrompt
    ? `${descriptionPrompt}\n\nOriginal product description:\n${product.description}${negativeClause}\n\nReturn ONLY valid HTML for the product description.`
    : `Optimize this product description for SEO. Make it engaging, well-structured with HTML formatting, and keyword-optimized.\n\nOriginal description:\n${product.description}${negativeClause}\n\nReturn ONLY valid HTML for the description, no markdown.`;

  let optimizedDescription: string;
  try {
    optimizedDescription = await callGemini(descPromptFull, apiKey);
    optimizedDescription = stripCodeFences(optimizedDescription);
  } catch (error) {
    console.error(`Failed to optimize description for "${product.title}":`, error);
    optimizedDescription = product.description;
  }

  // Optimize image alt text
  let optimizedImages = product.images;
  if (optimizeAltText && product.images.length > 0) {
    optimizedImages = await Promise.all(
      product.images.map(async (img) => {
        try {
          const altPrompt = `Generate SEO-optimized alt text for a product image. Product: "${optimizedTitle}". Image position: ${img.position} of ${product.images.length}.${negativeClause}\n\nReturn ONLY the alt text, under 125 characters, no quotes.`;
          const altText = await callGemini(altPrompt, apiKey);
          return { ...img, alt: stripCodeFences(altText).replace(/^["']|["']$/g, "") };
        } catch {
          return img;
        }
      }),
    );
  }

  // Post-process: remove negative words
  if (negativeWords.length > 0) {
    optimizedTitle = removeNegativeWords(optimizedTitle, negativeWords);
    optimizedDescription = removeNegativeWords(optimizedDescription, negativeWords);
  }

  return {
    ...product,
    originalTitle: product.title,
    originalDescription: product.description,
    title: optimizedTitle,
    description: optimizedDescription,
    images: optimizedImages,
  };
}

export async function optimizeProducts(
  products: ScrapedProduct[],
  titlePrompt: string | null,
  descriptionPrompt: string | null,
  negativeWords: string[],
  apiKey: string,
  optimizeAltText: boolean = true,
): Promise<{ products: OptimizedProduct[]; warnings: string[] }> {
  const BATCH_SIZE = 3;
  const optimized: OptimizedProduct[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((product) =>
        optimizeProduct(product, titlePrompt, descriptionPrompt, negativeWords, apiKey, optimizeAltText),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        optimized.push(result.value);
      } else {
        warnings.push(`Failed to optimize "${batch[j].title}": ${result.reason?.message || "Unknown error"}`);
        // Fall back to original product data
        optimized.push({
          ...batch[j],
          originalTitle: batch[j].title,
          originalDescription: batch[j].description,
        });
      }
    }
  }

  return { products: optimized, warnings };
}

export async function generateProductImage(
  prompt: string,
  referenceImageUrl: string | undefined,
  apiKey: string,
): Promise<{ base64Data: string; mimeType: string }> {
  const parts: any[] = [];

  // If enhancing an existing image, include it as context
  if (referenceImageUrl) {
    const imageResponse = await fetch(referenceImageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch reference image: ${imageResponse.status}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(
      String.fromCharCode(...new Uint8Array(imageBuffer)),
    );
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

    parts.push({
      inlineData: {
        mimeType: contentType,
        data: base64Image,
      },
    });
  }

  parts.push({ text: prompt });

  const response = await fetch(`${GEMINI_IMAGE_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Image API error ${response.status}: ${errorText}`);
  }

  const data: any = await response.json();
  const candidates = data?.candidates?.[0]?.content?.parts || [];

  // Find the image part in the response
  for (const part of candidates) {
    if (part.inlineData) {
      return {
        base64Data: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
  }

  throw new Error("No image was generated by the API");
}

export async function generateImageAltText(
  productTitle: string,
  imageDescription: string,
  negativeWords: string[],
  apiKey: string,
): Promise<string> {
  const negativeClause =
    negativeWords.length > 0
      ? `\nNever use these words: ${negativeWords.join(", ")}`
      : "";

  const prompt = `Generate SEO-optimized alt text for a product image.
Product: "${productTitle}"
Image context: ${imageDescription}
${negativeClause}

Return ONLY the alt text, under 125 characters, no quotes.`;

  let altText = await callGemini(prompt, apiKey);
  altText = stripCodeFences(altText).replace(/^["']|["']$/g, "");

  if (negativeWords.length > 0) {
    altText = removeNegativeWords(altText, negativeWords);
  }

  return altText;
}
