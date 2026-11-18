// TEMPORARY (Oct 23, 2026): login disabled at Andy's request so the team can
// get in without waiting on magic-link email. While this is true the app is
// open to anyone with the URL, and the database must match — run
// supabase/temp-open-access.sql. To turn login back on: set this to false
// AND run supabase/reenable-auth.sql, then redeploy.
export const AUTH_DISABLED = true;
