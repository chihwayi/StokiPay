// Client-generated operation_id primitive per
// docs/adr/0003-operation-idempotency-contract.md. Business write paths
// (sales, stock movements, cash-up, payments) call this once, at the moment
// the user commits the action, and carry the same id through offline queue
// and sync.
export function createOperationId(): string {
  return crypto.randomUUID();
}

export function isOperationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
