import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { writeAuditLog } from '../lib/audit.js';

const toneToDb = {
  professional: 'PROFESSIONAL',
  friendly: 'FRIENDLY',
  empathetic: 'EMPATHETIC',
  formal: 'FORMAL',
  custom: 'CUSTOM',
};

const toneFromDb = Object.fromEntries(Object.entries(toneToDb).map(([key, value]) => [value, key]));
const formalityToDb = { informal: 'INFORMAL', formal: 'FORMAL', adaptive: 'ADAPTIVE' };
const formalityFromDb = Object.fromEntries(Object.entries(formalityToDb).map(([key, value]) => [value, key]));

const latestSettingsInclude = {
  aiSettings: { orderBy: { version: 'desc' }, take: 1 },
};

function asStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function toPublicAiSettings(record) {
  if (!record) {
    return {
      version: 0,
      tone: 'professional',
      customTone: null,
      formality: 'adaptive',
      language: 'fr',
      useInformalAddress: false,
      emojisAllowed: true,
      targetLength: '2 phrases',
      greeting: '',
      closing: '',
      forbiddenTerms: [],
      recommendedTerms: [],
      instructions: '',
      complaintInstructions: '',
      urgencyInstructions: '',
      supportInstructions: '',
    };
  }

  return {
    version: record.version,
    tone: toneFromDb[record.tone],
    customTone: record.customTone,
    formality: formalityFromDb[record.formality],
    language: record.language,
    useInformalAddress: record.formality === 'INFORMAL',
    emojisAllowed: record.emojisAllowed,
    targetLength: record.targetLength,
    greeting: record.greeting ?? '',
    closing: record.closing ?? '',
    forbiddenTerms: asStringList(record.forbiddenTerms),
    recommendedTerms: asStringList(record.recommendedTerms),
    instructions: record.instructions ?? '',
    complaintInstructions: record.complaintInstructions ?? '',
    urgencyInstructions: record.urgencyInstructions ?? '',
    supportInstructions: record.supportInstructions ?? '',
  };
}

export function toPublicBrand(brand, membership) {
  const settings = toPublicAiSettings(brand.aiSettings?.[0]);
  return {
    id: brand.id,
    name: brand.name,
    description: brand.description ?? '',
    sector: brand.industry ?? '',
    primaryLanguage: brand.primaryLanguage,
    secondaryLanguages: [],
    role: membership?.role,
    isActive: membership?.isActive ?? false,
    status: brand.status.toLowerCase(),
    ...settings,
    bannedTerms: settings.forbiddenTerms,
    // Kept for the existing mobile screen; the three specific fields remain available too.
    escalationRule: settings.urgencyInstructions || settings.complaintInstructions || settings.instructions,
    connectedAccountIds: [],
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
  };
}

function brandDataFromPayload(payload) {
  return {
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    ...(payload.industry !== undefined ? { industry: payload.industry } : {}),
    ...(payload.primaryLanguage !== undefined ? { primaryLanguage: payload.primaryLanguage } : {}),
  };
}

function settingsDataFromPayload(payload, current) {
  const tone = payload.tone ?? toneFromDb[current.tone];
  const formality = payload.formality ?? formalityFromDb[current.formality];
  const forbiddenTerms = payload.forbiddenTerms ?? asStringList(current.forbiddenTerms);
  const recommendedTerms = payload.recommendedTerms ?? asStringList(current.recommendedTerms);

  return {
    tone: toneToDb[tone],
    customTone: payload.customTone !== undefined ? payload.customTone : current.customTone,
    formality: formalityToDb[formality],
    language: payload.language ?? current.language,
    emojisAllowed: payload.emojisAllowed ?? current.emojisAllowed,
    targetLength: payload.targetLength ?? current.targetLength,
    greeting: payload.greeting !== undefined ? payload.greeting : current.greeting,
    closing: payload.closing !== undefined ? payload.closing : current.closing,
    forbiddenTerms: [...new Set(forbiddenTerms.map((term) => term.trim()))],
    recommendedTerms: [...new Set(recommendedTerms.map((term) => term.trim()))],
    instructions: payload.instructions !== undefined ? payload.instructions : current.instructions,
    complaintInstructions:
      payload.complaintInstructions !== undefined ? payload.complaintInstructions : current.complaintInstructions,
    urgencyInstructions: payload.urgencyInstructions !== undefined ? payload.urgencyInstructions : current.urgencyInstructions,
    supportInstructions:
      payload.supportInstructions !== undefined ? payload.supportInstructions : current.supportInstructions,
  };
}

export async function activeBrandForUser(userId) {
  const membership = await prisma.brandMember.findFirst({
    where: { userId, isActive: true, brand: { deletedAt: null, status: 'ACTIVE' } },
    include: { brand: { include: latestSettingsInclude } },
  });
  return membership ? toPublicBrand(membership.brand, membership) : null;
}

export async function listBrands(userId, filters) {
  const where = {
    userId,
    brand: {
      deletedAt: null,
      status: 'ACTIVE',
      ...(filters.search ? { name: { contains: filters.search, mode: 'insensitive' } } : {}),
    },
    ...(filters.active === 'true' ? { isActive: true } : {}),
  };
  const [total, memberships] = await prisma.$transaction([
    prisma.brandMember.count({ where }),
    prisma.brandMember.findMany({
      where,
      include: { brand: { include: latestSettingsInclude } },
      orderBy: [{ isActive: 'desc' }, { brand: { name: 'asc' } }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  return {
    items: memberships.map((membership) => toPublicBrand(membership.brand, membership)),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
  };
}

export async function getBrand(brandId, membership) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, include: latestSettingsInclude });
  if (!brand || brand.deletedAt || brand.status !== 'ACTIVE') {
    throw new HttpError(404, 'not_found', 'Marque introuvable.');
  }
  return toPublicBrand(brand, membership);
}

export async function createBrand(userId, payload, request) {
  return prisma.$transaction(async (tx) => {
    // A new brand becomes the active context to make the post-creation flow deterministic.
    await tx.brandMember.updateMany({ where: { userId, isActive: true }, data: { isActive: false } });

    const brand = await tx.brand.create({ data: { ownerUserId: userId, ...brandDataFromPayload(payload) } });
    const membership = await tx.brandMember.create({
      data: { brandId: brand.id, userId, role: 'OWNER', isActive: true },
    });
    await tx.brandAiSetting.create({
      data: {
        brandId: brand.id,
        version: 1,
        tone: 'PROFESSIONAL',
        formality: 'ADAPTIVE',
        language: brand.primaryLanguage,
        targetLength: '2 phrases',
        forbiddenTerms: [],
        recommendedTerms: [],
        createdByUserId: userId,
      },
    });
    const withSettings = await tx.brand.findUniqueOrThrow({ where: { id: brand.id }, include: latestSettingsInclude });
    await writeAuditLog(tx, {
      userId,
      action: 'brand.created',
      resourceType: 'brand',
      resourceId: brand.id,
      requestId: request.requestId,
    });
    return toPublicBrand(withSettings, membership);
  });
}

export async function updateBrand(brandId, payload, membership, request) {
  return prisma.$transaction(async (tx) => {
    const brand = await tx.brand.update({ where: { id: brandId }, data: brandDataFromPayload(payload), include: latestSettingsInclude });
    await writeAuditLog(tx, {
      userId: request.auth.user.id,
      action: 'brand.updated',
      resourceType: 'brand',
      resourceId: brand.id,
      requestId: request.requestId,
      metadata: { fields: Object.keys(payload) },
    });
    return toPublicBrand(brand, membership);
  });
}

export async function activateBrand(brandId, userId, request) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.brandMember.findUnique({
      where: { brandId_userId: { brandId, userId } },
      include: { brand: { include: latestSettingsInclude } },
    });
    if (!membership || membership.brand.deletedAt || membership.brand.status !== 'ACTIVE') {
      throw new HttpError(404, 'not_found', 'Marque introuvable.');
    }
    await tx.brandMember.updateMany({ where: { userId, isActive: true }, data: { isActive: false } });
    const activeMembership = await tx.brandMember.update({ where: { id: membership.id }, data: { isActive: true } });
    await writeAuditLog(tx, {
      userId,
      action: 'brand.activated',
      resourceType: 'brand',
      resourceId: brandId,
      requestId: request.requestId,
    });
    return toPublicBrand(membership.brand, activeMembership);
  });
}

export async function deleteBrand(brandId, membership, request) {
  if (membership.role !== 'OWNER') {
    throw new HttpError(403, 'forbidden', 'Seul le propriétaire peut supprimer une marque.');
  }
  return prisma.$transaction(async (tx) => {
    await tx.brand.update({ where: { id: brandId }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    await tx.brandMember.updateMany({ where: { brandId, isActive: true }, data: { isActive: false } });

    // Les planifications en attente sont annulées ici : le worker refuse déjà
    // d'envoyer pour une marque archivée (services/worker/src/delivery.js), mais
    // sans cette annulation elles resteraient « en attente » indéfiniment, et le
    // calendrier continuerait d'annoncer des envois qui n'auront jamais lieu.
    const cancelled = await tx.scheduledPublication.updateMany({
      where: { status: 'PENDING', publication: { brandId } },
      data: { status: 'CANCELLED', jobId: null },
    });

    await writeAuditLog(tx, {
      userId: request.auth.user.id,
      action: 'brand.archived',
      resourceType: 'brand',
      resourceId: brandId,
      requestId: request.requestId,
      metadata: { cancelledSchedules: cancelled.count },
    });
  });
}

export async function getAiSettings(brandId) {
  const current = await prisma.brandAiSetting.findFirst({ where: { brandId }, orderBy: { version: 'desc' } });
  if (!current) throw new HttpError(404, 'not_found', 'Paramètres IA introuvables.');
  return toPublicAiSettings(current);
}

export async function updateAiSettings(brandId, payload, userId, request) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.brandAiSetting.findFirst({ where: { brandId }, orderBy: { version: 'desc' } });
      if (!current) throw new HttpError(404, 'not_found', 'Paramètres IA introuvables.');
      if (payload.expectedVersion !== current.version) {
        throw new HttpError(409, 'version_conflict', 'Ces paramètres ont été modifiés. Rechargez-les avant de les enregistrer.');
      }
      const next = await tx.brandAiSetting.create({
        data: {
          brandId,
          version: current.version + 1,
          ...settingsDataFromPayload(payload, current),
          createdByUserId: userId,
        },
      });
      await writeAuditLog(tx, {
        userId,
        action: 'brand.ai_settings_updated',
        resourceType: 'brand_ai_settings',
        resourceId: next.id,
        requestId: request.requestId,
        metadata: { brandId, version: next.version, fields: Object.keys(payload).filter((field) => field !== 'expectedVersion') },
      });
      return toPublicAiSettings(next);
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new HttpError(409, 'version_conflict', 'Ces paramètres ont été modifiés. Rechargez-les avant de les enregistrer.');
    }
    throw error;
  }
}
