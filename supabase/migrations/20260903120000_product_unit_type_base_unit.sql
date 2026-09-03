-- Carton/unit master fields. packing remains the conversion factor (units per carton).
alter table public.products
  add column if not exists unit_type text not null default 'Carton',
  add column if not exists base_unit text not null default 'Piece';

comment on column public.products.packing is 'Units (base pieces) per outer pack / carton';
comment on column public.products.unit_type is 'Outer pack label shown in entry (Carton, Box, Pack, etc.)';
comment on column public.products.base_unit is 'Stock-keeping unit label (Piece, Pcs, Unit, etc.)';

update public.products
set unit_type = case when packing > 1 then coalesce(nullif(trim(unit_type), ''), 'Carton') else 'Piece' end,
    base_unit = coalesce(nullif(trim(base_unit), ''), 'Piece')
where true;
