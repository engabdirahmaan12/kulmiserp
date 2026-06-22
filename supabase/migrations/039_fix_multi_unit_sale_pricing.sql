-- Derive per-sale-unit prices from base unit price × conversion when no explicit override

CREATE OR REPLACE FUNCTION resolve_product_unit_price(
  p_product_id UUID,
  p_unit_id UUID,
  p_tier TEXT DEFAULT 'retail'
) RETURNS DECIMAL AS $$
DECLARE
  v_product RECORD;
  v_unit RECORD;
  v_factor DECIMAL;
  v_base_retail DECIMAL;
  v_base_wholesale DECIMAL;
  v_base_distributor DECIMAL;
BEGIN
  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_base_retail := COALESCE(v_product.selling_price, 0);
  v_base_wholesale := COALESCE(v_product.wholesale_price, v_base_retail);
  v_base_distributor := COALESCE(v_product.distributor_price, v_base_wholesale);

  IF p_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit
    FROM product_units pu
    WHERE pu.product_id = p_product_id AND pu.unit_type_id = p_unit_id;

    IF FOUND THEN
      v_factor := GREATEST(COALESCE(v_unit.conversion_factor, 1), 1);

      IF COALESCE(p_tier, 'retail') = 'wholesale' THEN
        IF v_unit.wholesale_price IS NOT NULL
           AND NOT (v_factor > 1 AND v_unit.wholesale_price = v_base_wholesale) THEN
          RETURN v_unit.wholesale_price;
        END IF;
        RETURN v_base_wholesale * v_factor;
      ELSIF COALESCE(p_tier, 'retail') = 'distributor' THEN
        IF v_unit.distributor_price IS NOT NULL
           AND NOT (v_factor > 1 AND v_unit.distributor_price = v_base_distributor) THEN
          RETURN v_unit.distributor_price;
        END IF;
        RETURN v_base_distributor * v_factor;
      ELSE
        IF v_unit.retail_price IS NOT NULL
           AND NOT (v_factor > 1 AND v_unit.retail_price = v_base_retail) THEN
          RETURN v_unit.retail_price;
        END IF;
        RETURN v_base_retail * v_factor;
      END IF;
    END IF;
  END IF;

  RETURN CASE COALESCE(p_tier, 'retail')
    WHEN 'wholesale' THEN v_base_wholesale
    WHEN 'distributor' THEN v_base_distributor
    ELSE v_base_retail
  END;
END;
$$ LANGUAGE plpgsql STABLE;
