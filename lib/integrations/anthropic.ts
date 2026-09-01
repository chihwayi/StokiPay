import Anthropic from "@anthropic-ai/sdk";

// Anthropic API adapter (docs/architecture.md's locked stack: "AI |
// Anthropic API behind tenant-scoped, read-only server tools"). No API
// key was available this sprint (docs/handoffs/sprint-7.md, owner's
// explicit decision) — every export here returns a clear "not
// configured" result rather than pretending to call a real model,
// mirroring lib/integrations/sms.ts and lib/integrations/paynow.ts's
// dev-fallback pattern. AI is additive only: every manual onboarding
// and POS/stock flow built in Sprints 1-6 works identically whether or
// not this file ever calls a real API (CLAUDE.md rule 6).

const MODEL = "claude-sonnet-5";

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type LedgerExtractionDraft = {
  lines: { productName: string; quantity: number | null; unitPriceMinor: number | null; confidence: "high" | "medium" | "low" }[];
  notes: string | null;
};

export type LedgerExtractionResult =
  | { extracted: true; draft: LedgerExtractionDraft }
  | { extracted: false; reason: "not-configured" | "extraction-failed" };

// Extracts a *draft* product/quantity/price list from a photo of a
// handwritten ledger page. Never writes anything — the caller
// (app/api/ai/extract-ledger-photo/route.ts) only ever inserts an
// ocr_drafts row with status='draft'; a real product/stock record is
// created solely by stockflow_confirm_ocr_draft (lib/db/migrations/
// 0018...), which requires an explicit owner/manager action per line.
export async function extractLedgerPhoto(imageBase64: string, mediaType: string): Promise<LedgerExtractionResult> {
  const client = getClient();
  if (!client) return { extracted: false, reason: "not-configured" };

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 },
            },
            {
              type: "text",
              text: [
                "This is a photo of a handwritten stock/sales ledger page from a Zimbabwean small shop.",
                "Extract each line item as JSON only, matching this exact shape (no prose, no markdown fences):",
                '{"lines":[{"productName":"string","quantity":number|null,"unitPriceMinor":number|null,"confidence":"high"|"medium"|"low"}],"notes":"string|null"}',
                "unitPriceMinor is the price in integer minor currency units (e.g. cents) if legible, otherwise null.",
                "Use \"low\" confidence for anything genuinely hard to read rather than guessing with false confidence.",
              ].join("\n"),
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as LedgerExtractionDraft;
    return { extracted: true, draft: parsed };
  } catch {
    return { extracted: false, reason: "extraction-failed" };
  }
}

export type CopilotToolDefinition = {
  name: string;
  description: string;
  input_schema: Anthropic.Messages.Tool["input_schema"];
};

export type CopilotResult =
  | { answered: true; text: string; toolCalls: { name: string; input: unknown }[] }
  | { answered: false; reason: "not-configured" | "answer-failed" };

// Runs a single-turn tool-use loop: the model may call any of the
// supplied (already tenant-scoped, read-only — see
// lib/ai/copilot-tools.ts) tools, we execute them and feed results
// back, and return the final text answer plus a record of every tool
// call actually made (so the UI can show what was queried, and tests
// can assert no unexpected tool was reachable).
export async function askCopilot(
  question: string,
  tools: CopilotToolDefinition[],
  executeTool: (name: string, input: unknown) => Promise<unknown>,
): Promise<CopilotResult> {
  const client = getClient();
  if (!client) return { answered: false, reason: "not-configured" };

  try {
    const toolCalls: { name: string; input: unknown }[] = [];
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: "user",
        content: `${question}\n\nAlways cite the exact date range and figures you used to answer.`,
      },
    ];

    for (let turn = 0; turn < 4; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        tools,
        messages,
      });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      if (toolUseBlocks.length === 0) {
        const text = response.content.find((b) => b.type === "text")?.text ?? "";
        return { answered: true, text, toolCalls };
      }

      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        toolCalls.push({ name: block.name, input: block.input });
        const result = await executeTool(block.name, block.input);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return { answered: false, reason: "answer-failed" };
  } catch {
    return { answered: false, reason: "answer-failed" };
  }
}
