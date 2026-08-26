#!/usr/bin/env python3
"""
Convert backup_neon_final_import_CORRIGE.sql to Neon PostgreSQL compatible SQL.

Key adaptations for Neon:
1. SET search_path TO 'public', 'extensions' -> 'public' only (Neon has no 'extensions' schema)
2. SET default_table_access_method = heap -> removed (Neon uses its own storage)
3. Empty ROW SECURITY section comments -> removed
4. All other structures (pgcrypto, gen_random_uuid, tables, data) are Neon-compatible
"""

import re

INPUT = "/home/z/my-project/upload/backup_neon_final_import_CORRIGE.sql"
OUTPUT = "/home/z/my-project/download/neon_database_import.sql"

with open(INPUT, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Fix search_path containing 'extensions' schema
content = re.sub(
    r"SET search_path TO 'public', 'extensions'",
    "SET search_path TO 'public'",
    content
)

content = re.sub(
    r"SET search_path TO 'extensions', 'public'",
    "SET search_path TO 'public'",
    content
)

# 2. Comment out SET default_table_access_method
content = re.sub(
    r"SET default_table_access_method = heap;\n",
    "-- SET default_table_access_method = heap; -- Removed for Neon compatibility\n",
    content
)

# 3. Remove empty ROW SECURITY section comments
content = re.sub(
    r"--\n-- Name: [^;]+; Type: ROW SECURITY; Schema: public; Owner: -\n--\n(?:--\n)*",
    "",
    content
)

# 4. Add Neon compatibility header
header = """-- ============================================================
-- Neon PostgreSQL Import File
-- Generated from: backup_neon_final_import_CORRIGE.sql
-- Adapted for Neon PostgreSQL compatibility
-- ============================================================
-- Changes applied:
--   1. Removed 'extensions' schema from search_path (Neon uses public)
--   2. Removed SET default_table_access_method = heap (Neon-managed storage)
--   3. Removed empty ROW SECURITY section comments
-- ============================================================

"""

content = re.sub(
    r"^--\n-- PostgreSQL database dump\n--\n\n\n-- Dumped from database version[^\n]*\n-- Dumped by pg_dump version[^\n]*\n",
    header,
    content
)

# 5. Add comment before pgcrypto extension
content = content.replace(
    "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;",
    "-- pgcrypto extension (provides crypt(), gen_random_uuid())\nCREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;"
)

# Write output
with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Neon-compatible SQL file created: {OUTPUT}")
print(f"   Output size: {len(content)} chars")

# Verify changes
checks = [
    ("No 'extensions' schema in search_path", "'extensions'" not in content),
    ("No heap access_method active", "SET default_table_access_method = heap;" not in content),
    ("No ROW SECURITY comments", "Type: ROW SECURITY" not in content),
    ("pgcrypto present", "CREATE EXTENSION IF NOT EXISTS pgcrypto" in content),
    ("gen_random_uuid present", "gen_random_uuid()" in content),
    ("crypt() function used", "crypt(" in content),
]

print("\n--- Validation ---")
for name, passed in checks:
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] {name}")

# Count data rows
insert_count = len(re.findall(r"^INSERT INTO", content, re.MULTILINE))
table_creates = len(re.findall(r"^CREATE TABLE", content, re.MULTILINE))
func_creates = len(re.findall(r"^CREATE FUNCTION", content, re.MULTILINE))
indexes = len(re.findall(r"^CREATE (UNIQUE )?INDEX", content, re.MULTILINE))

print(f"\n--- Content Summary ---")
print(f"  Tables:      {table_creates}")
print(f"  Functions:   {func_creates}")
print(f"  Indexes:     {indexes}")
print(f"  INSERT rows: {insert_count}")
