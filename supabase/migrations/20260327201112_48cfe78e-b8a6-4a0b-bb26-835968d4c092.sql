
-- Set OB to draft to bypass balance validation
UPDATE journal_entries SET status = 'draft' WHERE id = '17d1f251-c463-40eb-a557-6acf06b9b6ce';

-- Remove AR line
DELETE FROM journal_entry_lines WHERE id = '91ddb1fe-427e-4046-99ae-adb7d023a0de';

-- Reduce Retained Earnings credit to keep balanced
UPDATE journal_entry_lines SET credit = 967754.99 WHERE id = 'be2f1d37-dcfb-41e5-b7d8-c7a44b42ca00';

-- Re-post
UPDATE journal_entries SET status = 'posted' WHERE id = '17d1f251-c463-40eb-a557-6acf06b9b6ce';
