-- Migration 055: add contact/org fields to profiles.
--
-- The Team / Members edit form (src/pages/members) has Phone Number,
-- Department, and Job Title inputs and both reads (member list embed) and
-- writes (edit member) profiles.phone / .department / .title. Those columns
-- were never added, so the member-list profile embed 400'd (rendering every
-- member as "Unknown User") and saving a member edit failed.
--
-- All three are optional free-text fields.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS phone      text,
    ADD COLUMN IF NOT EXISTS department text,
    ADD COLUMN IF NOT EXISTS title      text;
