import * as Sentry from "@sentry/nextjs";

// Sync failure telemetry (sprints.md Sprint 6: "sync failures and
// conflicts are captured in monitoring with tenant-safe identifiers").
// Stock conflicts themselves are already captured and queryable via the
// stock_conflicts table and /conflicts owner-review UI — this module
// covers the failure mode that has no other visibility: a local write
// PowerSync permanently drops from its upload queue (lib/sync/connector.ts).
//
// Tenant-safe means: operation_id, device_id, table name, error code and
// message only — never the queued row's own JSON payload (product names,
// prices, customer names all live in there) and never a raw exception
// object that might carry more than intended (lib/observability/README.md).
export function reportSyncUploadFailure(params: {
  table: string;
  operationId?: string;
  deviceId?: string;
  errorCode?: string;
  errorMessage: string;
  permanent: boolean;
}) {
  Sentry.captureMessage(
    `PowerSync upload ${params.permanent ? "permanently failed" : "failed, will retry"}: ${params.table}`,
    {
      level: params.permanent ? "error" : "warning",
      tags: {
        sync_table: params.table,
        sync_permanent_failure: params.permanent,
        sync_error_code: params.errorCode ?? "unknown",
      },
      extra: {
        operationId: params.operationId,
        deviceId: params.deviceId,
        errorMessage: params.errorMessage,
      },
    },
  );
}
