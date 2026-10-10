-- ===== الشات المباشر — شغّله مرة واحدة في Supabase (SQL Editor) على مشروع الكاتدرائية =====
create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  room       text        not null,                       -- 'general' أو class_<chapter_id>
  sender     text        not null check (char_length(sender) between 1 and 120),  -- "الاسم ‖ الفصل"
  role       text        not null check (role in ('servant','admin')),
  body       text        not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_id_idx on public.chat_messages (room, id desc);

alter table public.chat_messages enable row level security;

drop policy if exists chat_read   on public.chat_messages;
drop policy if exists chat_insert on public.chat_messages;
drop policy if exists chat_delete on public.chat_messages;

-- الخدام يدخلون بدون حساب (anon) فيحتاجون القراءة والإرسال
create policy chat_read   on public.chat_messages for select to anon, authenticated using (true);
create policy chat_insert on public.chat_messages for insert to anon, authenticated
  with check (role = 'servant' or auth.role() = 'authenticated');
-- الحذف للمشرفين المسجّلين فقط
create policy chat_delete on public.chat_messages for delete to authenticated using (true);

-- تفعيل الاشتراك اللحظي (Realtime)
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;
alter table public.chat_messages replica identity full;
