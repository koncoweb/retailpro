-- ---------------------------------------------------------------------------
-- RetailPro tenant seed (libSQL / SQLite)
--
-- Rendered at provisioning time: every double-brace token below is substituted
-- by server/provision.ts (see renderSeed()). A token renders to an
-- already-quoted, already-escaped SQL literal, so never wrap one in quotes
-- here. Keep this header free of literal token syntax too — renderSeed()
-- rejects unknown tokens, comments included.
--
-- Idempotent: every statement is INSERT OR IGNORE, so re-running is safe.
-- ---------------------------------------------------------------------------

-- Schema version marker (read by scripts/apply-schema-all.mjs)
INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 3);

-- Company profile. `settings` is JSON text; role_permissions mirrors
-- src/config/roles.ts DEFAULT_ROLE_PERMISSIONS so the UI and the DB agree.
INSERT OR IGNORE INTO tenants (id, name, slug, settings)
VALUES (
  {{TENANT_ID}},
  {{TENANT_NAME}},
  {{TENANT_SLUG}},
  '{"role_permissions":{"platform_owner":{"view_dashboard":true,"view_analytics":true,"access_pos":true,"apply_discount":true,"void_transaction":true,"view_inventory":true,"add_stock":true,"transfer_stock":true,"stock_opname":true,"view_employees":true,"add_employee":true,"edit_employee":true,"delete_employee":true,"view_reports":true,"export_reports":true,"view_settings":true,"edit_settings":true,"manage_roles":true},"tenant_owner":{"view_dashboard":true,"view_analytics":true,"access_pos":true,"apply_discount":true,"void_transaction":true,"view_inventory":true,"add_stock":true,"transfer_stock":true,"stock_opname":true,"view_employees":true,"add_employee":true,"edit_employee":true,"delete_employee":true,"view_reports":true,"export_reports":true,"view_settings":true,"edit_settings":true,"manage_roles":true},"tenant_admin":{"view_dashboard":true,"view_analytics":true,"access_pos":true,"apply_discount":true,"void_transaction":true,"view_inventory":true,"add_stock":true,"transfer_stock":true,"stock_opname":true,"view_employees":true,"add_employee":true,"edit_employee":true,"delete_employee":true,"view_reports":true,"export_reports":true,"view_settings":true,"edit_settings":true,"manage_roles":true},"store_manager":{"view_dashboard":true,"view_analytics":true,"access_pos":true,"apply_discount":true,"view_inventory":true,"add_stock":true,"transfer_stock":true,"view_employees":true,"view_reports":true,"export_reports":true},"cashier":{"view_dashboard":true,"access_pos":true,"apply_discount":false},"warehouse":{"view_inventory":true,"add_stock":true,"transfer_stock":true,"stock_opname":true},"staff":{}},"payroll_config":{"overtime_rate":1.5,"work_hours_per_day":8,"work_days_per_month":22},"receipt":{"footer":"Terima kasih atas kunjungan Anda","show_logo":true},"inventory":{"stock_issue_method":"fifo"},"tax":{"enabled":false,"rate":0},"bank":{"name":"","account_number":"","account_holder":""}}'
);

-- Main branch created for every new tenant: the head office / first store.
INSERT OR IGNORE INTO branches (id, name, address, phone, status, type, is_headquarters)
VALUES ({{BRANCH_ID}}, {{BRANCH_NAME}}, {{BRANCH_ADDRESS}}, '', 'active', 'store', 1);

-- Its stockroom. Default shape of a new tenant is 1 branch + 1 warehouse; the
-- tenant can add branches that share this warehouse, or create more of them.
INSERT OR IGNORE INTO warehouses (id, name, code, type, branch_id, status, is_default)
VALUES ({{WAREHOUSE_ID}}, {{WAREHOUSE_NAME}}, 'WH-01', 'store', {{BRANCH_ID}}, 'active', 1);

INSERT OR IGNORE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
VALUES ({{BRANCH_ID}}, {{WAREHOUSE_ID}}, 1, 1);

-- Owner mirror row: `users.id` equals the Better Auth user id.
INSERT OR IGNORE INTO users (id, email, name, role, assigned_branch_id, is_active)
VALUES ({{OWNER_ID}}, {{OWNER_EMAIL}}, {{OWNER_NAME}}, 'tenant_owner', {{BRANCH_ID}}, 1);

-- Starter categories (AddProductModal reads this table).
INSERT OR IGNORE INTO categories (id, name) VALUES
  ({{CATEGORY_1_ID}}, 'Minuman'),
  ({{CATEGORY_2_ID}}, 'Makanan'),
  ({{CATEGORY_3_ID}}, 'Sembako'),
  ({{CATEGORY_4_ID}}, 'Kebutuhan Rumah'),
  ({{CATEGORY_5_ID}}, 'Lainnya');
