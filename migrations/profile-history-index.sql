-- Run as a standalone statement on PostgreSQL after checking production query plans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS kekip_game_results_history_order
ON kekip_game_results(account_id,created_at DESC,game DESC,md5(match_id) DESC);
