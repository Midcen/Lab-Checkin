-- 实验室出入登记 —— Supabase 建表脚本（全新安装用）
-- 用法：Supabase 控制台 → SQL Editor → 新建 query → 粘贴整段 → Run
-- 已经跑过旧版本的库不要用这个，改用 supabase-update.sql

-- 出入记录：只追加的日志
create table if not exists public.visits (
  id       text        primary key,        -- 前端生成的 UUID，用来去重（重复提交不会产生两条）
  person   text        not null,           -- 姓名，需和 config.js 里的人员名单一致
  action   text        not null check (action in ('in', 'out')),
  at       timestamptz not null,           -- 时刻（标准 UTC 时间点，前端按 Asia/Shanghai 显示）
  at_local timestamp   without time zone   -- 同一时刻的北京时间墙上时钟，表格里看这一列
);

create index if not exists visits_at_idx     on public.visits (at desc);
create index if not exists visits_person_idx on public.visits (person, at desc);

-- 成员名单：网页右下角加号添加的人存这里
create table if not exists public.people (
  name       text        primary key,
  created_at timestamptz not null default now()
);

alter table public.visits enable row level security;
alter table public.people enable row level security;

-- 匿名（前端 publishable key）只被允许：
--   visits: 追加、读取（页面要根据"最后一条"判断谁在场）
--   people: 追加、读取
-- 没有 update / delete 策略，所以公网拿不到改和删的权限。
drop policy if exists "anon insert" on public.visits;
drop policy if exists "anon select" on public.visits;
drop policy if exists "anon select people" on public.people;
drop policy if exists "anon insert people" on public.people;

create policy "anon insert" on public.visits
  for insert to anon with check (true);

create policy "anon select" on public.visits
  for select to anon using (true);

create policy "anon insert people" on public.people
  for insert to anon with check (true);

create policy "anon select people" on public.people
  for select to anon using (true);
