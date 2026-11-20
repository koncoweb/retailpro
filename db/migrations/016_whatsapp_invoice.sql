-- ---------------------------------------------------------------------------
-- 016 — WhatsApp invoice delivery + GOWA webhook receipts
--
-- Runs once against a tenant database still on schema version 15.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version; the whatsapp_events log
-- (new table, control plane only) lives in db/schema/control.sql, which is
-- idempotent and re-applied by scripts/bootstrap-control.mjs --reuse.
--
-- Invariant after this migration:
--   * the `wa_*` columns on `storefront_orders` record the GOWA invoice send
--     for the row: `wa_status` is NULL until a send is attempted, then
--     'sent' | 'failed' | 'skipped'; `wa_message_id` is the WhatsApp message id
--     the delivery webhook (message.ack) is matched on. They are delivery
--     metadata ONLY — order state remains the `status` column, so a failed
--     WhatsApp send never changes or blocks the money path;
--   * `wa_ack` mirrors the strongest receipt GOWA reported for that message
--     ('delivered' | 'read'), pushed by the public webhook, never by the shop.
--
-- SQLite ADD COLUMN is all-or-nothing per statement; the version gate keeps
-- this file from ever running twice.
-- ---------------------------------------------------------------------------

ALTER TABLE storefront_orders ADD COLUMN wa_status    TEXT;
ALTER TABLE storefront_orders ADD COLUMN wa_message_id TEXT;
ALTER TABLE storefront_orders ADD COLUMN wa_sent_at   TEXT;
ALTER TABLE storefront_orders ADD COLUMN wa_ack       TEXT;
ALTER TABLE storefront_orders ADD COLUMN wa_error     TEXT;

-- Webhook lookups arrive keyed by the WhatsApp message id.
CREATE INDEX IF NOT EXISTS idx_sf_orders_wa_msg ON storefront_orders(wa_message_id) WHERE wa_message_id IS NOT NULL;

UPDATE schema_version SET version = 16 WHERE id = 1;
