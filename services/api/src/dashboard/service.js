import { commentsCounts, listComments } from '../comments/service.js';
import { prisma } from '../db/prisma.js';
import { publicationInclude, toPublicPublications } from '../publications/service.js';

// Sprint 12 Jour 4 : trois routes indépendantes plutôt qu'un seul payload
// combiné, pour préserver le comportement déjà documenté de
// app/(tabs)/home.tsx (« a failing analytics call must not stop the priority
// comments from rendering ») — chaque section de l'écran d'accueil charge
// et échoue indépendamment des deux autres. Aucune des trois ne réimplémente
// une requête : elles composent des fonctions déjà écrites pour
// comments/publications.

export async function dashboardSummary(brandId) {
  const [scheduledCount, counts] = await Promise.all([
    prisma.publication.count({ where: { brandId, status: 'SCHEDULED', deletedAt: null } }),
    commentsCounts(brandId),
  ]);
  return {
    scheduledCount,
    newCommentCount: counts.untreated,
    highPriorityCount: counts.highPriority,
    pendingAiResponseCount: counts.pendingAiResponses,
  };
}

export async function dashboardPriorityComments(brandId) {
  const { items } = await listComments(brandId, {
    status: 'new',
    priority: 'high',
    sort: 'priority',
    page: 1,
    pageSize: 3,
  });
  return items;
}

export async function dashboardUpcomingPublications(brandId) {
  const records = await prisma.publication.findMany({
    where: { brandId, status: 'SCHEDULED', deletedAt: null },
    include: publicationInclude,
    orderBy: { scheduledAt: 'asc' },
    take: 3,
  });
  return toPublicPublications(records);
}
