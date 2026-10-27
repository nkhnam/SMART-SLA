-- CreateEnum
CREATE TYPE "MonitoringSourceType" AS ENUM ('HTTP_PROBE', 'SIGNED_WEBHOOK');

-- CreateEnum
CREATE TYPE "MonitoringTrustCategory" AS ENUM ('OPERATOR_COLLECTED', 'PROVIDER_REPORTED', 'SYNTHETIC_TEST');

-- CreateEnum
CREATE TYPE "MonitoringRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MonitoringErrorCategory" AS ENUM ('TIMEOUT', 'DNS', 'CONNECTION', 'TLS', 'HTTP', 'RESPONSE_TOO_LARGE', 'INVALID_RESPONSE');

-- CreateEnum
CREATE TYPE "ObservationValidity" AS ENUM ('VALID', 'INVALID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "KpiState" AS ENUM ('HEALTHY', 'DEGRADED', 'BREACH_CANDIDATE', 'UNKNOWN', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "EvidenceAnchorStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'RECONCILIATION_REQUIRED');

-- CreateTable
CREATE TABLE "MonitoringSource" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "type" "MonitoringSourceType" NOT NULL,
    "trustCategory" "MonitoringTrustCategory" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "endpointUrl" VARCHAR(2048),
    "encryptedWebhookSecret" TEXT,
    "intervalSeconds" INTEGER NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "leaseOwner" VARCHAR(120),
    "leaseUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringRun" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "MonitoringRunStatus" NOT NULL DEFAULT 'RUNNING',
    "errorCategory" "MonitoringErrorCategory",
    "errorCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringObservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "sourceId" UUID NOT NULL,
    "runId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "webhookNonce" VARCHAR(128),
    "trustCategory" "MonitoringTrustCategory" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "method" "MonitoringSourceType" NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "reachable" BOOLEAN,
    "errorCategory" "MonitoringErrorCategory",
    "probeDurationMs" INTEGER,
    "collectionRegion" VARCHAR(80),
    "agentIdentity" VARCHAR(120),
    "validity" "ObservationValidity" NOT NULL DEFAULT 'VALID',
    "validityReason" VARCHAR(160),
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "rawMetadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "MonitoringObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiEvaluation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "sourceId" UUID NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "algorithmVersion" VARCHAR(40) NOT NULL,
    "latencyStatistic" VARCHAR(16) NOT NULL,
    "expectedSamples" INTEGER NOT NULL,
    "healthyObservations" INTEGER NOT NULL,
    "failedObservations" INTEGER NOT NULL,
    "unknownObservations" INTEGER NOT NULL,
    "coveragePercent" DECIMAL(5,2) NOT NULL,
    "uptimePercent" DECIMAL(5,2),
    "meanLatencyMs" DECIMAL(12,2),
    "state" "KpiState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachCandidate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "evaluationId" UUID NOT NULL,
    "state" "KpiState" NOT NULL,
    "summary" VARCHAR(240) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreachCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "schemaVersion" VARCHAR(48) NOT NULL,
    "algorithmVersion" VARCHAR(40) NOT NULL,
    "merkleRoot" CHAR(66) NOT NULL,
    "batchDigest" CHAR(66) NOT NULL,
    "observationCount" INTEGER NOT NULL,
    "canonicalManifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "leafIndex" INTEGER NOT NULL,
    "leafDigest" CHAR(66) NOT NULL,
    "canonicalRecord" JSONB NOT NULL,
    "inclusionProof" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceAnchorIntent" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "anchorKey" CHAR(66) NOT NULL,
    "status" "EvidenceAnchorStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "transactionChainId" INTEGER,
    "relayerAddress" VARCHAR(42),
    "relayerNonce" BIGINT,
    "signedTransaction" TEXT,
    "transactionHash" VARCHAR(66),
    "lastError" VARCHAR(160),
    "leaseOwner" VARCHAR(120),
    "leaseUntil" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceAnchorIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitoringSource_organizationId_agreementId_agreementVersio_idx" ON "MonitoringSource"("organizationId", "agreementId", "agreementVersion", "enabled");

-- CreateIndex
CREATE INDEX "MonitoringSource_enabled_nextRunAt_leaseUntil_idx" ON "MonitoringSource"("enabled", "nextRunAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringSource_id_agreementId_agreementVersion_organizati_key" ON "MonitoringSource"("id", "agreementId", "agreementVersion", "organizationId");

-- CreateIndex
CREATE INDEX "MonitoringRun_status_createdAt_idx" ON "MonitoringRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringRun_sourceId_scheduledFor_key" ON "MonitoringRun"("sourceId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringObservation_runId_key" ON "MonitoringObservation"("runId");

-- CreateIndex
CREATE INDEX "MonitoringObservation_agreementId_agreementVersion_observed_idx" ON "MonitoringObservation"("agreementId", "agreementVersion", "observedAt");

-- CreateIndex
CREATE INDEX "MonitoringObservation_organizationId_agreementId_observedAt_idx" ON "MonitoringObservation"("organizationId", "agreementId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringObservation_sourceId_idempotencyKey_key" ON "MonitoringObservation"("sourceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringObservation_sourceId_webhookNonce_key" ON "MonitoringObservation"("sourceId", "webhookNonce");

-- CreateIndex
CREATE INDEX "KpiEvaluation_agreementId_agreementVersion_windowStart_wind_idx" ON "KpiEvaluation"("agreementId", "agreementVersion", "windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "KpiEvaluation_organizationId_createdAt_idx" ON "KpiEvaluation"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KpiEvaluation_sourceId_windowStart_windowEnd_algorithmVersi_key" ON "KpiEvaluation"("sourceId", "windowStart", "windowEnd", "algorithmVersion");

-- CreateIndex
CREATE UNIQUE INDEX "BreachCandidate_evaluationId_key" ON "BreachCandidate"("evaluationId");

-- CreateIndex
CREATE INDEX "BreachCandidate_agreementId_agreementVersion_createdAt_idx" ON "BreachCandidate"("agreementId", "agreementVersion", "createdAt");

-- CreateIndex
CREATE INDEX "BreachCandidate_organizationId_createdAt_idx" ON "BreachCandidate"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceBatch_organizationId_agreementId_agreementVersion_c_idx" ON "EvidenceBatch"("organizationId", "agreementId", "agreementVersion", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceBatch_agreementId_agreementVersion_windowStart_wind_key" ON "EvidenceBatch"("agreementId", "agreementVersion", "windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "EvidenceRecord_observationId_idx" ON "EvidenceRecord"("observationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_batchId_leafIndex_key" ON "EvidenceRecord"("batchId", "leafIndex");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_batchId_observationId_key" ON "EvidenceRecord"("batchId", "observationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceAnchorIntent_batchId_key" ON "EvidenceAnchorIntent"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceAnchorIntent_anchorKey_key" ON "EvidenceAnchorIntent"("anchorKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceAnchorIntent_transactionHash_key" ON "EvidenceAnchorIntent"("transactionHash");

-- CreateIndex
CREATE INDEX "EvidenceAnchorIntent_status_leaseUntil_createdAt_idx" ON "EvidenceAnchorIntent"("status", "leaseUntil", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceAnchorIntent_transactionChainId_relayerAddress_rela_key" ON "EvidenceAnchorIntent"("transactionChainId", "relayerAddress", "relayerNonce");

-- AddForeignKey
ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_agreementId_agreementVersion_fkey" FOREIGN KEY ("agreementId", "agreementVersion") REFERENCES "AgreementVersion"("agreementId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringRun" ADD CONSTRAINT "MonitoringRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MonitoringSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_sourceId_agreementId_agreementVersio_fkey" FOREIGN KEY ("sourceId", "agreementId", "agreementVersion", "organizationId") REFERENCES "MonitoringSource"("id", "agreementId", "agreementVersion", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_agreementId_agreementVersion_fkey" FOREIGN KEY ("agreementId", "agreementVersion") REFERENCES "AgreementVersion"("agreementId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MonitoringRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiEvaluation" ADD CONSTRAINT "KpiEvaluation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiEvaluation" ADD CONSTRAINT "KpiEvaluation_agreementId_agreementVersion_fkey" FOREIGN KEY ("agreementId", "agreementVersion") REFERENCES "AgreementVersion"("agreementId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiEvaluation" ADD CONSTRAINT "KpiEvaluation_sourceId_agreementId_agreementVersion_organi_fkey" FOREIGN KEY ("sourceId", "agreementId", "agreementVersion", "organizationId") REFERENCES "MonitoringSource"("id", "agreementId", "agreementVersion", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachCandidate" ADD CONSTRAINT "BreachCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachCandidate" ADD CONSTRAINT "BreachCandidate_agreementId_agreementVersion_fkey" FOREIGN KEY ("agreementId", "agreementVersion") REFERENCES "AgreementVersion"("agreementId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachCandidate" ADD CONSTRAINT "BreachCandidate_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "KpiEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceBatch" ADD CONSTRAINT "EvidenceBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceBatch" ADD CONSTRAINT "EvidenceBatch_agreementId_agreementVersion_fkey" FOREIGN KEY ("agreementId", "agreementVersion") REFERENCES "AgreementVersion"("agreementId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EvidenceBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "MonitoringObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAnchorIntent" ADD CONSTRAINT "EvidenceAnchorIntent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EvidenceBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_intervalSeconds_check" CHECK ("intervalSeconds" BETWEEN 60 AND 3600);
ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_retentionDays_check" CHECK ("retentionDays" BETWEEN 30 AND 365);
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_latencyMs_check" CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0);
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_httpStatus_check" CHECK ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599);
ALTER TABLE "KpiEvaluation" ADD CONSTRAINT "KpiEvaluation_window_check" CHECK ("windowEnd" > "windowStart");
CREATE FUNCTION protect_anchored_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM "EvidenceRecord" WHERE "observationId" = OLD."id") THEN RAISE EXCEPTION 'anchored observations are immutable'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "MonitoringObservation_append_only" BEFORE UPDATE OR DELETE ON "MonitoringObservation" FOR EACH ROW EXECUTE FUNCTION protect_anchored_observation();

