-- Staff login lockout window. Accounts unlock automatically after 15 minutes.
ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
