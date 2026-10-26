import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash as hashPassword } from "@node-rs/argon2";
import { z } from "zod";
import { MembershipRole, OrganizationType, PrismaClient } from "../src/generated/prisma/client.js";

const seedInput = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  NODE_ENV: z.literal("development"),
  SEED_OWNER_EMAIL: z.string().email(),
  SEED_OWNER_PASSWORD: z.string().min(12).max(128),
  SEED_DISPLAY_NAME: z.string().min(1).max(120),
  SEED_ORGANIZATION_NAME: z.string().min(1).max(160),
  SEED_ORGANIZATION_TYPE: z.nativeEnum(OrganizationType).default(OrganizationType.CUSTOMER)
}).parse(process.env);

const connectionString = seedInput.DATABASE_URL;
const email = seedInput.SEED_OWNER_EMAIL.normalize("NFC").trim().toLowerCase();
const organizationId = "00000000-0000-4000-8000-000000000001";
const passwordHash = await hashPassword(seedInput.SEED_OWNER_PASSWORD);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      displayName: seedInput.SEED_DISPLAY_NAME.normalize("NFC").trim()
    },
    update: { displayName: seedInput.SEED_DISPLAY_NAME.normalize("NFC").trim() },
    select: { id: true }
  });
  await prisma.organization.upsert({
    where: { id: organizationId },
    create: {
      id: organizationId,
      name: seedInput.SEED_ORGANIZATION_NAME.normalize("NFC").trim(),
      organizationType: seedInput.SEED_ORGANIZATION_TYPE
    },
    update: {
      name: seedInput.SEED_ORGANIZATION_NAME.normalize("NFC").trim(),
      organizationType: seedInput.SEED_ORGANIZATION_TYPE
    }
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    create: { userId: user.id, organizationId, role: MembershipRole.OWNER },
    update: { role: MembershipRole.OWNER }
  });
  process.stdout.write(`Seeded development account ${email} in ${seedInput.SEED_ORGANIZATION_NAME}.\n`);
} finally {
  await prisma.$disconnect();
}
