-- Include bulk purchase units (Sack, Carton, etc.) in POS sale unit list
CREATE OR REPLACE FUNCTION get_product_sale_units(p_product_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_product RECORD;
  v_units JSONB;
BEGIN
  SELECT
    p.id,
    p.base_unit_id,
    p.selling_price,
    p.wholesale_price,
    p.distributor_price,
    p.cost_price,
    p.stock_quantity,
    ut.code AS base_code,
    ut.name AS base_name,
    ut.allows_decimal AS base_allows_decimal
  INTO v_product
  FROM products p
  LEFT JOIN unit_types ut ON ut.id = p.base_unit_id
  WHERE p.id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pu.id,
      'unit_type_id', ut.id,
      'code', ut.code,
      'name', ut.name,
      'allows_decimal', ut.allows_decimal,
      'conversion_factor', pu.conversion_factor,
      'is_purchase_unit', pu.is_purchase_unit,
      'is_default_sale', pu.is_default_sale,
      'retail_price', COALESCE(pu.retail_price, v_product.selling_price),
      'wholesale_price', COALESCE(pu.wholesale_price, v_product.wholesale_price),
      'distributor_price', COALESCE(pu.distributor_price, v_product.distributor_price)
    ) ORDER BY pu.is_default_sale DESC, ut.sort_order
  ), '[]'::JSONB)
  INTO v_units
  FROM product_units pu
  JOIN unit_types ut ON ut.id = pu.unit_type_id
  WHERE pu.product_id = p_product_id
    AND (
      pu.is_purchase_unit = false
      OR pu.is_default_sale = true
      OR pu.conversion_factor > 1
    );

  IF v_units = '[]'::JSONB AND v_product.base_unit_id IS NOT NULL THEN
    v_units := jsonb_build_array(jsonb_build_object(
      'id', NULL,
      'unit_type_id', v_product.base_unit_id,
      'code', v_product.base_code,
      'name', v_product.base_name,
      'allows_decimal', COALESCE(v_product.base_allows_decimal, false),
      'conversion_factor', 1,
      'is_purchase_unit', false,
      'is_default_sale', true,
      'retail_price', v_product.selling_price,
      'wholesale_price', v_product.wholesale_price,
      'distributor_price', v_product.distributor_price
    ));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'base_unit_id', v_product.base_unit_id,
    'base_code', v_product.base_code,
    'cost_price', v_product.cost_price,
    'stock_quantity', v_product.stock_quantity,
    'units', v_units
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
