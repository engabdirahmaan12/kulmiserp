-- Backfill FIFO cost layers for on-hand stock that has no purchase-order layer

CREATE OR REPLACE FUNCTION backfill_unlayered_cost_layers(
  p_store_id UUID,
  p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_role TEXT;
  v_product RECORD;
  v_layer_qty DECIMAL(15,3);
  v_unlayered DECIMAL(15,3);
  v_created INT := 0;
BEGIN
  SELECT role INTO v_role FROM store_users
  WHERE store_id = p_store_id AND user_id = p_user_id AND is_active = true
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  FOR v_product IN
    SELECT
      p.id,
      p.name,
      p.stock_quantity,
      COALESCE(p.cost_price, 0) AS cost_price
    FROM products p
    WHERE p.store_id = p_store_id
      AND p.track_inventory = true
      AND p.stock_quantity > 0
  LOOP
    SELECT COALESCE(SUM(l.quantity_remaining), 0) INTO v_layer_qty
    FROM inventory_cost_layers l
    WHERE l.store_id = p_store_id AND l.product_id = v_product.id;

    v_unlayered := v_product.stock_quantity - v_layer_qty;

    IF v_unlayered > 0.0001 THEN
      INSERT INTO inventory_cost_layers (
        store_id, product_id, quantity_remaining, unit_cost, source_type, source_id
      ) VALUES (
        p_store_id,
        v_product.id,
        v_unlayered,
        v_product.cost_price,
        'opening_balance',
        NULL
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  PERFORM log_accounting_audit(
    p_store_id,
    p_user_id,
    'inventory_cost_layer',
    p_store_id,
    'backfill_unlayered',
    NULL,
    jsonb_build_object('layers_created', v_created)
  );

  RETURN jsonb_build_object('success', true, 'layers_created', v_created);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
