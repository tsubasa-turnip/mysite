import { z } from 'zod';
import { emotionNames } from './types';
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    '実在する日付を指定してください',
  );
export const journalSchema = z
  .object({
    text: z.string().trim().min(1).max(30000),
    emotions: z
      .object(
        Object.fromEntries(
          Object.keys(emotionNames).map((k) => [k, z.number().min(0).max(10).optional()]),
        ),
      )
      .strict()
      .default({}),
    energy: z.number().min(0).max(10).nullable().default(null),
    stress: z.number().min(0).max(10).nullable().default(null),
    mood: z.number().min(0).max(10).nullable().default(null),
    body: z.string().max(3000).default(''),
    events: z.string().max(3000).default(''),
    insights: z.string().max(3000).default(''),
    values: z.array(z.string().max(200)).max(30).default([]),
    trigger: z.string().max(3000).default(''),
    success: z.string().max(3000).default(''),
    conflict: z.string().max(3000).default(''),
    recovery: z.string().max(3000).default(''),
    important: z.string().max(3000).default(''),
    event_date: dateOnly.nullable().default(null),
    date_kind: z.enum(['explicit', 'estimated', 'unknown']).default('unknown'),
    recorded_at: z.iso.datetime({ offset: true }).optional(),
    anchor: z.boolean().default(false),
  })
  .refine(
    (v) => (v.date_kind === 'unknown') === (v.event_date === null),
    '不明日付は空欄にしてください',
  );
export const extractionSchema = z
  .object({
    text: z.string().min(1).max(6000),
    emotions: journalSchema.shape.emotions,
    energy: z.number().min(0).max(10).nullable(),
    stress: z.number().min(0).max(10).nullable(),
    mood: z.number().min(0).max(10).nullable(),
    body: z.string().max(3000),
    events: z.string().max(3000),
    insights: z.string().max(3000),
    values: z.array(z.string().max(200)).max(30),
    trigger: z.string().max(3000),
    success: z.string().max(3000),
    conflict: z.string().max(3000),
    recovery: z.string().max(3000),
    important: z.string().max(3000),
    event_date: dateOnly.nullable(),
    date_kind: z.enum(['explicit', 'estimated', 'unknown']),
    inferred: z.boolean(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(6000),
  })
  .strict()
  .refine(
    (v) => (v.date_kind === 'unknown') === (v.event_date === null),
    'Inconsistent event date',
  );
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const uuidSchema = z.uuid();
