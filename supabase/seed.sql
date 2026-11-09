-- DEMO DATA for local development only (`npx supabase db reset`). Never run against production.
-- Every record is flagged is_demo = true and labeled "(Demo)" so it can't be mistaken for real data.
-- No auth users are created here: sign up through the app, then grant yourself admin as described
-- in the README.

do $$
declare
  v_org uuid := (select id from public.organizations where is_default);
  v_company_a uuid;
  v_company_b uuid;
  v_alex uuid;
  v_blair uuid;
begin
  insert into public.companies (organization_id, name, industry, is_demo)
  values (v_org, 'Lone Star Networks (Demo)', 'Telecommunications', true)
  returning id into v_company_a;

  insert into public.companies (organization_id, name, industry, is_demo)
  values (v_org, 'Gulf Coast Health Systems (Demo)', 'Healthcare', true)
  returning id into v_company_b;

  insert into public.jobs (organization_id, company_id, title, public_summary, public_description, description,
                           status, published_at, location, work_arrangement, employment_type, is_demo)
  values
    (v_org, v_company_a, 'Senior Network Engineer (Demo)',
     'Design and operate a multi-site enterprise network with a focus on routing and SD-WAN.',
     E'Responsibilities\n- Own BGP and OSPF design across data centers\n- Lead SD-WAN rollout\n\nRequirements\n- 7+ years of enterprise networking\n- CCNP or equivalent experience',
     'Internal: demo client, budget approved.', 'published', now() - interval '2 days', 'Dallas, TX', 'hybrid', 'direct_hire', true),
    (v_org, v_company_b, 'SOC Analyst II (Demo)',
     'Investigate and respond to security alerts for a regional healthcare network.',
     E'Responsibilities\n- Triage SIEM alerts\n- Lead incident response\n\nRequirements\n- 3+ years SOC experience\n- Security+ or CySA+',
     'Internal: demo client.', 'published', now() - interval '5 days', 'Houston, TX', 'onsite', 'direct_hire', true),
    (v_org, v_company_a, 'RF Optimization Engineer (Demo)',
     'Optimize LTE and 5G RAN performance across a growing coverage footprint.',
     null, 'Internal: demo draft.', 'draft', null, 'Austin, TX', 'remote', 'direct_hire', true);

  insert into public.candidates (organization_id, first_name, last_name, email, phone, location, headline, summary, source, tags, is_demo)
  values (v_org, 'Alex', 'Rivera (Demo)', 'alex.rivera.demo@example.com', '+1 512 555 0100', 'Austin, TX',
          'Senior Network Engineer · CCNP', 'Demo candidate for local development.', 'Referral',
          array['ccnp', 'open to relocation'], true)
  returning id into v_alex;

  insert into public.candidates (organization_id, first_name, last_name, email, location, headline, source, tags, is_demo)
  values (v_org, 'Blair', 'Chen (Demo)', 'blair.chen.demo@example.com', 'Houston, TX', 'SOC Analyst', 'Website', array['security'], true)
  returning id into v_blair;

  insert into public.candidate_skills (organization_id, candidate_id, name, years_experience) values
    (v_org, v_alex, 'BGP', 7), (v_org, v_alex, 'SD-WAN', 3), (v_org, v_alex, 'Python', 2),
    (v_org, v_blair, 'Splunk', 4), (v_org, v_blair, 'Incident response', 3);

  insert into public.candidate_certifications (organization_id, candidate_id, name, issuer, issued_on, expires_on) values
    (v_org, v_alex, 'CCNP Enterprise', 'Cisco', '2023-04-01', '2026-04-01'),
    (v_org, v_blair, 'CompTIA CySA+', 'CompTIA', '2024-02-15', '2027-02-15');

  insert into public.candidate_work_history (organization_id, candidate_id, company_name, title, location, start_date, is_current) values
    (v_org, v_alex, 'Example Telecom (Demo)', 'Network Engineer', 'Austin, TX', '2019-06-01', true),
    (v_org, v_blair, 'Example Hospital (Demo)', 'SOC Analyst', 'Houston, TX', '2021-01-01', true);
end
$$;
