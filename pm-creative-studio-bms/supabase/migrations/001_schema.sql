-- PM Creative Studio BMS — Supabase schema
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run.

create extension if not exists pgcrypto;

-- ───────── Tables ─────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 140),
  currency text not null default 'ZMW' check (currency in ('ZMW','USD','GBP','EUR','ZAR')),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null check (role in ('OWNER','ADMIN','EMPLOYEE')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null check (role in ('ADMIN','EMPLOYEE')),
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  sku text,
  category text,
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  reorder_level integer not null default 5 check (reorder_level >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, sku)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  description text not null,
  category text not null,
  amount numeric(14,2) not null check (amount >= 0),
  spent_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_no text not null,
  subtotal numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  cost_total numeric(14,2) not null,
  paid numeric(14,2) not null,
  payment_method text not null check (payment_method in ('CASH','MOBILE_MONEY','CARD','BANK_TRANSFER','OTHER')),
  served_by text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, receipt_no)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(14,2) not null,
  cost_price numeric(14,2) not null
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  kind text not null check (kind in ('OPENING','STOCK_IN','STOCK_OUT','COUNT','SALE')),
  qty integer not null,
  before_qty integer not null,
  after_qty integer not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.profiles (company_id);
create index on public.products (company_id, created_at desc);
create index on public.expenses (company_id, spent_at desc);
create index on public.sales (company_id, created_at desc);
create index on public.sale_items (sale_id);
create index on public.stock_movements (company_id, created_at desc);

-- ───────── Helpers (used by RLS and functions) ─────────
create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as
$$ select company_id from profiles where id = auth.uid() and active $$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

-- ───────── Row-Level Security ─────────
do $$
declare t text;
begin
  foreach t in array array['companies','profiles','invites','products','suppliers','expenses','sales','sale_items','stock_movements'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy companies_read   on public.companies for select using (id = my_company());
create policy companies_update on public.companies for update using (id = my_company() and my_role() in ('OWNER','ADMIN'));

create policy profiles_read on public.profiles for select using (company_id = my_company());
create policy invites_read  on public.invites  for select using (company_id = my_company() and my_role() in ('OWNER','ADMIN'));

create policy products_read   on public.products for select using (company_id = my_company());
create policy products_insert on public.products for insert with check (company_id = my_company() and my_role() in ('OWNER','ADMIN'));
create policy products_update on public.products for update using (company_id = my_company() and my_role() in ('OWNER','ADMIN'));

create policy suppliers_read   on public.suppliers for select using (company_id = my_company());
create policy suppliers_insert on public.suppliers for insert with check (company_id = my_company());

create policy expenses_read   on public.expenses for select using (company_id = my_company());
create policy expenses_insert on public.expenses for insert with check (company_id = my_company() and created_by = auth.uid());

create policy sales_read      on public.sales for select using (company_id = my_company());
create policy sale_items_read on public.sale_items for select using (company_id = my_company());
create policy movements_read  on public.stock_movements for select using (company_id = my_company());

-- Stock can only change through functions below, never by direct edit.
revoke update on public.products from authenticated;
grant update (name, sku, category, cost_price, unit_price, reorder_level, archived) on public.products to authenticated;
revoke update on public.companies from authenticated;
grant update (name, currency) on public.companies to authenticated;

-- ───────── Functions ─────────
create or replace function public.create_workspace(p_company text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'This account already belongs to a workspace'; end if;
  insert into companies (name) values (trim(p_company)) returning id into cid;
  insert into profiles (id, company_id, full_name, email, role)
  values (auth.uid(), cid, trim(p_name), lower(auth.jwt() ->> 'email'), 'OWNER');
  return cid;
end $$;

create or replace function public.join_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into inv from invites where lower(email) = lower(auth.jwt() ->> 'email') order by created_at limit 1;
  if not found then raise exception 'No invitation found for this email. Ask your owner to invite you first.'; end if;
  insert into profiles (id, company_id, full_name, email, role)
  values (auth.uid(), inv.company_id, trim(p_name), lower(auth.jwt() ->> 'email'), inv.role);
  delete from invites where id = inv.id;
  return inv.company_id;
end $$;

create or replace function public.invite_staff(p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('OWNER','ADMIN') then raise exception 'Not allowed'; end if;
  if p_role = 'ADMIN' and my_role() <> 'OWNER' then raise exception 'Only the owner can invite administrators'; end if;
  if p_role not in ('ADMIN','EMPLOYEE') then raise exception 'Invalid role'; end if;
  insert into invites (company_id, email, role) values (my_company(), lower(trim(p_email)), p_role)
  on conflict (company_id, email) do update set role = excluded.role;
end $$;

create or replace function public.cancel_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('OWNER','ADMIN') then raise exception 'Not allowed'; end if;
  delete from invites where id = p_id and company_id = my_company();
end $$;

create or replace function public.set_staff_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('OWNER','ADMIN') then raise exception 'Not allowed'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own access'; end if;
  update profiles set active = p_active
  where id = p_user and company_id = my_company() and role <> 'OWNER'
    and (role = 'EMPLOYEE' or my_role() = 'OWNER');
  if not found then raise exception 'Staff member not found or not editable'; end if;
end $$;

create or replace function public.adjust_stock(p_product uuid, p_kind text, p_qty integer, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p products%rowtype; nxt integer;
begin
  if my_role() not in ('OWNER','ADMIN') then raise exception 'Only owners and administrators can adjust stock'; end if;
  if p_qty < 0 then raise exception 'Quantity cannot be negative'; end if;
  select * into p from products where id = p_product and company_id = my_company() for update;
  if not found then raise exception 'Product not found'; end if;
  nxt := case p_kind when 'STOCK_IN' then p.stock + p_qty when 'STOCK_OUT' then p.stock - p_qty when 'COUNT' then p_qty else null end;
  if nxt is null then raise exception 'Invalid adjustment type'; end if;
  if nxt < 0 then raise exception 'Cannot remove more than the % in stock', p.stock; end if;
  update products set stock = nxt where id = p.id;
  insert into stock_movements (company_id, product_id, product_name, kind, qty, before_qty, after_qty, note, created_by)
  values (p.company_id, p.id, p.name, p_kind, p_qty, p.stock, nxt, nullif(trim(p_note), ''), auth.uid());
end $$;

-- Records a sale atomically. Prices and totals are always taken from the database, never from the browser.
create or replace function public.record_sale(p_items jsonb, p_payment text, p_discount numeric default 0, p_paid numeric default null)
returns sales language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_company();
  r record; p products%rowtype; s sales%rowtype;
  v_sub numeric := 0; v_cost numeric := 0; v_total numeric; v_n integer; v_name text;
begin
  if cid is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item'; end if;
  perform pg_advisory_xact_lock(hashtext(cid::text));

  for r in select (e ->> 'product_id')::uuid as pid, sum((e ->> 'qty')::int) as qty
           from jsonb_array_elements(p_items) e group by 1 order by 1 loop
    if r.qty < 1 then raise exception 'Quantity must be at least 1'; end if;
    select * into p from products where id = r.pid and company_id = cid and not archived for update;
    if not found then raise exception 'A selected product no longer exists'; end if;
    if p.stock < r.qty then raise exception 'Not enough stock for %', p.name; end if;
    v_sub := v_sub + p.unit_price * r.qty;
    v_cost := v_cost + p.cost_price * r.qty;
  end loop;

  v_total := greatest(v_sub - coalesce(p_discount, 0), 0);
  if coalesce(p_paid, v_total) < v_total then raise exception 'Amount paid is less than the total'; end if;
  select count(*) + 1 into v_n from sales where company_id = cid and created_at::date = now()::date;
  select full_name into v_name from profiles where id = auth.uid();

  insert into sales (company_id, receipt_no, subtotal, discount, total, cost_total, paid, payment_method, served_by, created_by)
  values (cid, 'PM-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_n::text, 4, '0'), v_sub, v_sub - v_total, v_total, v_cost,
          coalesce(p_paid, v_total), p_payment, v_name, auth.uid())
  returning * into s;

  for r in select (e ->> 'product_id')::uuid as pid, sum((e ->> 'qty')::int) as qty
           from jsonb_array_elements(p_items) e group by 1 loop
    select * into p from products where id = r.pid;
    insert into sale_items (company_id, sale_id, product_id, name, qty, unit_price, cost_price)
    values (cid, s.id, p.id, p.name, r.qty, p.unit_price, p.cost_price);
    update products set stock = stock - r.qty where id = p.id;
    insert into stock_movements (company_id, product_id, product_name, kind, qty, before_qty, after_qty, note, created_by)
    values (cid, p.id, p.name, 'SALE', r.qty, p.stock, p.stock - r.qty, s.receipt_no, auth.uid());
  end loop;
  return s;
end $$;

create or replace function public.report_summary(p_from timestamptz default null) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'revenue',      coalesce((select sum(total)      from sales    where company_id = my_company() and (p_from is null or created_at >= p_from)), 0),
    'cost',         coalesce((select sum(cost_total) from sales    where company_id = my_company() and (p_from is null or created_at >= p_from)), 0),
    'expenses',     coalesce((select sum(amount)     from expenses where company_id = my_company() and (p_from is null or spent_at  >= p_from)), 0),
    'transactions', (select count(*) from sales where company_id = my_company() and (p_from is null or created_at >= p_from)),
    'by_payment',   coalesce((select json_object_agg(payment_method, t) from
                      (select payment_method, sum(total) t from sales where company_id = my_company() and (p_from is null or created_at >= p_from) group by 1) x), '{}'::json)
  ) where my_company() is not null
$$;

grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon;

-- Log opening stock when a product is created with a starting quantity.
create or replace function public.log_opening_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock > 0 then
    insert into stock_movements (company_id, product_id, product_name, kind, qty, before_qty, after_qty, note, created_by)
    values (new.company_id, new.id, new.name, 'OPENING', new.stock, 0, new.stock, 'Opening stock', auth.uid());
  end if;
  return new;
end $$;
create trigger products_opening_stock after insert on public.products for each row execute function public.log_opening_stock();
