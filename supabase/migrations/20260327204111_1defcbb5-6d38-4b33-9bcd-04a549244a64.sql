
-- Void 72 duplicate vendor invoice JEs (idempotent - only affects 'posted' ones)
UPDATE journal_entries 
SET status = 'void', description = 'VOIDED (duplicate): ' || description
WHERE entry_number IN (
  'VI-10864823','VI-4625191302','VI-6175380','VI-6177123','VI-6196261','VI-6196267',
  'VI-S122069180.001','VI-S122278087.006','VI-S122488502.002','VI-S122658889.002',
  'VI-S122702701.002','VI-S122820603.002','VI-S122823909.001','VI-S122870908.001',
  'VI-S122870908.002','VI-S122923820.001','VI-S122982420.001','VI-S122982499.001',
  'VI-S122996072.001','VI-S122996072.002','VI-S123006773.001','VI-S123020623.003',
  'VI-S123060395.001','VI-S123076847.001','VI-S123081128.001','VI-S3431315.003',
  'VI-S4267344.003','VI-S4301026.002','VI-S4331194.003','VI-S4335835.001',
  'VI-S4338381.001','VI-S4338459.001','VI-S4339071.001','VI-S4339110.001',
  'VI-S4339122.001','VI-S4339140.001','VI-S4339634.001','VI-S4340440.001',
  'VI-S4340948.001','VI-S4341315.001','VI-S4341315.002','VI-S4341315.004',
  'VI-S4341684.001','VI-S4341915.001','VI-S4342047.001','VI-S4342047.002',
  'VI-S4342122.001','VI-S4342671.001','VI-S4342671.002','VI-S4342671.004',
  'VI-S4343152.001','VI-S4343333.001','VI-S4343394.001','VI-S4343800.001',
  'VI-S4343800.002','VI-S4344041.001','VI-S4344285.001','VI-S4345205.001',
  'VI-S4345703.001','VI-S4345705.001','VI-S4345712.001','VI-S4345802.001',
  'VI-S4345803.001','VI-S4346453.001','VI-S4346574.001','VI-S4346602.001',
  'VI-S4347205.001','VI-S4347207.001','VI-S4347209.001','VI-S4347441.001'
)
AND status = 'posted';

-- Rename GL 4000 to "Service Revenue"
UPDATE gl_accounts SET name = 'Service Revenue' WHERE account_number = '4000';

-- Deactivate GL 4100
UPDATE gl_accounts SET active = false WHERE account_number = '4100';

-- Set OB entry to draft for editing
UPDATE journal_entries SET status = 'draft' WHERE entry_number = 'OB-2026-03-31';

-- Move OB revenue line from 4100 to 4000 and set correct amount
UPDATE journal_entry_lines 
SET account_id = (SELECT id FROM gl_accounts WHERE account_number = '4000'),
    credit = 359637.63
WHERE journal_entry_id = (SELECT id FROM journal_entries WHERE entry_number = 'OB-2026-03-31')
  AND account_id = (SELECT id FROM gl_accounts WHERE account_number = '4100');

-- Update Retained Earnings to 1992191.77
UPDATE journal_entry_lines 
SET credit = 1992191.77
WHERE journal_entry_id = (SELECT id FROM journal_entries WHERE entry_number = 'OB-2026-03-31')
  AND account_id = (SELECT id FROM gl_accounts WHERE account_number = '3100');

-- Update Charitable Contributions to 8013.99
UPDATE journal_entry_lines 
SET debit = 8013.99
WHERE journal_entry_id = (SELECT id FROM journal_entries WHERE entry_number = 'OB-2026-03-31')
  AND account_id = (SELECT id FROM gl_accounts WHERE account_number = '7200');

-- Re-post the OB entry
UPDATE journal_entries SET status = 'posted' WHERE entry_number = 'OB-2026-03-31';
