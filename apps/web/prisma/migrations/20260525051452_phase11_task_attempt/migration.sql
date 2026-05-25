-- CreateTable
CREATE TABLE "TaskAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "source" TEXT NOT NULL,
    "resultText" TEXT,
    "resultBytes" INTEGER,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskAttempt_taskId_idx" ON "TaskAttempt"("taskId");

-- CreateIndex
CREATE INDEX "TaskAttempt_runId_idx" ON "TaskAttempt"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAttempt_taskId_attemptNumber_key" ON "TaskAttempt"("taskId", "attemptNumber");
