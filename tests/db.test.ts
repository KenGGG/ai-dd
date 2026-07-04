import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidda-db-test-"));
process.env.AIDDA_DATA_DIR = tempDir;
process.env.AIDDA_DB_PATH = path.join(tempDir, "aidda.sqlite");

const dbModule = await import("../server/db.ts");

test.after(() => {
  dbModule.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("project records can be created, updated, listed, and deleted", () => {
  const created = dbModule.upsertProject({
    id: "test-project",
    name: "AIDDA-300750-宁德时代-公告尽调",
    stockCode: "300750.SZ",
    stockName: "宁德时代",
    notebookId: "notebook-1",
  });

  assert.equal(created.id, "test-project");
  assert.equal(created.status, "idle");
  assert.equal(dbModule.listProjects().length, 1);

  const updated = dbModule.updateProject("test-project", {
    status: "completed",
    currentStep: 3,
    downloadSuccess: 2,
    uploadSuccess: 2,
  });

  assert.equal(updated?.status, "completed");
  assert.equal(updated?.currentStep, 3);
  assert.equal(updated?.uploadSuccess, 2);

  dbModule.deleteProject("test-project");
  assert.equal(dbModule.getProject("test-project"), null);
});

test("jobs are recorded against a project lifecycle", () => {
  dbModule.upsertProject({
    id: "job-project",
    name: "AIDDA-000001-平安银行-公告尽调",
    stockCode: "000001.SZ",
  });

  const jobId = dbModule.createJob("job-project", "download_and_upload");
  dbModule.finishJob(jobId, "completed", "done");

  const job = dbModule.getJob(jobId);
  assert.equal(job.status, "completed");
  assert.equal(job.output, "done");
  assert.equal(dbModule.listJobs("job-project").length, 1);
});

test("interrupted running jobs are recovered as failed", () => {
  dbModule.upsertProject({
    id: "interrupted-project",
    name: "AIDDA-600000-浦发银行-公告尽调",
    stockCode: "600000.SH",
    status: "downloading",
    currentStep: 1,
  });
  const jobId = dbModule.createJob("interrupted-project", "download_and_upload");

  const recovery = dbModule.recoverInterruptedJobs("test restart");
  const job = dbModule.getJob(jobId);
  const project = dbModule.getProject("interrupted-project");

  assert.equal(recovery.jobsRecovered, 1);
  assert.equal(recovery.projectsRecovered, 1);
  assert.equal(job.status, "failed");
  assert.equal(job.error, "test restart");
  assert.equal(project?.status, "failed");
  assert.equal(project?.error, "test restart");
});
