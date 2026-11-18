-- Original gravity per batch, for live ABV = f(OG, latest reading).
-- Backfilled by the Brewfather sync (measured OG, else recipe OG).
alter table batches add column if not exists og numeric;
