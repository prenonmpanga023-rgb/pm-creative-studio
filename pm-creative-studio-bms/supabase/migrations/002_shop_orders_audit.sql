-- PM Creative Studio BMS — part 2: customer shop, orders, audit log.
-- Run AFTER 001_schema.sql (SQL Editor → New query → Run).

-- ───────── Shop code for each business ─────────
create or replace function public.make_slug(n text) returns text language sql volatile as $$
  select left(coalesce(nullif(trim(both '-' from lower(regexp_replace(n, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'shop'), 40)
         || '-' || substr(md5(random()::text), 1, 4)
$$;

alter table public.companies add column slug text;
update public.companies set slug = make_slug(name) where slug is null;
alter table public.companies alter column slug set not null;
alter table public.companies add constraint companies_slug_key unique (slug);
alter table public.companies add constraint companies_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,59}$');
grant update (slug) on public.companies to authenticated;

create or replace function public.create_workspace(p_company text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'This account already belongs to a workspace'; end if;
  insert into companies (name, slug) values (trim(p_company), make_slug(p_company)) returning id into cid;
  insert into profiles (id, company_id, full_name, email, role)
  values (auth.uid(), cid, trim(p_name), lower(auth.jwt() ->> 'email'), 'OWNER');
  return cid;
end $$;

-- ───────── Tables ─────────
create table public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  phone text,
  email text not null,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_no text not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  total numeric(14,2) not null default 0,
  note text,
  decision_note text,
  sale_id uuid references public.sales(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, order_no)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(14,2) not null
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor uuid,
  actor_name text,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index on public.orders (company_id, created_at desc);
create index on public.orders (customer_id);
create index on public.order_items (order_id);
create index on public.audit_log (company_id, created_at desc);

-- ───────── Row-Level Security ─────────
alter table public.customers   enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.audit_log   enable row level security;

create policy customers_staff on public.customers for select using (company_id = my_company());
create policy customers_self  on public.customers for select using (id = auth.uid());
create policy orders_staff    on public.orders for select using (company_id = my_company());
create policy orders_self     on public.orders for select using (customer_id = auth.uid());
create policy order_items_read on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.company_id = my_company() or o.customer_id = auth.uid())));
create policy audit_read on public.audit_log for select using (company_id = my_company() and my_role() in ('OWNER','ADMIN'));

-- ───────── Audit trail ─────────
create or replace function public.log_audit(p_company uuid, p_action text, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (company_id, actor, actor_name, action, detail)
  values (p_company, auth.uid(),
          coalesce((select full_name from profiles where id = auth.uid()), (select full_name from customers where id = auth.uid()), 'System'),
          p_action, p_detail);
end $$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  perform log_audit(new.company_id, tg_table_name || ' ' || lower(tg_op),
    coalesce(j ->> 'name', j ->> 'description', j ->> 'receipt_no', j ->> 'order_no', j ->> 'product_name', j ->> 'email', j ->> 'full_name', '')
    || case when j ? 'status' then ' (' || (j ->> 'status') || ')' when j ? 'active' then ' (active: ' || (j ->> 'active') || ')' else '' end);
  return new;
end $$;

create trigger audit_products  after insert or update of name, unit_price, cost_price, archived on public.products for each row execute function public.audit_row();
create trigger audit_suppliers after insert on public.suppliers for each row execute function public.audit_row();
create trigger audit_expenses  after insert on public.expenses  for each row execute function public.audit_row();
create trigger audit_sales     after insert on public.sales     for each row execute function public.audit_row();
create trigger audit_stock     after insert on public.stock_movements for each row when (new.kind not in ('SALE','OPENING')) execute function public.audit_row();
create trigger audit_invites   after insert on public.invites   for each row execute function public.audit_row();
create trigger audit_staff     after update of active on public.profiles for each row execute function public.audit_row();
create trigger audit_orders    after insert or update of status on public.orders for each row execute function public.audit_row();

-- ───────── Customer functions ─────────
create or replace function public.shop_info(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', name, 'currency', currency) from companies where slug = lower(trim(p_slug))
$$;

create or replace function public.my_shop() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', c.name, 'currency', c.currency, 'slug', c.slug)
  from companies c join customers u on u.company_id = c.id where u.id = auth.uid()
$$;

create or replace function public.join_shop(p_slug text, p_name text, p_phone text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'This email belongs to a staff account'; end if;
  select id into cid from companies where slug = lower(trim(p_slug));
  if cid is null then raise exception 'Shop code not found. Check the link you were given.'; end if;
  insert into customers (id, company_id, full_name, phone, email)
  values (auth.uid(), cid, trim(p_name), nullif(trim(p_phone), ''), lower(auth.jwt() ->> 'email'))
  on conflict (id) do nothing;
  return cid;
end $$;

-- Customers only see what they may buy: no cost prices, no sold-out items.
create or replace function public.shop_catalog() returns table (id uuid, name text, category text, unit_price numeric, stock integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.unit_price, p.stock from products p
  where p.company_id = (select company_id from customers where customers.id = auth.uid()) and not p.archived and p.stock > 0
  order by p.name
$$;

create or replace function public.place_order(p_items jsonb, p_note text default null) returns orders
language plpgsql security definer set search_path = public as $$
declare cid uuid; r record; p products%rowtype; o orders%rowtype; v_total numeric := 0; v_n integer;
begin
  select company_id into cid from customers where id = auth.uid();
  if cid is null then raise exception 'Only customers can place orders'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item'; end if;
  perform pg_advisory_xact_lock(hashtext('order' || cid::text));
  select count(*) + 1 into v_n from orders where company_id = cid and created_at::date = now()::date;
  insert into orders (company_id, customer_id, order_no, note)
  values (cid, auth.uid(), 'OR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_n::text, 4, '0'), nullif(trim(p_note), ''))
  returning * into o;
  for r in select (e ->> 'product_id')::uuid as pid, sum((e ->> 'qty')::int) as qty from jsonb_array_elements(p_items) e group by 1 loop
    if r.qty < 1 then raise exception 'Quantity must be at least 1'; end if;
    select * into p from products where id = r.pid and company_id = cid and not archived;
    if not found then raise exception 'A selected product is no longer available'; end if;
    if p.stock < r.qty then raise exception 'Only % of % left', p.stock, p.name; end if;
    insert into order_items (order_id, company_id, product_id, name, qty, unit_price) values (o.id, cid, p.id, p.name, r.qty, p.unit_price);
    v_total := v_total + p.unit_price * r.qty;
  end loop;
  update orders set total = v_total where id = o.id returning * into o;
  return o;
end $$;

create or replace function public.cancel_order(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'CANCELLED' where id = p_id and customer_id = auth.uid() and status = 'PENDING';
  if not found then raise exception 'Only your pending orders can be cancelled'; end if;
end $$;

-- Staff decision. Approving turns the order into a real sale (stock is deducted, receipt created).
create or replace function public.decide_order(p_id uuid, p_approve boolean, p_reason text default null) returns orders
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; s sales%rowtype;
begin
  if my_company() is null then raise exception 'Not allowed'; end if;
  select * into o from orders where id = p_id and company_id = my_company() for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'PENDING' then raise exception 'This order is already %', lower(o.status); end if;
  if p_approve then
    select * into s from record_sale(
      (select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty)) from order_items where order_id = o.id), 'OTHER', 0, null);
    update orders set status = 'APPROVED', sale_id = s.id, decided_by = auth.uid(), decided_at = now() where id = o.id returning * into o;
  else
    update orders set status = 'REJECTED', decision_note = nullif(trim(p_reason), ''), decided_by = auth.uid(), decided_at = now()
    where id = o.id returning * into o;
  end if;
  return o;
end $$;

-- ───────── Permissions ─────────
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon;
grant execute on function public.shop_info(text) to anon;
revoke execute on function public.log_audit(uuid, text, text) from authenticated, public;
revoke execute on function public.audit_row() from authenticated, public;
