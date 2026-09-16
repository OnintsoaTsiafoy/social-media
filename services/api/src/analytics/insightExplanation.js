import { z } from 'zod';

const ids = (max) => z.array(z.string().min(1).max(80)).max(max).refine((values) => new Set(values).size === values.length);
export const insightPlanSchema = z.object({ summary: ids(2).min(1), importantFacts: ids(4),
  positivePoints: ids(3), attentionPoints: ids(3), recommendations: ids(3) }).strict();

export const EMPTY_SUMMARY = 'Les données disponibles ne permettent pas encore de dégager une analyse fiable.';
export const FALLBACK_WARNING = 'IA indisponible ou réponse non vérifiable : cette analyse utilise les faits calculés localement.';

export function localInsightPlan(facts) {
  const idsFor = (polarity) => facts.filter((fact) => fact.polarity === polarity).slice(0, 3).map((fact) => fact.id);
  return { summary: facts.slice(0, 2).map((fact) => fact.id), importantFacts: facts.slice(0, 4).map((fact) => fact.id),
    positivePoints: idsFor('positive'), attentionPoints: idsFor('attention'),
    recommendations: facts.filter((fact) => fact.recommendation).slice(0, 3).map((fact) => fact.id) };
}

/** The model chooses evidence IDs. Free prose cannot smuggle in a false number or metric. */
export function renderInsightPlan(summary, input) {
  const plan = summary.facts.length ? insightPlanSchema.parse(input) : input;
  const byId = new Map(summary.facts.map((fact) => [fact.id, fact]));
  const referencedMetrics = new Set();
  const result = {};
  for (const section of ['summary', 'importantFacts', 'positivePoints', 'attentionPoints', 'recommendations']) {
    result[section] = [...new Set(plan[section].map((id) => {
      const fact = byId.get(id);
      const source = fact && summary.metrics[fact.metric];
      if (!fact || !source || source.availability !== 'available' || source.value !== fact.value || source.unit !== fact.unit
        || (section === 'positivePoints' && fact.polarity !== 'positive')
        || (section === 'attentionPoints' && fact.polarity !== 'attention')
        || (section === 'recommendations' && !fact.recommendation)) throw new Error('Ungrounded analytics plan');
      referencedMetrics.add(fact.metric);
      return section === 'recommendations' ? fact.recommendation : fact.message;
    }))];
  }
  return { ...result, summary: result.summary.join(' ') || EMPTY_SUMMARY,
    referencedMetrics: [...referencedMetrics], warnings: summary.warnings };
}

export function localInsightExplanation(summary) {
  return renderInsightPlan(summary, localInsightPlan(summary.facts));
}

export function validateInsightExplanation(summary, result) {
  const envelope = z.object({ plan: insightPlanSchema, explanation: z.object({
    summary: z.string().max(700), importantFacts: z.array(z.string().max(350)).max(4),
    positivePoints: z.array(z.string().max(350)).max(3), attentionPoints: z.array(z.string().max(350)).max(3),
    recommendations: z.array(z.string().max(350)).max(3), referencedMetrics: z.array(z.string().max(80)).max(15),
    warnings: z.array(z.string().max(500)).max(10),
  }).strict(), model: z.string().min(1).max(120), aiStatus: z.enum(['available', 'fallback']) }).strict().parse(result);
  const expected = renderInsightPlan(summary, envelope.plan);
  for (const key of Object.keys(expected)) {
    if (JSON.stringify(envelope.explanation[key]) !== JSON.stringify(expected[key])) throw new Error('Invalid analytics explanation');
  }
  return envelope;
}
