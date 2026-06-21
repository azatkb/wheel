-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.physics_results (
  id bigint NOT NULL DEFAULT nextval('physics_results_id_seq'::regclass),
  job_id text NOT NULL,
  email text,
  medium text,
  cumulative_deg double precision,
  w_total_air double precision,
  w_total_water double precision,
  f_max_air double precision,
  omega_max double precision,
  t_lajtner double precision,
  a_lajtner double precision,
  physics_json text,
  created_at timestamp with time zone DEFAULT now(),
  cw_deg double precision DEFAULT 0,
  ccw_deg double precision DEFAULT 0,
  cw_ccw_deg double precision DEFAULT 0,
  ccw_cw_deg double precision DEFAULT 0,
  CONSTRAINT physics_results_pkey PRIMARY KEY (id)
);
CREATE TABLE public.wt_jobs (
  id text NOT NULL,
  user_email text,
  source_type text,
  direction text,
  medium text,
  hand_visible boolean DEFAULT false,
  info_level text DEFAULT 'basic'::text,
  status text DEFAULT 'queued'::text,
  sample_count integer DEFAULT 0,
  duration_sec double precision,
  created_at timestamp with time zone DEFAULT now(),
  finished_at timestamp with time zone,
  CONSTRAINT wt_jobs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.wt_samples (
  id bigint NOT NULL DEFAULT nextval('wt_samples_id_seq'::regclass),
  job_id text NOT NULL,
  timestamp_sec double precision NOT NULL,
  rotation_deg double precision,
  rotation_rad double precision,
  cumulative_deg double precision NOT NULL,
  cumulative_rad double precision NOT NULL,
  angular_vel_dps double precision,
  angular_vel_rps double precision,
  confidence_pct integer NOT NULL,
  source text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT wt_samples_pkey PRIMARY KEY (id),
  CONSTRAINT wt_samples_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.wt_jobs(id)
);
CREATE TABLE public.wt_users (
  email text NOT NULL,
  password_hash text,
  created_at text,
  plan text DEFAULT 'free'::text,
  CONSTRAINT wt_users_pkey PRIMARY KEY (email)
);