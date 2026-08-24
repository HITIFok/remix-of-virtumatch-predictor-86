-- Make device_id nullable in premium_activations
-- New email-based activation flow uses user_id instead of device_id.
-- Existing device-based rows keep their device_id; new user-based rows have device_id = NULL.

ALTER TABLE premium_activations ALTER COLUMN device_id DROP NOT NULL;
