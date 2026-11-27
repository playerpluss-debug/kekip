DO $migration$
BEGIN
  PERFORM pg_advisory_xact_lock(91342, 1);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='kekip_presence'::regclass AND conname='kekip_presence_activity_late_answer_check') THEN
    ALTER TABLE kekip_presence ADD CONSTRAINT kekip_presence_activity_late_answer_check CHECK (activity IN ('home','battleship','football','late_answer'));
    ALTER TABLE kekip_presence DROP CONSTRAINT IF EXISTS kekip_presence_activity_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='kekip_social_invites'::regclass AND conname='kekip_social_invites_game_late_answer_check') THEN
    ALTER TABLE kekip_social_invites ADD CONSTRAINT kekip_social_invites_game_late_answer_check CHECK (game IN ('battleship','football','late_answer'));
    ALTER TABLE kekip_social_invites DROP CONSTRAINT IF EXISTS kekip_social_invites_game_check;
  END IF;
END;
$migration$;
CREATE INDEX IF NOT EXISTS kekip_late_answer_account_date ON kekip_game_results(account_id, created_at) WHERE game='late_answer';
