-- Internal logical tiers only. No record is moved or deleted.
CREATE FUNCTION zc_storage_tier(p_status text,p_created text,p_completed text,p_month text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_status NOT IN ('CONCLUÍDO','CANCELADO') THEN 'HOT'
    WHEN greatest(left(coalesce(p_created,''),7),left(coalesce(p_completed,''),7)) !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN 'HOT'
    WHEN greatest(left(coalesce(p_created,''),7),left(coalesce(p_completed,''),7)) >= p_month THEN 'HOT'
    WHEN greatest(left(coalesce(p_created,''),7),left(coalesce(p_completed,''),7)) >= to_char((p_month||'-01')::date - interval '3 months','YYYY-MM') THEN 'WARM'
    ELSE 'COLD'
  END
$$;
CREATE FUNCTION zc_order_storage_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.archive := zc_storage_tier(NEW.status,NEW.created_date,NEW.completed_at,to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER zc_order_storage_auto BEFORE INSERT OR UPDATE OF status,created_date,completed_at ON zc_orders
FOR EACH ROW EXECUTE FUNCTION zc_order_storage_trigger();
UPDATE zc_orders SET archive=zc_storage_tier(status,created_date,completed_at,to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'))
WHERE deleted_at='' AND archive IS DISTINCT FROM zc_storage_tier(status,created_date,completed_at,to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'));
