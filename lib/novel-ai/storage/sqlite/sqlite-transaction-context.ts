import crypto from "crypto";
import type { ExtractionPersistenceRows, TransactionContext } from "../types";
import type { SQLiteStoryBibleStorageAdapter } from "./sqlite-adapter";

export class SQLiteTransactionContext implements TransactionContext {
  readonly transactionId = `sqlite_tx_${crypto.randomUUID()}`;
  readonly extractionPersistence: TransactionContext["extractionPersistence"];

  constructor(adapter: SQLiteStoryBibleStorageAdapter) {
    this.extractionPersistence = {
      persistRows: (rows: ExtractionPersistenceRows) => adapter.persistExtractionRows(rows),
    };
  }
}
