import { z } from 'zod';

export const dashboardQuerySchema = z.object({ brandId: z.uuid() });
