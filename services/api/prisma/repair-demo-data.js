// Exact, idempotent repairs for the demo data reported by the Android test.
// Run without arguments to preview; --apply writes only these known values.
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db/prisma.js';
import { updateAiSettings } from '../src/brands/service.js';
import { writeAuditLog } from '../src/lib/audit.js';

const corrections = {
  greeting: ['Bonjour {prÃ©nom},', 'Bonjour {prénom},'],
  closing: ['Ã€ trÃ¨s vite !', 'À très vite !'],
  complaintInstructions: ['Accuser rÃ©ception, rester factuel et proposer une prise en charge.', 'Accuser réception, rester factuel et proposer une prise en charge.'],
  urgencyInstructions: ['Escalader immÃ©diatement les messages urgents Ã  un responsable humain.', 'Escalader immédiatement les messages urgents à un responsable humain.'],
  supportInstructions: ['Demander les informations minimales nÃ©cessaires en message privÃ©.', 'Demander les informations minimales nécessaires en message privé.'],
};
try {
  const brand = await prisma.brand.findFirstOrThrow({ where: { name: 'Studio Vega', deletedAt: null,
    owner: { email: 'lea@studio-vega.fr' } } });
  const current = await prisma.brandAiSetting.findFirstOrThrow({ where: { brandId: brand.id }, orderBy: { version: 'desc' } });
  const changes = Object.fromEntries(Object.entries(corrections).filter(([field, [old]]) => current[field] === old).map(([field, [, next]]) => [field, next]));
  const brokenComment = await prisma.socialComment.findFirst({ where: {
    id: 'c0000000-0000-0000-0000-000000000004', socialAccount: { brandId: brand.id },
  }, select: { id: true } });
  const apply = process.argv.includes('--apply');
  if (apply && Object.keys(changes).length) {
    await updateAiSettings(brand.id, { ...changes, expectedVersion: current.version }, brand.ownerUserId, { requestId: randomUUID() });
  }
  if (apply && brokenComment) {
    await prisma.$transaction(async (tx) => {
      // PostgreSQL updates dependent FKs through ON UPDATE CASCADE.
      const id = 'c0000000-0000-4000-8000-000000000004';
      await tx.socialComment.update({ where: { id: brokenComment.id }, data: { id } });
      await tx.notification.updateMany({ where: { brandId: brand.id, resourceId: brokenComment.id }, data: { resourceId: id } });
      await writeAuditLog(tx, { userId: brand.ownerUserId, action: 'demo.comment_id_repaired', resourceType: 'social_comment',
        resourceId: id, requestId: randomUUID(), metadata: { previousId: brokenComment.id } });
    });
  }
  console.log(JSON.stringify({ applied: apply, correctedSettings: Object.keys(changes), correctedCommentId: Boolean(brokenComment) }));
} finally {
  await prisma.$disconnect();
}
