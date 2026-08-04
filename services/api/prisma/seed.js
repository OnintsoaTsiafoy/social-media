import bcrypt from 'bcrypt';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);

  await prisma.user.upsert({
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
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
