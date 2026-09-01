import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/auth/supabase-server";
import { extractLedgerPhoto, isAiConfigured } from "@/lib/integrations/anthropic";

// Extracts a draft only — never creates a product or stock_movements
// row (CLAUDE.md rule 6). Only stockflow_confirm_ocr_draft
// (lib/db/migrations/0019...), invoked by an explicit owner/manager
// action, creates real records.
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
      { error: "AI is not configured. Add products manually via /products/new." },
      { status: 503 },
    );
  }

  const body = await req.json();
  const { imageBase64, mediaType, branchId, deviceId } = body as {
    imageBase64?: string;
    mediaType?: string;
    branchId?: string;
    deviceId?: string;
  };
  if (!imageBase64 || !mediaType || !branchId || !deviceId) {
    return NextResponse.json({ error: "imageBase64, mediaType, branchId and deviceId are required" }, { status: 400 });
  }

  const result = await extractLedgerPhoto(imageBase64, mediaType);
  if (!result.extracted) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === "not-configured" ? 503 : 502 });
  }

  const { data: draft, error } = await supabase
    .from("ocr_drafts")
    .insert({
      tenant_id: staffUser.tenant_id,
      branch_id: branchId,
      uploaded_by: user.id,
      device_id: deviceId,
      extracted_lines: result.draft.lines,
      extraction_notes: result.draft.notes,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ draftId: draft.id, lines: result.draft.lines, notes: result.draft.notes });
}
