import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { optimizeProducts } from "../lib/gemini.server";
import type { ScrapedProduct } from "../lib/types";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;
  const apiKey = context.cloudflare.env.GEMINI_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
  }

  const payload = await request.json();
  const {
    products,
    titleTemplateId,
    descriptionTemplateId,
    optimizeAltText = true,
  } = payload as {
    products: ScrapedProduct[];
    titleTemplateId?: number;
    descriptionTemplateId?: number;
    optimizeAltText?: boolean;
  };

  // Load templates
  let titlePrompt: string | null = null;
  let descriptionPrompt: string | null = null;

  if (titleTemplateId) {
    const template = await db
      .prepare("SELECT title_prompt FROM prompt_templates WHERE id = ? AND shop = ?")
      .bind(titleTemplateId, session.shop)
      .first();
    if (template) titlePrompt = template.title_prompt as string;
  }

  if (descriptionTemplateId) {
    const template = await db
      .prepare("SELECT description_prompt FROM prompt_templates WHERE id = ? AND shop = ?")
      .bind(descriptionTemplateId, session.shop)
      .first();
    if (template) descriptionPrompt = template.description_prompt as string;
  }

  // Load negative words
  const negativeWordsResult = await db
    .prepare("SELECT word FROM negative_words WHERE shop = ?")
    .bind(session.shop)
    .all();
  const negativeWords = negativeWordsResult.results.map((r) => r.word as string);

  const result = await optimizeProducts(
    products,
    titlePrompt,
    descriptionPrompt,
    negativeWords,
    apiKey,
    optimizeAltText,
  );

  return Response.json(result);
};
