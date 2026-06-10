-- ===========================================================================
-- B.Conseil CRM — Schéma Supabase (Postgres)
-- ---------------------------------------------------------------------------
-- À exécuter UNE FOIS dans Supabase → SQL Editor → New query → Run.
-- Idempotent : peut être relancé sans casser les données (le seed ne s'insère
-- que si les tables sont vides).
--
-- ⚠️ Auth : pour que l'inscription depuis la page Connexion connecte
--    immédiatement (sans email de confirmation), va dans
--    Authentication → Providers → Email et DÉSACTIVE "Confirm email".
-- ===========================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists pgcrypto;

-- ===========================================================================
-- TABLES
-- ===========================================================================

-- Clients -------------------------------------------------------------------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  societe     text not null,
  contact     text,
  prenom      text,
  nom         text,
  email       text,
  tel         text,
  ville       text,
  secteur     text,
  statut      text not null default 'prospection',
  devis_date  text,                 -- format affiché dd/mm/yyyy
  montant     integer default 0,
  referent    text,
  logo_url    text,
  notes       text,
  history     jsonb default '[]'::jsonb,   -- historique d'échanges + pièces jointes
  created_at  timestamptz not null default now()
);
-- Empêche les doublons de société (insensible à la casse / espaces)
create unique index if not exists clients_societe_key
  on public.clients (lower(trim(societe)));

-- Documents (devis / factures) ----------------------------------------------
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,        -- 'devis' | 'facture'
  numero      text,
  client_id   uuid references public.clients(id) on delete set null,
  societe     text,                 -- dénormalisé pour l'affichage
  contact     text,
  date        text,                 -- ISO yyyy-mm-dd (valeur du champ date)
  ref         text,
  ht          numeric default 0,
  tva         numeric default 0,
  ttc         numeric default 0,
  lines       jsonb default '[]'::jsonb,  -- [{des,qte,pu,tva}]
  notes       text,
  statut      text,                 -- 'devis' | 'facture'
  sent        boolean default false,
  sent_to     text,
  created_at  timestamptz not null default now()
);

-- Tâches (kanban) -----------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  assignee    text,                 -- 'François' | 'Alexandra' ...
  client      text,
  urgent      boolean default false,
  due         text,                 -- yyyy-mm-dd ou ''
  col         text not null default 'todo',   -- todo | doing | waiting | done
  position    integer default 0,
  created_at  timestamptz not null default now()
);

-- Profils (1 ligne par utilisateur auth) ------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  role        text,
  avatar_url  text,
  data        jsonb default '{}'::jsonb,  -- préférences libres du profil
  updated_at  timestamptz not null default now()
);

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================
alter table public.clients   enable row level security;
alter table public.documents enable row level security;
alter table public.tasks     enable row level security;
alter table public.profiles  enable row level security;

-- Espace de travail partagé : tout utilisateur connecté accède aux données métier.
drop policy if exists "clients_auth_all"   on public.clients;
drop policy if exists "documents_auth_all" on public.documents;
drop policy if exists "tasks_auth_all"     on public.tasks;
create policy "clients_auth_all"   on public.clients   for all to authenticated using (true) with check (true);
create policy "documents_auth_all" on public.documents for all to authenticated using (true) with check (true);
create policy "tasks_auth_all"     on public.tasks     for all to authenticated using (true) with check (true);

-- Profil : chacun ne voit/édite que sa propre ligne.
drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- ===========================================================================
-- TRIGGER : créer automatiquement un profil à l'inscription
-- ===========================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- REALTIME (sync multi-onglets / multi-appareils)
-- ===========================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.clients;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.documents; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tasks;     exception when duplicate_object then null; end;
end $$;

-- ===========================================================================
-- SEED — clients de démo (uniquement si la table est vide)
--   Fidèle à la liste affichée aujourd'hui sur la page d'accueil.
-- ===========================================================================
do $$
begin
if not exists (select 1 from public.clients) then
  insert into public.clients (societe, contact, prenom, nom, email, tel, ville, secteur, statut, devis_date) values
  ('Calmedica',       'Camille Roy',   'Camille','Roy',    'camille.roy@calmedica.fr',           '+33 6 12 48 30 17','Lyon',     'Santé',        'devis',       '02/06/2026'),
  ('Néovia SAS',      'Thomas Girard', 'Thomas', 'Girard', 'thomas.girard@neovia.fr',            '+33 6 23 71 09 54','Paris',    'Banque',       'encours',     '28/05/2026'),
  ('Atelier Brun',    'Sophie Lemaire','Sophie', 'Lemaire','sophie.lemaire@atelierbrun.fr',      '+33 6 34 56 78 90','Bordeaux', 'Restauration', 'recontacter', '19/05/2026'),
  ('GreenLeaf',       'Marc Dubois',   'Marc',   'Dubois', 'marc.dubois@greenleaf.fr',           '+33 6 45 11 87 22','Nantes',   'Viticole',     'prospection', '05/06/2026'),
  ('Cabinet Vasseur', 'Inès Faure',    'Inès',   'Faure',  'ines.faure@cabinet-vasseur.fr',      '+33 6 56 24 63 81','Lille',    'Assurance',    'encours',     '22/05/2026'),
  ('Maison Lefèvre',  'Hugo Mercier',  'Hugo',   'Mercier','hugo.mercier@maisonlefevre.fr',      '+33 6 67 90 14 28','Lyon',     'Santé',        'devis',       '30/05/2026'),
  ('Polytech Indus',  'Léa Moreau',    'Léa',    'Moreau', 'lea.moreau@polytech-indus.fr',       '+33 6 78 33 52 09','Grenoble', 'Assurance',    'prospection', '06/06/2026'),
  ('Finora',          'Julien Bernard','Julien', 'Bernard','julien.bernard@finora.fr',           '+33 6 89 02 47 16','Paris',    'Banque',       'facture',     '27/05/2026'),
  ('Groupe Aval',     'Nadia Benali',  'Nadia',  'Benali', 'nadia.benali@groupe-aval.fr',        '+33 6 11 58 73 40','Marseille','Assurance',    'recontacter', '14/05/2026'),
  ('Korrik Studio',   'Paul Henry',    'Paul',   'Henry',  'paul.henry@korrik.fr',               '+33 6 55 19 62 84','Toulouse', 'Santé',        'paye',        '31/05/2026'),
  ('Vinci & Co',      'Claire Petit',  'Claire', 'Petit',  'claire.petit@vinci-co.fr',           '+33 6 36 48 76 53','Dijon',    'Viticole',     'termine',     '03/06/2026'),
  ('Habitat Plus',    'Yanis Chérif',  'Yanis',  'Chérif', 'yanis.cherif@habitatplus.fr',        '+33 6 45 44 54 35','Nice',     'Restauration', 'prospection', '07/06/2026');
end if;
end $$;

-- ===========================================================================
-- SEED — tâches de démo (uniquement si la table est vide)
-- ===========================================================================
do $$
begin
if not exists (select 1 from public.tasks) then
  insert into public.tasks (title, description, assignee, client, urgent, due, col, position) values
  ('Préparer le devis — Atelier Brun','Chiffrer la refonte du site et préparer le devis détaillé à envoyer au client.','François','Atelier Brun',true,'2026-06-12','todo',0),
  ('Maquettes UX/UI — Maison Lefèvre','Concevoir les maquettes des écrans principaux et le parcours utilisateur.','Alexandra','Maison Lefèvre',false,'2026-06-18','todo',1),
  ('Cadrage agent IA — Polytech Indus','Atelier de cadrage du projet d''agent IA : objectifs, périmètre, données.','François','Polytech Indus',false,'','todo',2),
  ('Développement SAAS — Finora','Sprint en cours sur le module de facturation et le tableau de bord.','François','Finora',false,'2026-06-20','doing',0),
  ('Formation IA équipe — Cabinet Vasseur','Animer la session de formation à l''IA générative pour les équipes.','Alexandra','Cabinet Vasseur',true,'2026-06-10','doing',1),
  ('Refonte de l''app — Groupe Aval','Refonte de l''application mobile, phase de développement.','François','Groupe Aval',false,'','doing',2),
  ('Relance devis — Atelier Brun','Relancer le client suite à l''envoi du devis la semaine dernière.','François','Atelier Brun',false,'2026-06-09','waiting',0),
  ('Validation des maquettes — Calmedica','En attente de validation du client sur les maquettes proposées.','Alexandra','Calmedica',false,'','waiting',1),
  ('Livraison du site — Korrik Studio','Site livré, mis en ligne et recette validée.','François','Korrik Studio',false,'','done',0),
  ('Audit UX — Vinci & Co','Audit UX réalisé et rapport de recommandations livré.','Alexandra','Vinci & Co',false,'','done',1);
end if;
end $$;
