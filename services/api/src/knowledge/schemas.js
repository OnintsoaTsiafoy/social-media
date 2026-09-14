import { z } from 'zod';
import { HttpError } from '../lib/http.js';

export const documentTypes = ['FAQ', 'PRODUCT', 'SERVICE', 'POLICY', 'SAV', 'GUIDELINE', 'BRAND_TONE', 'OTHER'];
const fields = {
  title: z.string().trim().min(1).max(200),
  documentType: z.enum(documentTypes),
  content: z.string().trim().min(1).max(250_000),
  internal: z.boolean().default(false),
};
export const createKnowledgeSchema = z.object({ brandId: z.uuid(), ...fields });
export const updateKnowledgeSchema = z.object({ ...fields, revision: z.number().int().positive() });
export const uploadKnowledgeSchema = z.object({
  brandId: z.uuid(), title: fields.title, documentType: fields.documentType,
  internal: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
export const knowledgeQuerySchema = z.object({
  brandId: z.uuid(), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export const retrieveSchema = z.object({
  brandId: z.uuid(), query: z.string().trim().min(1).max(4000),
  limit: z.number().int().min(1).max(10).default(5),
});
export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'validation_failed', 'Paramètres invalides.',
    result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
  return result.data;
}
export const idSchema = z.uuid();
