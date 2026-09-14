// Disposable Android reproduction data in the demo brand. Never calls Meta.
import assert from 'node:assert/strict';
import { prisma } from '../src/db/prisma.js';

const marker = 'rag-editor-regression';
try {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'lea@studio-vega.fr' } });
  const brand = await prisma.brand.findFirstOrThrow({ where: { name: 'Studio Vega', members: { some: { userId: user.id } } } });
  const accounts = { brandId: brand.id, connectedByUserId: user.id, externalAccountId: marker };
  if (process.argv.includes('--cleanup')) {
    const comments = await prisma.socialComment.findMany({ where: { socialAccount: accounts }, select: { id: true, suggestions: { select: { id: true } } } });
    const resourceIds = comments.flatMap((comment) => [comment.id, ...comment.suggestions.map((row) => row.id)]);
    await prisma.auditLog.deleteMany({ where: { userId: user.id, resourceId: { in: resourceIds } } });
    await prisma.socialAccount.deleteMany({ where: accounts });
  } else if (process.argv.includes('--reset')) {
    const comment = await prisma.socialComment.findFirstOrThrow({ where: { socialAccount: accounts } });
    const versions = await prisma.responseSuggestion.findMany({ where: { commentId: comment.id }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { userId: user.id, resourceId: { in: versions.map((row) => row.id) } } });
    await prisma.responseSuggestion.deleteMany({ where: { commentId: comment.id } });
    const text = 'Votre remboursement arrivera sous 5 jours ouvrés.';
    await prisma.responseSuggestion.create({ data: { commentId: comment.id, version: 1, text, originalText: text,
      generatedText: text, language: 'fr', tone: 'PROFESSIONAL', status: 'PROPOSED', generatedByAi: true,
      generator: marker, promptVersion: marker, createdByUserId: user.id, blocked: true,
      warnings: [{ code: 'unauthorised_promise', severity: 'blocking', message: 'La réponse engage la marque (remboursement, garantie, délai ou compensation).' }] } });
  } else if (process.argv.includes('--inspect')) {
    const rows = await prisma.responseSuggestion.findMany({ where: { comment: { socialAccount: accounts } }, orderBy: { version: 'asc' }, select: { version: true, text: true, status: true, blocked: true, warnings: true } });
    console.log(JSON.stringify(rows));
    assert.equal(await prisma.sentResponse.count({ where: { socialAccount: accounts } }), 0);
  } else {
    const account = await prisma.socialAccount.create({ data: { ...accounts, name: marker, provider: 'FACEBOOK', authMethod: 'FACEBOOK_PAGE' } });
    const text = 'Votre remboursement arrivera sous 5 jours ouvrés.';
    const comment = await prisma.socialComment.create({ data: { socialAccountId: account.id, externalCommentId: marker,
      authorName: 'Test correction RAG', content: 'Comment obtenir de l’aide pour ma commande ?',
      suggestions: { create: { version: 1, text, originalText: text, generatedText: text, language: 'fr', tone: 'PROFESSIONAL',
        status: 'PROPOSED', generatedByAi: true, generator: marker, promptVersion: marker, createdByUserId: user.id,
        blocked: true, warnings: [{ code: 'unauthorised_promise', severity: 'blocking', message: 'La réponse engage la marque (remboursement, garantie, délai ou compensation).' }] } },
    } });
    console.log(JSON.stringify({ commentId: comment.id, url: `hootly://comments/${comment.id}/response` }));
  }
} finally {
  await prisma.$disconnect();
}
