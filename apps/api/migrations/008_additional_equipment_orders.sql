ALTER TABLE zc_orders ADD COLUMN parent_order_id TEXT REFERENCES zc_orders(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE zc_orders ADD COLUMN additional_equipment TEXT NOT NULL DEFAULT '' CHECK(additional_equipment IN ('','RASTREADOR','TAG'));
ALTER TABLE zc_orders ADD CONSTRAINT zc_additional_equipment_parent CHECK((parent_order_id IS NULL AND additional_equipment='') OR (parent_order_id IS NOT NULL AND additional_equipment<>''));
CREATE UNIQUE INDEX zc_additional_order_type ON zc_orders(parent_order_id,additional_equipment) WHERE parent_order_id IS NOT NULL;

-- Link the existing generated additional orders without changing evidence,
-- services, tariffs, ledger entries or completed records.
UPDATE zc_orders extra SET parent_order_id=base.id,
 additional_equipment=CASE WHEN extra.notes='Ref: Tag Extra' THEN 'TAG' ELSE 'RASTREADOR' END
FROM zc_orders base WHERE extra.id=base.id||'_EXTRA'
 AND extra.notes IN ('Ref: Tag Extra','Ref: Rastreador Extra')
 AND extra.service LIKE '%(Adicional)';
