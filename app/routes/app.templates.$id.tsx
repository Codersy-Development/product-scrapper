import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { PromptTemplate } from "../lib/types";

export const loader = async ({ request, params, context }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  const template = await db
    .prepare("SELECT * FROM prompt_templates WHERE id = ? AND shop = ?")
    .bind(params.id, session.shop)
    .first();

  if (!template) {
    throw new Response("Template not found", { status: 404 });
  }

  return { template: template as unknown as PromptTemplate };
};

export const action = async ({ request, params, context }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "update") {
    const name = formData.get("name") as string;
    const titlePrompt = formData.get("title_prompt") as string;
    const descriptionPrompt = formData.get("description_prompt") as string;

    if (!name?.trim()) {
      return { error: "Template name is required" };
    }

    await db
      .prepare(
        "UPDATE prompt_templates SET name = ?, title_prompt = ?, description_prompt = ?, updated_at = unixepoch() WHERE id = ? AND shop = ?",
      )
      .bind(name.trim(), titlePrompt || "", descriptionPrompt || "", params.id, session.shop)
      .run();

    return { success: true };
  }

  if (intent === "delete") {
    await db
      .prepare("DELETE FROM prompt_templates WHERE id = ? AND shop = ?")
      .bind(params.id, session.shop)
      .run();
    return { success: true, deleted: true };
  }

  return { error: "Unknown action" };
};

export default function EditTemplate() {
  const { template } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [name, setName] = useState(template.name);
  const [titlePrompt, setTitlePrompt] = useState(template.title_prompt);
  const [descriptionPrompt, setDescriptionPrompt] = useState(template.description_prompt);

  const isSubmitting = fetcher.state !== "idle";

  const handleSave = () => {
    fetcher.submit(
      { intent: "update", name, title_prompt: titlePrompt, description_prompt: descriptionPrompt },
      { method: "POST" },
    );
    shopify.toast.show("Template saved");
  };

  const handleDelete = () => {
    fetcher.submit({ intent: "delete" }, { method: "POST" });
    shopify.toast.show("Template deleted");
    navigate("/app/templates");
  };

  return (
    <s-page heading={`Edit Template: ${template.name}`}>
      <s-button slot="primary-action" onClick={handleSave} {...(isSubmitting ? { loading: true } : {})}>
        Save Changes
      </s-button>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Template Name"
            value={name}
            onInput={(e: any) => setName(e.target.value)}
          />
          <s-text-field
            label="Title Optimization Prompt"
            value={titlePrompt}
            onInput={(e: any) => setTitlePrompt(e.target.value)}
            multiline
            placeholder="Instructions for how the AI should optimize product titles..."
          />
          <s-text-field
            label="Description Optimization Prompt"
            value={descriptionPrompt}
            onInput={(e: any) => setDescriptionPrompt(e.target.value)}
            multiline
            placeholder="Instructions for how the AI should optimize product descriptions..."
          />
        </s-stack>
      </s-section>

      <s-section heading="Danger Zone">
        <s-stack direction="inline" gap="base">
          <s-button onClick={() => navigate("/app/templates")} variant="tertiary">
            Back to Templates
          </s-button>
          <s-button variant="tertiary" tone="critical" onClick={handleDelete}>
            Delete Template
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
