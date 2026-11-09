export type CandidateRow = {
  id: string;
  organization_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  source: string | null;
  owner_id: string | null;
  tags: string[];
  is_demo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateListRow = Pick<
  CandidateRow,
  "id" | "first_name" | "last_name" | "email" | "phone" | "location" | "headline" | "owner_id" | "tags" | "is_demo" | "updated_at"
> & { skills: string[]; total_count: number };

export type SkillRow = { id: string; name: string; years_experience: number | null };

export type CertificationRow = {
  id: string;
  name: string;
  issuer: string | null;
  credential_id: string | null;
  issued_on: string | null;
  expires_on: string | null;
};

export type WorkHistoryRow = {
  id: string;
  company_name: string;
  title: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string | null;
};

export type ResumeRow = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
};

export type NoteRow = { id: string; body: string; author_id: string | null; created_at: string };

export type ActivityRow = {
  id: number;
  actor_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type DuplicateMatch = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  match_reasons: ("email" | "phone" | "name")[];
};

export type StaffMember = { id: string; name: string };
