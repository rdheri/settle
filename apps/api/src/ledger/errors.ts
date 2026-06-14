/**
 * Domain errors carry the HTTP status + stable error code so the HTTP layer can
 * translate them uniformly without leaking SQL details.
 */
export class LedgerError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Bad input: unbalanced entries, non-positive amounts, unknown account, etc. */
export class ValidationError extends LedgerError {
  constructor(message: string) {
    super(message, 'validation_error', 422);
  }
}

/** A non-negative balance rule would be violated by this write. */
export class InsufficientFundsError extends LedgerError {
  constructor(accountId: string, accountName: string, resultingBalance: number) {
    super(
      `account "${accountName}" (${accountId}) would go negative: resulting balance ${resultingBalance}`,
      'insufficient_funds',
      422,
    );
  }
}

export class NotFoundError extends LedgerError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, 'not_found', 404);
  }
}
