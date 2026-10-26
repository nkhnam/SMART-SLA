-- CreateEnum
CREATE TYPE "SignatureCollectionStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'PARTIAL', 'COMPLETE', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "AnchorTransactionStatus" AS ENUM ('NOT_QUEUED', 'QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'REPLACED', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgreementPartyRole" AS ENUM ('BUYER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "AgreementSignatureParty" AS ENUM ('BUYER', 'SUPPLIER');

-- Recreate the enum so old DRAFT rows remain valid and new labels can be used in this migration.
ALTER TABLE "Agreement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "AgreementStatus" RENAME TO "AgreementStatus_legacy";
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'AWAITING_COUNTERPARTY', 'AWAITING_SIGNATURES', 'ANCHOR_PENDING', 'ANCHOR_CONFIRMED', 'ANCHOR_FAILED', 'REJECTED', 'CANCELLED');
ALTER TABLE "Agreement" ALTER COLUMN "status" TYPE "AgreementStatus" USING ("status"::text::"AgreementStatus");
ALTER TABLE "Agreement" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "AgreementStatus_legacy";

-- AlterTable
ALTER TABLE "Agreement" ADD COLUMN     "blockchainStatus" "AnchorTransactionStatus" NOT NULL DEFAULT 'NOT_QUEUED',
ADD COLUMN     "signatureStatus" "SignatureCollectionStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateTable
CREATE TABLE "AgreementInvitation" (
    "id" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "inviterOrganizationId" UUID NOT NULL,
    "invitedOrganizationId" UUID NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementParticipant" (
    "id" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "organizationId" UUID NOT NULL,
    "role" "AgreementPartyRole" NOT NULL,
    "authorizedSignerId" UUID,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizedSigner" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizedSigner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignerChallenge" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "nonce" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignerChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningSnapshot" (
    "id" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "buyerOrganizationId" UUID NOT NULL,
    "supplierOrganizationId" UUID NOT NULL,
    "buyerSigner" VARCHAR(42) NOT NULL,
    "supplierSigner" VARCHAR(42) NOT NULL,
    "buyerAuthorizedSignerId" UUID NOT NULL,
    "supplierAuthorizedSignerId" UUID NOT NULL,
    "canonicalPayload" TEXT NOT NULL,
    "snapshotHash" CHAR(66) NOT NULL,
    "agreementKey" CHAR(66) NOT NULL,
    "nonce" BIGINT NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "signatureStatus" "SignatureCollectionStatus" NOT NULL DEFAULT 'PENDING',
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SigningSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementSignature" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "party" "AgreementSignatureParty" NOT NULL,
    "authorizedSignerId" UUID NOT NULL,
    "signerAddress" VARCHAR(42) NOT NULL,
    "signature" VARCHAR(132) NOT NULL,
    "digest" CHAR(66) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnchorIntent" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(64) NOT NULL,
    "status" "AnchorTransactionStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "relayerNonce" BIGINT,
    "transactionHash" VARCHAR(66),
    "replacementHash" VARCHAR(66),
    "lastError" VARCHAR(2000),
    "leaseOwner" VARCHAR(120),
    "leaseUntil" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnchorIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgreementInvitation_invitedOrganizationId_status_expiresAt_idx" ON "AgreementInvitation"("invitedOrganizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AgreementInvitation_inviterOrganizationId_createdAt_idx" ON "AgreementInvitation"("inviterOrganizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementInvitation_agreementId_agreementVersion_key" ON "AgreementInvitation"("agreementId", "agreementVersion");

-- CreateIndex
CREATE INDEX "AgreementParticipant_organizationId_acceptedAt_idx" ON "AgreementParticipant"("organizationId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementParticipant_agreementId_agreementVersion_organizat_key" ON "AgreementParticipant"("agreementId", "agreementVersion", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementParticipant_agreementId_agreementVersion_role_key" ON "AgreementParticipant"("agreementId", "agreementVersion", "role");

-- CreateIndex
CREATE INDEX "AuthorizedSigner_organizationId_revokedAt_idx" ON "AuthorizedSigner"("organizationId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizedSigner_organizationId_address_key" ON "AuthorizedSigner"("organizationId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "SignerChallenge_nonce_key" ON "SignerChallenge"("nonce");

-- CreateIndex
CREATE INDEX "SignerChallenge_organizationId_userId_expiresAt_idx" ON "SignerChallenge"("organizationId", "userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SigningSnapshot_agreementKey_key" ON "SigningSnapshot"("agreementKey");

-- CreateIndex
CREATE INDEX "SigningSnapshot_buyerOrganizationId_createdAt_idx" ON "SigningSnapshot"("buyerOrganizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SigningSnapshot_supplierOrganizationId_createdAt_idx" ON "SigningSnapshot"("supplierOrganizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SigningSnapshot_agreementId_version_key" ON "SigningSnapshot"("agreementId", "version");

-- CreateIndex
CREATE INDEX "AgreementSignature_authorizedSignerId_submittedAt_idx" ON "AgreementSignature"("authorizedSignerId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSignature_snapshotId_party_key" ON "AgreementSignature"("snapshotId", "party");

-- CreateIndex
CREATE UNIQUE INDEX "AnchorIntent_snapshotId_key" ON "AnchorIntent"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "AnchorIntent_idempotencyKey_key" ON "AnchorIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AnchorIntent_transactionHash_key" ON "AnchorIntent"("transactionHash");

-- CreateIndex
CREATE INDEX "AnchorIntent_status_leaseUntil_createdAt_idx" ON "AnchorIntent"("status", "leaseUntil", "createdAt");

-- AddForeignKey
ALTER TABLE "AgreementInvitation" ADD CONSTRAINT "AgreementInvitation_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementInvitation" ADD CONSTRAINT "AgreementInvitation_inviterOrganizationId_fkey" FOREIGN KEY ("inviterOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementInvitation" ADD CONSTRAINT "AgreementInvitation_invitedOrganizationId_fkey" FOREIGN KEY ("invitedOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementInvitation" ADD CONSTRAINT "AgreementInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementInvitation" ADD CONSTRAINT "AgreementInvitation_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementParticipant" ADD CONSTRAINT "AgreementParticipant_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementParticipant" ADD CONSTRAINT "AgreementParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementParticipant" ADD CONSTRAINT "AgreementParticipant_authorizedSignerId_fkey" FOREIGN KEY ("authorizedSignerId") REFERENCES "AuthorizedSigner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizedSigner" ADD CONSTRAINT "AuthorizedSigner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizedSigner" ADD CONSTRAINT "AuthorizedSigner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignerChallenge" ADD CONSTRAINT "SignerChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignerChallenge" ADD CONSTRAINT "SignerChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSnapshot" ADD CONSTRAINT "SigningSnapshot_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSnapshot" ADD CONSTRAINT "SigningSnapshot_agreementId_version_fkey" FOREIGN KEY ("agreementId", "version") REFERENCES "AgreementVersion"("agreementId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSnapshot" ADD CONSTRAINT "SigningSnapshot_buyerOrganizationId_fkey" FOREIGN KEY ("buyerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSnapshot" ADD CONSTRAINT "SigningSnapshot_supplierOrganizationId_fkey" FOREIGN KEY ("supplierOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSnapshot" ADD CONSTRAINT "SigningSnapshot_buyerAuthorizedSignerId_fkey" FOREIGN KEY ("buyerAuthorizedSignerId") REFERENCES "AuthorizedSigner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSnapshot" ADD CONSTRAINT "SigningSnapshot_supplierAuthorizedSignerId_fkey" FOREIGN KEY ("supplierAuthorizedSignerId") REFERENCES "AuthorizedSigner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSignature" ADD CONSTRAINT "AgreementSignature_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SigningSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSignature" ADD CONSTRAINT "AgreementSignature_authorizedSignerId_fkey" FOREIGN KEY ("authorizedSignerId") REFERENCES "AuthorizedSigner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnchorIntent" ADD CONSTRAINT "AnchorIntent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SigningSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
