-- 实验室出入登记 —— 升级脚本（已经在用的库执行这个）
-- 用法：Supabase 控制台 → SQL Editor → 新建 query → 粘贴整段 → Run
-- 全部语句都可重复执行，跑两次也不会报错、不会重复写数据。

-- 1) 增加「北京时间」列：at 仍然是标准时间点（换算不会出错），
--    at_local 是同一时刻的北京时间，表格里直接看这一列就行。
alter table public.visits
  add column if not exists at_local timestamp without time zone;

-- 2) 把历史记录补上北京时间
update public.visits
   set at_local = (at at time zone 'Asia/Shanghai')
 where at_local is null;

-- 3) 成员名单表，给网页右下角的加号用
create table if not exists public.people (
  name       text        primary key,
  created_at timestamptz not null default now()
);

alter table public.people enable row level security;

drop policy if exists "anon select people" on public.people;
drop policy if exists "anon insert people" on public.people;

create policy "anon insert people" on public.people
  for insert to anon with check (true);

create policy "anon select people" on public.people
  for select to anon using (true);
