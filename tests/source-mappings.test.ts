import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

// Use an isolated DB so the Python module's own schema (no FK to the server's
// projects table, which isn't created here) is used instead of the server's.
const TEST_DB_PATH = path.join(os.tmpdir(), "aidda-source-mappings-test.sqlite");
const PY_ENV = { ...process.env, AIDDA_DB_PATH: TEST_DB_PATH };

// Test source_mappings.py database operations and mapping functions

test("source_mappings - check_and_get_existing_mapping finds by announcement_id", () => {
  const stdout = execFileSync(
    "python3",
    [
      "-c",
      `
import sys
sys.path.insert(0, '.')
from scripts.source_mappings import check_and_get_existing_mapping, init_db, create_or_update_mapping

# Initialize test DB
init_db()

# Create a test mapping
create_or_update_mapping(
    project_id="test-project-123",
    announcement_id="ann-12345",
    sha256=None,
    notebook_id="notebook-abc",
    source_id="src-67890",
    source_title="Test Report",
    local_path="/path/to/report.pdf"
)

# Check that it can be found by announcement_id
result = check_and_get_existing_mapping(
    project_id="test-project-123",
    notebook_id="notebook-abc",
    announcement_id="ann-12345",
    sha256=None
)

print(result is not None)
if result:
    print(result.get('source_id'))
    print(result.get('announcement_id'))
else:
    print(None)
`,
    ],
    { encoding: "utf-8", cwd: "/data/Projects/ai-dd", env: PY_ENV },
  ).trim();

  const lines = stdout.split("\n");
  assert.equal(lines[0], "True");
  assert.equal(lines[1], "src-67890");
  assert.equal(lines[2], "ann-12345");
});

test("source_mappings - check_and_get_existing_mapping finds by sha256", () => {
  const stdout = execFileSync(
    "python3",
    [
      "-c",
      `
import sys
sys.path.insert(0, '.')
from scripts.source_mappings import check_and_get_existing_mapping, init_db, create_or_update_mapping

init_db()

# Create a mapping by sha256
create_or_update_mapping(
    project_id="test-project-456",
    announcement_id=None,
    sha256="abc123def456",
    notebook_id="notebook-def",
    source_id="src-xyz",
    source_title="SHA Test",
    local_path="/path/to/file"
)

# Check that it can be found by sha256
result = check_and_get_existing_mapping(
    project_id="test-project-456",
    notebook_id="notebook-def",
    announcement_id=None,
    sha256="abc123def456"
)

print(result is not None)
if result:
    print(result.get('source_id'))
else:
    print(None)
`,
    ],
    { encoding: "utf-8", cwd: "/data/Projects/ai-dd", env: PY_ENV },
  ).trim();

  const lines = stdout.split("\n");
  assert.equal(lines[0], "True");
  assert.equal(lines[1], "src-xyz");
});

test("source_mappings - check_and_get_existing_mapping returns None when not found", () => {
  const stdout = execFileSync(
    "python3",
    [
      "-c",
      `
import sys
sys.path.insert(0, '.')
from scripts.source_mappings import check_and_get_existing_mapping, init_db

init_db()

# Check non-existent mapping
result = check_and_get_existing_mapping(
    project_id="non-existent",
    notebook_id="notebook-xyz",
    announcement_id="ann-999",
    sha256=None
)

print(result is None)
`,
    ],
    { encoding: "utf-8", cwd: "/data/Projects/ai-dd", env: PY_ENV },
  ).trim();

  assert.equal(stdout, "True");
});

test("source_mappings - clean_mappings_for_project deletes all mappings for a project", () => {
  const stdout = execFileSync(
    "python3",
    [
      "-c",
      `
import sys
sys.path.insert(0, '.')
from scripts.source_mappings import check_and_get_existing_mapping, init_db, create_or_update_mapping, clean_mappings_for_project

init_db()

# Create two mappings for the same project
create_or_update_mapping(
    project_id="test-project-clean",
    announcement_id="ann-1",
    sha256=None,
    notebook_id="notebook-1",
    source_id="src-1",
    source_title="Test 1",
    local_path="/path/1"
)

create_or_update_mapping(
    project_id="test-project-clean",
    announcement_id="ann-2",
    sha256="sha2-hash",
    notebook_id="notebook-1",
    source_id="src-2",
    source_title="Test 2",
    local_path="/path/2"
)

# Count existing mappings before cleanup
count1 = check_and_get_existing_mapping(project_id="test-project-clean", notebook_id="notebook-1", announcement_id="ann-1", sha256=None) is not None
count2 = check_and_get_existing_mapping(project_id="test-project-clean", notebook_id="notebook-1", announcement_id="ann-2", sha256="sha2-hash") is not None

clean_mappings_for_project("test-project-clean")

# Verify both are gone
after1 = check_and_get_existing_mapping(project_id="test-project-clean", notebook_id="notebook-1", announcement_id="ann-1", sha256=None) is not None
after2 = check_and_get_existing_mapping(project_id="test-project-clean", notebook_id="notebook-1", announcement_id="ann-2", sha256="sha2-hash") is not None

print(count1 and count2)  # Should be True before cleanup (both existed)
print(not after1 and not after2)  # Should be True after cleanup (both gone)
`,
    ],
    { encoding: "utf-8", cwd: "/data/Projects/ai-dd", env: PY_ENV },
  ).trim();

  const lines = stdout.split("\n");
  assert.equal(lines[0], "True");
  assert.equal(lines[1], "True");
});
