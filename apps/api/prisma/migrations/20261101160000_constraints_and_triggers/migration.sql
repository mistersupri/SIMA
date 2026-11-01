-- Aturan integritas yang tidak dapat diekspresikan Prisma.

-- Email selalu huruf kecil agar unique constraint bermakna.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- Saldo dan ledger stok tidak boleh negatif (lapis terakhir setelah validasi service).
ALTER TABLE "stock_balances"
  ADD CONSTRAINT "stock_balances_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "stock_transaction_details"
  ADD CONSTRAINT "stock_tx_details_amounts_valid" CHECK (
    "quantityIn" >= 0 AND "quantityOut" >= 0 AND "balanceAfter" >= 0
    AND NOT ("quantityIn" > 0 AND "quantityOut" > 0)
  );
ALTER TABLE "items" ADD CONSTRAINT "items_min_stock_non_negative" CHECK ("minStock" >= 0);
ALTER TABLE "assets" ADD CONSTRAINT "assets_cost_non_negative" CHECK ("acquisitionCost" >= 0);
ALTER TABLE "procurement_details"
  ADD CONSTRAINT "procurement_details_amounts_valid" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "receivedQty" >= 0);
ALTER TABLE "goods_receipt_details"
  ADD CONSTRAINT "goods_receipt_details_qty_positive" CHECK ("quantityReceived" > 0);

-- Satu aset hanya boleh berada di satu pinjaman yang masih terbuka (anti pinjam ganda).
CREATE UNIQUE INDEX "loan_details_one_open_loan_per_asset"
  ON "loan_details" ("assetId") WHERE "isOpen";

-- Tabel append-only: ledger, histori, dan log tidak dapat diubah atau dihapus.
CREATE FUNCTION sima_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Operasi % pada tabel % tidak diizinkan (append-only)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION sima_prevent_mutation();
CREATE TRIGGER "activity_logs_append_only" BEFORE UPDATE OR DELETE ON "activity_logs"
  FOR EACH ROW EXECUTE FUNCTION sima_prevent_mutation();
CREATE TRIGGER "stock_transactions_append_only" BEFORE UPDATE OR DELETE ON "stock_transactions"
  FOR EACH ROW EXECUTE FUNCTION sima_prevent_mutation();
CREATE TRIGGER "stock_transaction_details_append_only" BEFORE UPDATE OR DELETE ON "stock_transaction_details"
  FOR EACH ROW EXECUTE FUNCTION sima_prevent_mutation();
CREATE TRIGGER "asset_location_histories_append_only" BEFORE UPDATE OR DELETE ON "asset_location_histories"
  FOR EACH ROW EXECUTE FUNCTION sima_prevent_mutation();
CREATE TRIGGER "asset_condition_histories_append_only" BEFORE UPDATE OR DELETE ON "asset_condition_histories"
  FOR EACH ROW EXECUTE FUNCTION sima_prevent_mutation();
CREATE TRIGGER "approval_actions_append_only" BEFORE UPDATE OR DELETE ON "approval_actions"
  FOR EACH ROW EXECUTE FUNCTION sima_prevent_mutation();
