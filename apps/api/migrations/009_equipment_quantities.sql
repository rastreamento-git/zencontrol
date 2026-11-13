-- Additional installations may repeat the same equipment type. Existing IDs,
-- evidence, stock receipts and financial entries are preserved unchanged.
-- Migration 008 may have queued deferred parent-link checks in this transaction.
SET CONSTRAINTS zc_orders_parent_order_id_fkey IMMEDIATE;
DROP INDEX IF EXISTS zc_additional_order_type;
CREATE INDEX IF NOT EXISTS zc_orders_parent ON zc_orders(parent_order_id) WHERE parent_order_id IS NOT NULL;
SET CONSTRAINTS zc_orders_parent_order_id_fkey DEFERRED;
