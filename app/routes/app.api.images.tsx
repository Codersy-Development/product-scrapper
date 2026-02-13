import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { generateProductImage, generateImageAltText } from "../lib/gemini.server";
import {
  STAGED_UPLOADS_CREATE_MUTATION,
  PRODUCT_CREATE_MEDIA_MUTATION,
} from "../lib/shopify-queries.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = context.cloudflare.env.GEMINI_API_KEY;
  const payload: any = await request.json();

  if (payload.intent === "generate") {
    const { productTitle, existingImageUrl, mode, prompt, negativeWords } = payload;

    try {
      // Generate the image
      const imageResult = await generateProductImage(
        prompt,
        mode === "enhance" ? existingImageUrl : undefined,
        apiKey,
      );

      // Generate SEO alt text
      const altText = await generateImageAltText(
        productTitle,
        prompt,
        negativeWords || [],
        apiKey,
      );

      return Response.json({
        image: {
          base64Data: imageResult.base64Data,
          mimeType: imageResult.mimeType,
          altText,
          prompt,
        },
      });
    } catch (error: any) {
      console.error("Image generation failed:", error);
      return Response.json(
        { error: `Image generation failed: ${error.message}` },
        { status: 500 },
      );
    }
  }

  if (payload.intent === "upload") {
    const { productId, image, uploadedIndex } = payload;

    try {
      // Step 1: Create staged upload target
      const stagedResponse = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
        variables: {
          input: [
            {
              resource: "IMAGE",
              filename: `ai-generated-${Date.now()}.png`,
              mimeType: image.mimeType || "image/png",
              httpMethod: "POST",
            },
          ],
        },
      });
      const stagedData: any = await stagedResponse.json();
      const stagedTarget = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (!stagedTarget) {
        const errors = stagedData.data?.stagedUploadsCreate?.userErrors;
        throw new Error(
          `Failed to create staged upload: ${errors?.map((e: any) => e.message).join(", ") || "Unknown error"}`,
        );
      }

      // Step 2: Upload the image to the staged URL
      const formData = new FormData();
      for (const param of stagedTarget.parameters) {
        formData.append(param.name, param.value);
      }

      // Convert base64 to blob
      const binaryString = atob(image.base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: image.mimeType || "image/png" });
      formData.append("file", blob);

      const uploadResponse = await fetch(stagedTarget.url, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload image: ${uploadResponse.status}`);
      }

      // Step 3: Attach the image to the product
      const mediaResponse = await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
        variables: {
          productId,
          media: [
            {
              originalSource: stagedTarget.resourceUrl,
              alt: image.altText || "",
              mediaContentType: "IMAGE",
            },
          ],
        },
      });
      const mediaData: any = await mediaResponse.json();
      const mediaErrors = mediaData.data?.productCreateMedia?.mediaUserErrors;

      if (mediaErrors?.length > 0) {
        throw new Error(
          `Failed to attach image: ${mediaErrors.map((e: any) => e.message).join(", ")}`,
        );
      }

      return Response.json({ success: true, uploadedIndex });
    } catch (error: any) {
      console.error("Image upload failed:", error);
      return Response.json(
        { error: `Image upload failed: ${error.message}` },
        { status: 500 },
      );
    }
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
};
