import { z } from 'zod';
export const healthSchema = z.object({ status: z.literal('ok'), service: z.literal('glitch-api') });
export type Health = z.infer<typeof healthSchema>;
export const apiErrorSchema = z.object({ code:z.string(), message:z.string() });
export const uuidSchema = z.uuid();
