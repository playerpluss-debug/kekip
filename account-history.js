'use strict';
const kinds=['register','login','logout','password-change','admin-block','admin-unblock','admin-reset','admin-revoke-sessions'];
async function ensureAccountHistory(db){
 await db.query(`CREATE TABLE IF NOT EXISTS kekip_account_events(
  id bigserial PRIMARY KEY,
  account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('register','login','logout','password-change','admin-block','admin-unblock','admin-reset','admin-revoke-sessions')),
  created_at timestamptz NOT NULL DEFAULT now()
 )`);
 await db.query('CREATE INDEX IF NOT EXISTS kekip_account_events_recent ON kekip_account_events(account_id,id DESC)');
}
async function recordAccountEvent(db,id,kind){
 if(!kinds.includes(kind))throw Error('Invalid account event');
 await db.query('INSERT INTO kekip_account_events(account_id,kind) VALUES($1,$2)',[id,kind]);
}
async function logoutWithHistory(db,sessionHash){
 await db.query(`WITH revoked AS (
  DELETE FROM kekip_football_sessions WHERE token_hash=$1 RETURNING account_id
 )
 INSERT INTO kekip_account_events(account_id,kind) SELECT account_id,'logout' FROM revoked`,[sessionHash]);
}
async function readAccountHistory(db,account){
 const q=await db.query('SELECT kind,created_at FROM kekip_account_events WHERE account_id=$1 ORDER BY id DESC LIMIT 30',[account.id]);
 return {username:account.username,events:q.rows.map(({kind,created_at})=>({kind,at:created_at}))};
}
module.exports={ensureAccountHistory,recordAccountEvent,logoutWithHistory,readAccountHistory};
