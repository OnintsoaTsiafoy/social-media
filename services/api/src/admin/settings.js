import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';

// Réglages de la plateforme, édités depuis la console web. Une ligne par clé
// dans `platform_settings` ; tant qu'aucune n'existe l'API sert les valeurs
// par défaut ci-dessous (même principe que `notification_settings`).
//
// IMPORTANT — ces réglages sont ENREGISTRÉS mais pas encore CONSOMMÉS par le
// pipeline : la liste de mots-clés n'alimente pas l'analyse, le seuil
// d'autonomie n'envoie rien sans relecture (Sprint 10 : rien ne part sans une
// proposition approuvée par un humain). Seuls les délais de service servent
// déjà, à calculer le taux de respect du SLA affiché dans la console.

export const SETTING_KEYS = {
  keywords: 'moderation.keywords',
  serviceLevels: 'service_levels',
  supervision: 'ai.supervision',
  pageAutoReply: 'pages.auto_reply',
};

export const keywordSchema = z.string().trim().toLowerCase().min(2).max(40);

const minutes = z.number().int().min(5).max(1440);

export const serviceLevelsSchema = z.object({
  firstResponseMinutes: minutes,
  escalationMinutes: minutes,
  nightWindowMinutes: minutes,
});

export const supervisionSchema = z.object({
  autoReply: z.boolean(),
  threshold: z.number().int().min(50).max(99),
  rules: z.object({
    negative: z.boolean(),
    volume: z.boolean(),
    vip: z.boolean(),
    lang: z.boolean(),
  }),
});

const DEFINITIONS = {
  [SETTING_KEYS.keywords]: {
    schema: z.array(keywordSchema).max(200),
    defaults: [],
  },
  [SETTING_KEYS.serviceLevels]: {
    schema: serviceLevelsSchema,
    defaults: { firstResponseMinutes: 15, escalationMinutes: 45, nightWindowMinutes: 30 },
  },
  [SETTING_KEYS.supervision]: {
    schema: supervisionSchema,
    // Envoi automatique en pause par défaut : il n'est pas encore branché.
    defaults: {
      autoReply: false,
      threshold: 82,
      rules: { negative: true, volume: true, vip: true, lang: false },
    },
  },
  // Seules les pages ACTIVÉES sont stockées : absence = désactivée.
  [SETTING_KEYS.pageAutoReply]: {
    schema: z.record(z.uuid(), z.literal(true)),
    defaults: {},
  },
};

function definitionOf(key) {
  const definition = DEFINITIONS[key];
  if (!definition) throw new Error(`Réglage inconnu : ${key}`);
  return definition;
}

function valueOrDefaults(definition, stored) {
  const parsed = definition.schema.safeParse(stored);
  return parsed.success ? parsed.data : structuredClone(definition.defaults);
}

/** Valeur courante d'un réglage (défauts si la ligne n'existe pas ou est illisible). */
export async function readSetting(key) {
  const definition = definitionOf(key);
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return {
    value: valueOrDefaults(definition, row?.value),
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Lecture-modification-écriture atomique d'un réglage. Deux administrateurs qui
 * ajoutent un mot-clé au même instant ne s'écrasent pas : la ligne est
 * verrouillée (`FOR UPDATE`) et le second voit le résultat du premier.
 *
 * `mutate(current)` renvoie la nouvelle valeur (ou lève une `HttpError`).
 * `describe(before, after)` fournit les métadonnées d'audit.
 */
export async function updateSetting(key, { mutate, describe, action }, { userId, requestId }) {
  const definition = definitionOf(key);

  return prisma.$transaction(async (tx) => {
    // La ligne est créée à la première écriture ; ON CONFLICT DO NOTHING fait
    // attendre un second premier-écrivain jusqu'à la validation du premier.
    await tx.$executeRaw`
      INSERT INTO platform_settings (key, value, version, updated_at)
      VALUES (${key}, ${JSON.stringify(definition.defaults)}::jsonb, 0, now())
      ON CONFLICT (key) DO NOTHING`;
    const [row] = await tx.$queryRaw`
      SELECT value, version FROM platform_settings WHERE key = ${key} FOR UPDATE`;

    const before = valueOrDefaults(definition, row.value);
    const next = definition.schema.parse(mutate(structuredClone(before)));
    const version = row.version + 1;

    await tx.platformSetting.update({
      where: { key },
      data: { value: next, version, updatedByUserId: userId },
    });
    await writeAuditLog(tx, {
      userId,
      action,
      resourceType: 'platform_setting',
      resourceId: key,
      requestId,
      metadata: describe(before, next),
    });

    return { value: next, version };
  });
}

export async function getSettings() {
  const [keywords, serviceLevels, supervision] = await Promise.all([
    readSetting(SETTING_KEYS.keywords),
    readSetting(SETTING_KEYS.serviceLevels),
    readSetting(SETTING_KEYS.supervision),
  ]);
  return {
    keywords: keywords.value,
    serviceLevels: serviceLevels.value,
    supervision: supervision.value,
  };
}

export async function addKeyword(word, context) {
  const { value } = await updateSetting(
    SETTING_KEYS.keywords,
    {
      action: 'admin.settings.keyword_added',
      mutate(list) {
        if (list.includes(word)) throw new HttpError(409, 'conflict', 'Ce mot-clé est déjà dans le filtre.');
        return [...list, word];
      },
      describe: () => ({ keyword: word }),
    },
    context
  );
  return { keywords: value };
}

export async function removeKeyword(word, context) {
  const { value } = await updateSetting(
    SETTING_KEYS.keywords,
    {
      action: 'admin.settings.keyword_removed',
      mutate(list) {
        if (!list.includes(word)) throw new HttpError(404, 'not_found', 'Mot-clé introuvable.');
        return list.filter((entry) => entry !== word);
      },
      describe: () => ({ keyword: word }),
    },
    context
  );
  return { keywords: value };
}

export async function updateServiceLevels(patch, context) {
  const { value } = await updateSetting(
    SETTING_KEYS.serviceLevels,
    {
      action: 'admin.settings.service_levels_updated',
      mutate: (current) => ({ ...current, ...patch }),
      describe: (before, after) => ({ before, after }),
    },
    context
  );
  return { serviceLevels: value };
}

export async function updateSupervision(patch, context) {
  const { value } = await updateSetting(
    SETTING_KEYS.supervision,
    {
      action: 'admin.settings.supervision_updated',
      mutate: (current) => ({
        ...current,
        ...(patch.autoReply === undefined ? {} : { autoReply: patch.autoReply }),
        ...(patch.threshold === undefined ? {} : { threshold: patch.threshold }),
        rules: { ...current.rules, ...(patch.rules ?? {}) },
      }),
      describe: (before, after) => ({ before, after }),
    },
    context
  );
  return { supervision: value };
}

export async function setPageAutoReply(page, enabled, context) {
  await updateSetting(
    SETTING_KEYS.pageAutoReply,
    {
      action: 'admin.page.auto_reply_changed',
      mutate(map) {
        if (enabled) return { ...map, [page.id]: true };
        const { [page.id]: _removed, ...rest } = map;
        return rest;
      },
      describe: () => ({ pageName: page.name, provider: page.provider.toLowerCase(), enabled }),
    },
    context
  );
  return { id: page.id, autoReply: enabled };
}

/** Ensemble des pages dont la réponse automatique est activée. */
export async function autoReplyPageIds() {
  const { value } = await readSetting(SETTING_KEYS.pageAutoReply);
  return new Set(Object.keys(value));
}
