import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/auth/supabase-server";
import { askCopilot, isAiConfigured } from "@/lib/integrations/anthropic";
import { COPILOT_TOOL_DEFINITIONS, executeCopilotTool } from "@/lib/ai/copilot-tools";

// The tenant scope for every tool call this request can trigger comes
// only from this route's own session lookup below (staffUser.tenant_id)
// — see lib/ai/copilot-tools.ts's header comment for why that's the
// property that makes cross-tenant access structurally impossible, not
// just unlikely.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured. Use /reports for figures manually." },
      { status: 503 },
    );
  }

  const body = await req.json();
  const { question } = body as { question?: string };
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const tenantId = staffUser.tenant_id;
  const result = await askCopilot(question, COPILOT_TOOL_DEFINITIONS, (name, input) =>
    executeCopilotTool({ supabase, tenantId }, name, input),
  );

  if (!result.answered) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "not-configured" ? 503 : 502 });
  }

  return NextResponse.json({ text: result.text, toolCalls: result.toolCalls });
}
