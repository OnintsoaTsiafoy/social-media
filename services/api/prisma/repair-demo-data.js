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
const brandCorrections = {
  description: ['Agence crÃ©ative de dÃ©monstration.', 'Agence créative de démonstration.'],
};
// La corruption du gabarit (accueil/signature) a été gelée dans le texte des
// générations déjà enregistrées : corriger `brand_ai_settings` ne les change
// pas rétroactivement. On répare donc aussi ces fragments, par sous-chaîne,
// dans chaque colonne de texte des propositions de la marque.
const suggestionFragments = [corrections.greeting, corrections.closing];
const repairText = (value) =>
  value == null ? value : suggestionFragments.reduce((acc, [old, next]) => acc.split(old).join(next), value);
try {
  const brand = await prisma.brand.findFirstOrThrow({ where: { name: 'Studio Vega', deletedAt: null,
    owner: { email: 'lea@studio-vega.fr' } } });
  const current = await prisma.brandAiSetting.findFirstOrThrow({ where: { brandId: brand.id }, orderBy: { version: 'desc' } });
  const changes = Object.fromEntries(Object.entries(corrections).filter(([field, [old]]) => current[field] === old).map(([field, [, next]]) => [field, next]));
  const brandChanges = Object.fromEntries(Object.entries(brandCorrections).filter(([field, [old]]) => brand[field] === old).map(([field, [, next]]) => [field, next]));
  const brokenComment = await prisma.socialComment.findFirst({ where: {
    id: 'c0000000-0000-0000-0000-000000000004', socialAccount: { brandId: brand.id },
  }, select: { id: true } });
  const affectedSuggestions = await prisma.responseSuggestion.findMany({
    where: {
      comment: { socialAccount: { brandId: brand.id } },
      OR: suggestionFragments.flatMap(([old]) => [
        { text: { contains: old } },
        { originalText: { contains: old } },
        { generatedText: { contains: old } },
        { finalText: { contains: old } },
      ]),
    },
    select: { id: true, text: true, originalText: true, generatedText: true, finalText: true },
  });
  const apply = process.argv.includes('--apply');
  if (apply && Object.keys(changes).length) {
    await updateAiSettings(brand.id, { ...changes, expectedVersion: current.version }, brand.ownerUserId, { requestId: randomUUID() });
  }
  if (apply && Object.keys(brandChanges).length) {
    await prisma.brand.update({ where: { id: brand.id }, data: brandChanges });
  }
  if (apply && affectedSuggestions.length) {
    await prisma.$transaction(affectedSuggestions.map((row) => prisma.responseSuggestion.update({
      where: { id: row.id },
      data: {
        text: repairText(row.text),
        originalText: repairText(row.originalText),
        generatedText: repairText(row.generatedText),
        finalText: repairText(row.finalText),
      },
    })));
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
  console.log(JSON.stringify({
    applied: apply,
    correctedSettings: Object.keys(changes),
    correctedBrandFields: Object.keys(brandChanges),
    correctedCommentId: Boolean(brokenComment),
    correctedSuggestionIds: affectedSuggestions.map((row) => row.id),
  }));
} finally {
  await prisma.$disconnect();
}
