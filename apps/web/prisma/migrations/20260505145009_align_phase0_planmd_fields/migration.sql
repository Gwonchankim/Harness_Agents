/*
  Warnings:

  - You are about to drop the column `label` on the `ModelCatalog` table. All the data in the column will be lost.
  - You are about to drop the column `endedAt` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `outputs` on the `Task` table. All the data in the column will be lost.
  - Added the required column `displayName` to the `ModelCatalog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `modelId` to the `ModelCatalog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taskKey` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ModelCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpointType" TEXT NOT NULL DEFAULT 'openai-compat',
    "costTier" TEXT NOT NULL DEFAULT 'standard',
    "speedTier" TEXT NOT NULL DEFAULT 'standard',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recommendedUse" TEXT,
    "contextWindow" INTEGER,
    "maxOutputTokens" INTEGER,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ModelCatalog" ("contextWindow", "createdAt", "enabled", "id", "isDefault", "maxOutputTokens", "metadata", "provider", "supportsTools", "updatedAt") SELECT "contextWindow", "createdAt", "enabled", "id", "isDefault", "maxOutputTokens", "metadata", "provider", "supportsTools", "updatedAt" FROM "ModelCatalog";
DROP TABLE "ModelCatalog";
ALTER TABLE "new_ModelCatalog" RENAME TO "ModelCatalog";
CREATE UNIQUE INDEX "ModelCatalog_modelId_key" ON "ModelCatalog"("modelId");
CREATE INDEX "ModelCatalog_provider_idx" ON "ModelCatalog"("provider");
CREATE INDEX "ModelCatalog_enabled_idx" ON "ModelCatalog"("enabled");
CREATE TABLE "new_QaAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "choiceIndex" INTEGER,
    "customText" TEXT,
    "value" TEXT NOT NULL,
    "isAutoJudged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QaAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QaSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QaAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QaQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QaAnswer" ("createdAt", "id", "questionId", "sessionId", "value") SELECT "createdAt", "id", "questionId", "sessionId", "value" FROM "QaAnswer";
DROP TABLE "QaAnswer";
ALTER TABLE "new_QaAnswer" RENAME TO "QaAnswer";
CREATE INDEX "QaAnswer_sessionId_idx" ON "QaAnswer"("sessionId");
CREATE INDEX "QaAnswer_isAutoJudged_idx" ON "QaAnswer"("isAutoJudged");
CREATE UNIQUE INDEX "QaAnswer_sessionId_questionId_key" ON "QaAnswer"("sessionId", "questionId");
CREATE TABLE "new_QaQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "staleAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QaQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QaSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QaQuestion" ("createdAt", "id", "kind", "options", "order", "prompt", "sessionId") SELECT "createdAt", "id", "kind", "options", "order", "prompt", "sessionId" FROM "QaQuestion";
DROP TABLE "QaQuestion";
ALTER TABLE "new_QaQuestion" RENAME TO "QaQuestion";
CREATE INDEX "QaQuestion_sessionId_idx" ON "QaQuestion"("sessionId");
CREATE INDEX "QaQuestion_status_idx" ON "QaQuestion"("status");
CREATE UNIQUE INDEX "QaQuestion_sessionId_order_key" ON "QaQuestion"("sessionId", "order");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "planId" TEXT,
    "agentId" TEXT,
    "taskKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedOutput" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dependencies" TEXT NOT NULL DEFAULT '[]',
    "inputs" TEXT,
    "result" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ExecutionPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("agentId", "createdAt", "dependencies", "description", "id", "inputs", "name", "runId", "startedAt", "status", "updatedAt") SELECT "agentId", "createdAt", "dependencies", "description", "id", "inputs", "name", "runId", "startedAt", "status", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_runId_idx" ON "Task"("runId");
CREATE INDEX "Task_planId_idx" ON "Task"("planId");
CREATE INDEX "Task_agentId_idx" ON "Task"("agentId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE UNIQUE INDEX "Task_planId_taskKey_key" ON "Task"("planId", "taskKey");
CREATE TABLE "new_Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "leadAgentId" TEXT,
    "currentRevisionId" TEXT,
    "score" REAL,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Team_leadAgentId_fkey" FOREIGN KEY ("leadAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Team_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "TeamRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("createdAt", "description", "id", "name", "projectId", "status", "updatedAt") SELECT "createdAt", "description", "id", "name", "projectId", "status", "updatedAt" FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE INDEX "Team_projectId_idx" ON "Team"("projectId");
CREATE INDEX "Team_leadAgentId_idx" ON "Team"("leadAgentId");
CREATE INDEX "Team_currentRevisionId_idx" ON "Team"("currentRevisionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
