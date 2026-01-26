import { openDatabase } from './db.js';

export function logWalletOperation(params: {
  operation: 'sign' | 'submit' | 'confirm' | 'reject' | 'paper';
  toAddress?: string;
  amount?: number;
  transactionHash?: string;
  status?: 'pending' | 'confirmed' | 'failed' | 'rejected';
  reason?: string;
  metadata?: Record<string, unknown>;
}): void {
  const db = openDatabase();
  const stmt = db.prepare(`
    INSERT INTO wallet_audit_log (
      operation,
      to_address,
      amount,
      transaction_hash,
      status,
      reason,
      metadata
    ) VALUES (
      @operation,
      @toAddress,
      @amount,
      @transactionHash,
      @status,
      @reason,
      @metadata
    )
  `);

  stmt.run({
    operation: params.operation,
    toAddress: params.toAddress ?? null,
    amount: params.amount ?? null,
    transactionHash: params.transactionHash ?? null,
    status: params.status ?? null,
    reason: params.reason ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}
