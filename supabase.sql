-- 实验室出入登记 —— Supabase 建表脚本
-- 用法：Supabase 控制台 → SQL Editor → 新建 query → 粘贴整段 → Run

create table if not exists public.visits (
  id     text        primary key,          -- 前端生成的 UUID，用来去重（重复提交不会产生两条）
  person text        not null,             -- 姓名，需和 config.js 里的人员名单一致
  action text        not null check (action in ('in', 'out')),
  at     timestamptz not null              -- 点名时刻（北京时间由前端按 Asia/Shanghai 渲染）
);

create index if not exists visits_at_idx     on public.visits (at desc);
create index if not exists visits_person_idx on public.visits (person, at desc);

alter table public.visits enable row level security;

-- 匿名（前端 anon key）只被允许两件事：
--   1) 追加记录
--   2) 读取记录（页面要根据"最后一条"判断谁在场）
-- 没有 update / delete 策略，所以公网拿不到改和删的权限。
drop policy if exists "anon insert" on public.visits;
drop policy if exists "anon select" on public.visits;

create policy "anon insert" on public.visits
  for insert to anon with check (true);

create policy "anon select" on public.visits
  for select to anon using (true);
