-- Link cash-drawer outflows to the existing finance ledger, without duplicating expenses.
ALTER TABLE expenses ADD COLUMN shift_id TEXT REFERENCES shifts(id);
ALTER TABLE expenses ADD COLUMN created_by TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);

-- Linked expenses are fully paid cash outflows by the cashier of an open shift.
CREATE TRIGGER IF NOT EXISTS validate_shift_expense
BEFORE INSERT ON expenses WHEN NEW.shift_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM shifts s WHERE s.id = NEW.shift_id AND s.status = 'open'
      AND s.branch_id = NEW.branch_id AND s.user_id = NEW.created_by
  ) THEN RAISE(ABORT, 'Expense requires your open shift and its branch') END;
  SELECT CASE WHEN typeof(NEW.amount) <> 'integer' OR NEW.amount <= 0
    OR NEW.amount > 9007199254740991 OR NEW.status <> 'paid' OR NEW.amount_paid <> NEW.amount
    OR length(trim(COALESCE(NEW.description, ''))) = 0
    OR length(NEW.description) > 500
    THEN RAISE(ABORT, 'Invalid shift expense amount or description') END;
  SELECT CASE WHEN NEW.amount > (
    SELECT s.initial_cash
      + COALESCE((SELECT SUM(t.total_amount) FROM transactions t
          WHERE t.shift_id = s.id AND t.status = 'completed' AND t.payment_method = 'cash'), 0)
      - COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.shift_id = s.id), 0)
    FROM shifts s WHERE s.id = NEW.shift_id
  ) THEN RAISE(ABORT, 'Insufficient cash in shift drawer') END;
END;

-- Financial postings remain immutable, including after a shift is closed.
CREATE TRIGGER IF NOT EXISTS immutable_shift_expense_update
BEFORE UPDATE ON expenses WHEN OLD.shift_id IS NOT NULL OR NEW.shift_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Shift cash expenses cannot be edited');
END;
CREATE TRIGGER IF NOT EXISTS immutable_shift_expense_delete
BEFORE DELETE ON expenses WHEN OLD.shift_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Shift cash expenses cannot be deleted');
END;

UPDATE schema_version SET version = 15 WHERE id = 1;
