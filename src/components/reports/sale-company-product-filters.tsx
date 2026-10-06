"use client";

import { FilterMultiSelect } from "@/components/reports/filter-multi-select";
import { useCallback, useMemo, useState } from "react";

type Option = { value: string; label: string };

type ProductOption = Option & {
  warehouseId: string | null;
};

export function SaleCompanyProductFilters({
  warehouseValue,
  productValue,
  warehouses,
  products,
}: {
  warehouseValue?: string;
  productValue?: string;
  warehouses: Option[];
  products: ProductOption[];
}) {
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>(() =>
    (warehouseValue || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );

  const onWarehouseChange = useCallback((selected: string[]) => {
    setSelectedWarehouses(selected);
  }, []);

  const productOptions = useMemo(() => {
    if (!selectedWarehouses.length) {
      return products.map(({ value, label }) => ({ value, label }));
    }
    const allowed = new Set(selectedWarehouses);
    return products
      .filter((p) => p.warehouseId && allowed.has(p.warehouseId))
      .map(({ value, label }) => ({ value, label }));
  }, [products, selectedWarehouses]);

  const allowedProductIds = useMemo(
    () => new Set(productOptions.map((p) => p.value)),
    [productOptions],
  );

  const filteredProductValue = useMemo(() => {
    const selected = (productValue || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (!selectedWarehouses.length) return productValue;
    return selected.filter((id) => allowedProductIds.has(id)).join(",");
  }, [productValue, selectedWarehouses.length, allowedProductIds]);

  return (
    <>
      <FilterMultiSelect
        name="warehouse"
        label="Company"
        value={warehouseValue}
        options={warehouses}
        onChange={onWarehouseChange}
      />
      <FilterMultiSelect
        key={`product-${selectedWarehouses.join(",") || "all"}`}
        name="product"
        label="Product"
        value={filteredProductValue}
        options={productOptions}
        searchPlaceholder={
          selectedWarehouses.length
            ? "Search products in selected company..."
            : "Search code or name..."
        }
        allLabel={
          selectedWarehouses.length
            ? "All products in company"
            : "All"
        }
      />
    </>
  );
}
