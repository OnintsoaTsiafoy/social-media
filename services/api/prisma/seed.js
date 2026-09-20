import bcrypt from 'bcrypt';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);

  const user = await prisma.user.upsert({
    where: { email: 'lea@studio-vega.fr' },
    update: {},
    create: {
      email: 'lea@studio-vega.fr',
      passwordHash,
      firstName: 'Léa',
      lastName: 'Martin',
      displayName: 'Léa Martin',
      language: 'fr',
      timezone: 'Europe/Paris',
    },
  });

  // Administrateur de la plateforme : seul rôle qui ouvre la console web
  // (`admin-web/`) et l'API /api/v1/admin. Compte de démonstration, comme
  // celui de Léa : à remplacer avant tout environnement partagé.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@hootly.app' },
    update: { platformRole: 'PLATFORM_ADMIN' },
    create: {
      email: 'admin@hootly.app',
      passwordHash,
      firstName: 'Amine',
      lastName: 'Rahali',
      displayName: 'Amine Rahali',
      language: 'fr',
      timezone: 'Europe/Paris',
      platformRole: 'PLATFORM_ADMIN',
    },
  });

  // Mots-clés de modération de démonstration : créés une seule fois, jamais
  // réécrits — l'administrateur peut ensuite les modifier depuis la console.
  await prisma.platformSetting.upsert({
    where: { key: 'moderation.keywords' },
    update: {},
    create: {
      key: 'moderation.keywords',
      value: ['remboursement', 'arnaque', 'scandale', 'avocat', 'boycott', 'plainte'],
      version: 1,
      updatedByUserId: admin.id,
    },
  });

  await prisma.$transaction(async (tx) => {
    let brand = await tx.brand.findFirst({
      where: { ownerUserId: user.id, name: 'Studio Vega', deletedAt: null, status: 'ACTIVE' },
    });
    if (!brand) {
      brand = await tx.brand.create({
        data: {
          ownerUserId: user.id,
          name: 'Studio Vega',
          description: 'Agence créative de démonstration.',
          industry: 'Services',
          primaryLanguage: 'fr',
        },
      });
    }

    await tx.brandMember.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false } });
    await tx.brandMember.upsert({
      where: { brandId_userId: { brandId: brand.id, userId: user.id } },
      update: { role: 'OWNER', isActive: true },
      create: { brandId: brand.id, userId: user.id, role: 'OWNER', isActive: true },
    });

    const existingSettings = await tx.brandAiSetting.findFirst({ where: { brandId: brand.id } });
    if (!existingSettings) {
      await tx.brandAiSetting.create({
        data: {
          brandId: brand.id,
          version: 1,
          tone: 'PROFESSIONAL',
          formality: 'ADAPTIVE',
          language: 'fr',
          targetLength: '2 phrases',
          greeting: 'Bonjour {prénom},',
          closing: 'À très vite !',
          forbiddenTerms: [],
          recommendedTerms: [],
          complaintInstructions: 'Accuser réception, rester factuel et proposer une prise en charge.',
          urgencyInstructions: 'Escalader immédiatement les messages urgents à un responsable humain.',
          supportInstructions: 'Demander les informations minimales nécessaires en message privé.',
          createdByUserId: user.id,
        },
      });
    }
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
