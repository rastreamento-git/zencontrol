-- Central-authorized exception; historical orders remain billable by default.
ALTER TABLE zc_orders ADD COLUMN tracker_waiver_authorized BOOLEAN NOT NULL DEFAULT false;
