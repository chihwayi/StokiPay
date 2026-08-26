import { NextResponse } from "next/server";

// Liveness check only — no database secrets or connection details in the
// response, per docs/runbooks/coolify-deployment.md.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
