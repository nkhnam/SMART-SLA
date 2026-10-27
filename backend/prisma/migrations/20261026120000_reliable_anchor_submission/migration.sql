ALTER TYPE "AnchorTransactionStatus" ADD VALUE 'SUBMISSION_UNCERTAIN';

ALTER TABLE "AnchorIntent"
ADD COLUMN "transactionChainId" INTEGER,
ADD COLUMN "relayerAddress" VARCHAR(42),
ADD COLUMN "signedTransaction" TEXT;

CREATE UNIQUE INDEX "AnchorIntent_transactionChainId_relayerAddress_relayerNonce_key"
ON "AnchorIntent"("transactionChainId", "relayerAddress", "relayerNonce");
