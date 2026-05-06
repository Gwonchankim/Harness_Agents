/*
  Warnings:

  - Added the required column `updatedAt` to the `QaAnswer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Run" ADD COLUMN "poModelId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QaAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "choiceIndex" INTEGER,
    "customText" TEXT,
    "value" TEXT NOT NULL,
    "isAutoJudged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QaAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QaSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QaAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QaQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QaAnswer" ("choiceIndex", "createdAt", "customText", "id", "isAutoJudged", "questionId", "sessionId", "value") SELECT "choiceIndex", "createdAt", "customText", "id", "isAutoJudged", "questionId", "sessionId", "value" FROM "QaAnswer";
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
    "regeneratedAt" DATETIME,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QaQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QaSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QaQuestion" ("createdAt", "id", "kind", "options", "order", "prompt", "sessionId", "staleAt", "status") SELECT "createdAt", "id", "kind", "options", "order", "prompt", "sessionId", "staleAt", "status" FROM "QaQuestion";
DROP TABLE "QaQuestion";
ALTER TABLE "new_QaQuestion" RENAME TO "QaQuestion";
CREATE INDEX "QaQuestion_sessionId_idx" ON "QaQuestion"("sessionId");
CREATE INDEX "QaQuestion_status_idx" ON "QaQuestion"("status");
CREATE UNIQUE INDEX "QaQuestion_sessionId_order_key" ON "QaQuestion"("sessionId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
