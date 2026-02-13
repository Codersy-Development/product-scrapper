import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { PromptTemplate } from "../lib/types";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;

  const result = await db
    .prepare("SELECT * FROM prompt_templates WHERE shop = ? ORDER BY updated_at DESC")
    .bind(session.shop)
    .all();

  return { templates: result.results as unknown as PromptTemplate[] };
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const db = context.cloudflare.env.DB;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = formData.get("name") as string;
    const titlePrompt = formData.get("title_prompt") as string;
    const descriptionPrompt = formData.get("description_prompt") as string;

    if (!name?.trim()) {
      return { error: "Template name is required" };
    }

    const result = await db
      .prepare(
        "INSERT INTO prompt_templates (shop, name, title_prompt, description_prompt) VALUES (?, ?, ?, ?)",
      )
      .bind(session.shop, name.trim(), titlePrompt || "", descriptionPrompt || "")
      .run();

    return { success: true, id: result.meta.last_row_id };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await db
      .prepare("DELETE FROM prompt_templates WHERE id = ? AND shop = ?")
      .bind(id, session.shop)
      .run();
    return { success: true };
  }

  return { error: "Unknown action" };
};

export default function Templates() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [titlePrompt, setTitlePrompt] = useState("");
  const [descriptionPrompt, setDescriptionPrompt] = useState("");

  const isSubmitting = fetcher.state !== "idle";

  const handleCreate = () => {
    fetcher.submit(
      { intent: "create", name, title_prompt: titlePrompt, description_prompt: descriptionPrompt },
      { method: "POST" },
    );
    setShowCreate(false);
    setName("");
    setTitlePrompt("");
    setDescriptionPrompt("");
    shopify.toast.show("Template created");
  };

  const handleDelete = (id: number) => {
    fetcher.submit({ intent: "delete", id: String(id) }, { method: "POST" });
    shopify.toast.show("Template deleted");
  };

  return (
    <s-page heading="Prompt Templates">
      <s-button slot="primary-action" onClick={() => setShowCreate(!showCreate)}>
        {showCreate ? "Cancel" : "Create Template"}
      </s-button>

      {showCreate && (
        <s-section heading="New Template">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Template Name"
              value={name}
              onChange={(e: any) => setName(e.target.value)}
              placeholder="e.g., General Store SEO"
            />

            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "600" }}>
                Title Optimization Prompt
              </label>
              <textarea
                value={titlePrompt}
                onChange={(e) => setTitlePrompt(e.target.value)}
                placeholder="e.g., Generate ONE high-converting, keyword-optimized, Google-compliant product title for a general store..."
                rows={6}
                style={{
                  width: "100%",
                  padding: "8px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  resize: "vertical"
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "600" }}>
                Description Optimization Prompt
              </label>
              <textarea
                value={descriptionPrompt}
                onChange={(e) => setDescriptionPrompt(e.target.value)}
                placeholder="e.g., Write a compelling, SEO-optimized product description with HTML formatting..."
                rows={6}
                style={{
                  width: "100%",
                  padding: "8px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  resize: "vertical"
                }}
              />
            </div>

            <s-button onClick={handleCreate} variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Save Template
            </s-button>
          </s-stack>
        </s-section>
      )}

      {templates.length === 0 && !showCreate ? (
        <s-section>
          <s-box padding="extraLoose" style={{ textAlign: "center" }}>
            <s-stack direction="block" gap="base" align="center">
              <s-heading>No templates yet</s-heading>
              <s-paragraph>
                Create prompt templates to use when importing and optimizing products.
                Templates help you maintain consistent AI-generated content across batches.
              </s-paragraph>
              <s-button onClick={() => setShowCreate(true)} variant="primary">
                Create your first template
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        templates.map((template) => (
          <s-section key={template.id} heading={template.name}>
            <s-stack direction="block" gap="tight">
              {template.title_prompt && (
                <div>
                  <s-text fontWeight="semibold">Title Prompt:</s-text>
                  <s-paragraph>
                    {template.title_prompt.length > 150
                      ? template.title_prompt.substring(0, 150) + "..."
                      : template.title_prompt}
                  </s-paragraph>
                </div>
              )}
              {template.description_prompt && (
                <div>
                  <s-text fontWeight="semibold">Description Prompt:</s-text>
                  <s-paragraph>
                    {template.description_prompt.length > 150
                      ? template.description_prompt.substring(0, 150) + "..."
                      : template.description_prompt}
                  </s-paragraph>
                </div>
              )}
              <s-stack direction="inline" gap="tight">
                <Link to={`/app/templates/${template.id}`}>
                  <s-button variant="tertiary">Edit</s-button>
                </Link>
                <s-button
                  variant="tertiary"
                  tone="critical"
                  onClick={() => handleDelete(template.id)}
                >
                  Delete
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        ))
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
