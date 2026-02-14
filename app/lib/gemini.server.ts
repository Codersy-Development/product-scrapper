import type { ScrapedProduct, OptimizedProduct, GeneratedImage } from "./types";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const GEMINI_IMAGE_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

// Helper to add delay between API calls
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGemini(prompt: string, apiKey: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
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

        // If rate limited (429) and we have retries left, wait and retry
        if (response.status === 429 && attempt < retries) {
          const waitTime = Math.pow(2, attempt) * 2000; // Exponential backoff: 2s, 4s, 8s
          console.log(`Rate limited. Waiting ${waitTime}ms before retry ${attempt + 1}/${retries}...`);
          await delay(waitTime);
          continue;
        }

        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }

      const data: any = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from Gemini API");
      }

      // Add small delay after successful call to avoid rate limiting
      await delay(200);
      return text.trim();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      // For other errors, also retry with exponential backoff
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`API call failed. Retrying in ${waitTime}ms...`);
      await delay(waitTime);
    }
  }

  throw new Error("Failed after all retries");
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

export async function enhanceProductImage(
  imageUrl: string,
  productTitle: string,
  productDescription: string,
  imageIndex: number,
  totalImages: number,
  apiKey: string,
): Promise<{ base64Data: string; mimeType: string }> {
  // Fetch the original image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status}`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();

  // Convert to base64 in chunks to avoid stack overflow for large images
  const bytes = new Uint8Array(imageBuffer);
  const chunkSize = 32768; // 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  const base64Image = btoa(binary);
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

  // Design the enhancement prompt based on image position
  // First image = hero/product-only, others = lifestyle variations
  const isHeroImage = imageIndex === 0;

  // Extract key context from description (remove HTML tags for cleaner context)
  const descriptionText = productDescription.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const contextSnippet = descriptionText.length > 200 ? descriptionText.substring(0, 200) + '...' : descriptionText;

  const prompt = isHeroImage
    ? `You are a professional product photographer and image enhancement specialist. Enhance this product image to create a high-quality, professional product photo.

CRITICAL RULES - NEVER BREAK THESE:
- NEVER change the product itself (color, shape, design, branding, labels, text, features)
- ONLY improve image quality, lighting, background, and presentation
- Preserve all product details EXACTLY as they appear
- Maintain the same product angle and orientation

ENHANCEMENT INSTRUCTIONS for PRODUCT-ONLY IMAGE:
- Remove any distracting or cluttered background
- Place product on a clean, pure white background (#FFFFFF)
- Improve lighting to show the product clearly and evenly
- Enhance sharpness, clarity, and color accuracy
- Remove harsh shadows, but keep subtle shadows for depth
- Ensure professional studio-quality appearance
- Optimize for e-commerce display (clean, clear, professional)
- Image dimensions should be 2048x2048px if possible

Product: ${productTitle}
Context: ${contextSnippet}
This is the PRIMARY/HERO image - make it clean, professional, and e-commerce ready.`
    : `You are a professional product photographer and image enhancement specialist. Transform this product image into an engaging lifestyle photo.

CRITICAL RULES - NEVER BREAK THESE:
- NEVER change the product itself (color, shape, design, branding, labels, text, features)
- The product must remain EXACTLY as it appears in the original image
- ONLY change the setting, background, props, and context around the product
- Maintain product visibility and focus

ENHANCEMENT INSTRUCTIONS for LIFESTYLE IMAGE:
- Place the product in a realistic, attractive usage context
- Add complementary props or environmental elements that make sense
- Show the product in a natural, aspirational setting
- Maintain clear focus on the product - it should stand out
- Create an authentic lifestyle scene (home, office, outdoor, etc.)
- Ensure good lighting that highlights the product
- Make the scene inviting but not overly busy
- Help customers imagine owning and using this product
- Image dimensions should be 2048x2048px if possible

Product: ${productTitle}
Context: ${contextSnippet}
This is lifestyle image ${imageIndex + 1} of ${totalImages} - create an engaging context while keeping the product unchanged.`;

  const parts = [
    {
      inlineData: {
        mimeType: contentType,
        data: base64Image,
      },
    },
    { text: prompt },
  ];

  // Retry logic for rate limiting
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${GEMINI_IMAGE_API_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            temperature: 0.5, // Lower temperature for more consistent results
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // If rate limited (429) and we have retries left, wait and retry
        if (response.status === 429 && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 3000; // Exponential backoff: 3s, 6s, 12s
          console.log(`Image API rate limited. Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}...`);
          await delay(waitTime);
          continue;
        }

        throw new Error(`Gemini Image Enhancement API error ${response.status}: ${errorText}`);
      }

      const data: any = await response.json();
      const candidates = data?.candidates?.[0]?.content?.parts || [];

      // Find the image part in the response
      for (const part of candidates) {
        if (part.inlineData) {
          // Add delay after successful image generation (images are more expensive)
          await delay(500);
          return {
            base64Data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png",
          };
        }
      }

      throw new Error("No enhanced image was generated by the API");
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      const waitTime = Math.pow(2, attempt) * 2000;
      console.log(`Image generation failed. Retrying in ${waitTime}ms...`);
      await delay(waitTime);
    }
  }

  throw new Error("Failed to generate image after all retries");
}
