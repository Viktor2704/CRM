-- Migration: Add SPPZ protected objects and fire systems tables (F-001..003)
-- Created: 2026-03-15

CREATE TABLE IF NOT EXISTS sppz_protected_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID NOT NULL,
  org_name TEXT,
  org_inn TEXT,
  org_ogrn TEXT,
  legal_address TEXT,
  physical_address TEXT,
  director_name TEXT,
  fire_responsible_name TEXT,
  fire_responsible_order_number TEXT,
  fire_responsible_order_date DATE,
  fire_class TEXT, -- f1, f2, f3, f4, f5
  contact_phone TEXT,
  contact_email TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sppz_protected_objects_direction
    ON sppz_protected_objects (direction_id);

CREATE TABLE IF NOT EXISTS sppz_fire_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES sppz_protected_objects(id) ON DELETE CASCADE,
  type_code TEXT NOT NULL, -- aps, aupt, soue, pdv, vpv, npv, ogn, ext, pl, door, sizod
  model TEXT,
  commissioning_date DATE,
  contractor_id UUID,
  contractor_license TEXT,
  contractor_license_valid_to DATE,
  check_period_days INT,
  next_check_date DATE,
  status TEXT DEFAULT 'active', -- active, inactive, decommissioned
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sppz_fire_systems_object
    ON sppz_fire_systems (object_id);
