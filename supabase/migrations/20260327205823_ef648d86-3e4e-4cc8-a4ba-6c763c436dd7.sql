
-- Fix: For entry_numbers that have multiple JEs, void the OLDEST (bad comma import)
-- and keep the NEWEST (correct amounts) posted
-- Step 1: Void originals (earliest created_at) that are currently posted
UPDATE journal_entries 
SET status = 'void', description = 'VOIDED (bad comma amounts): ' || description
WHERE id IN (
  SELECT DISTINCT ON (entry_number) id
  FROM journal_entries
  WHERE entry_number LIKE 'VI-%' AND status = 'posted'
    AND entry_number IN (
      SELECT entry_number FROM journal_entries 
      WHERE entry_number LIKE 'VI-%'
      GROUP BY entry_number HAVING COUNT(*) > 1
    )
  ORDER BY entry_number, created_at ASC
);

-- Step 2: Un-void duplicates (latest created_at) - these have correct amounts
UPDATE journal_entries 
SET status = 'posted', 
    description = REPLACE(REPLACE(REPLACE(description, 'VOIDED (duplicate): ', ''), 'VOIDED (duplicate from bad import): ', ''), 'VOIDED (bad comma amounts): ', '')
WHERE id IN (
  SELECT DISTINCT ON (entry_number) id
  FROM journal_entries
  WHERE entry_number LIKE 'VI-%' AND status = 'void'
    AND entry_number IN (
      SELECT entry_number FROM journal_entries 
      WHERE entry_number LIKE 'VI-%' AND status = 'void'
      GROUP BY entry_number HAVING COUNT(*) > 1
    )
  ORDER BY entry_number, created_at DESC
);

-- Step 3: Delete duplicate vendor_invoice record for S122996072.002
-- Keep the first one, delete later duplicates
DELETE FROM vendor_invoices 
WHERE invoice_no = 'S122996072.002' 
  AND id != (
    SELECT id FROM vendor_invoices 
    WHERE invoice_no = 'S122996072.002' 
    ORDER BY created_at ASC LIMIT 1
  );

-- Step 4: Add back the missing $53.39 invoice with unique number
INSERT INTO vendor_invoices (invoice_no, vendor_id, amount, date, status)
SELECT 'S122996072.002b', vendor_id, 53.39, '2026-03-31', 'open'
FROM vendor_invoices WHERE invoice_no = 'S122996072.002' LIMIT 1
ON CONFLICT DO NOTHING;
