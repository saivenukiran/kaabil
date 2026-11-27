import { describe, expect, it } from 'vitest';
import { AlertInputSchema, CreateGroupSchema, DoseInputSchema, EventSchema, MedicineInputSchema, PairRequestSchema, TtsRequestSchema } from './schemas';

const group = { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: true, emergency: true } };

describe('group schemas', () => {
  it('accepts a valid group', () => {
    expect(CreateGroupSchema.safeParse(group).success).toBe(true);
  });
  it('rejects an unknown field (strict)', () => {
    expect(CreateGroupSchema.safeParse({ ...group, admin: true }).success).toBe(false);
  });
  it('rejects a language that is not registered', () => {
    expect(CreateGroupSchema.safeParse({ ...group, lang: 'hi' }).success).toBe(false);
  });
  it('rejects an empty person name', () => {
    expect(CreateGroupSchema.safeParse({ ...group, personName: '' }).success).toBe(false);
  });
});

describe('medicine input', () => {
  it('accepts the typed line', () => {
    expect(MedicineInputSchema.safeParse({ line: 'Metformin 500, 1-0-1' }).success).toBe(true);
  });
  it('accepts fields with valid times', () => {
    expect(MedicineInputSchema.safeParse({ name: 'Aspirin', strength: '75mg', times: ['08:00', '21:00'] }).success).toBe(true);
  });
  it('rejects invalid times such as 25:00 and 9:5', () => {
    expect(MedicineInputSchema.safeParse({ name: 'A', strength: '1', times: ['25:00'] }).success).toBe(false);
    expect(MedicineInputSchema.safeParse({ name: 'A', strength: '1', times: ['9:5'] }).success).toBe(false);
  });
  it('rejects a body with both shapes mixed', () => {
    expect(MedicineInputSchema.safeParse({ line: 'x', name: 'y' }).success).toBe(false);
  });
});

describe('device inputs', () => {
  it('needs an 8-digit pairing code', () => {
    expect(PairRequestSchema.safeParse({ code: '12345678', deviceName: 'Amma phone' }).success).toBe(true);
    expect(PairRequestSchema.safeParse({ code: '1234567', deviceName: 'x' }).success).toBe(false);
    expect(PairRequestSchema.safeParse({ code: '1234abcd', deviceName: 'x' }).success).toBe(false);
  });
  it('accepts a dose and refuses a negative time', () => {
    const dose = { slotId: 'm1|2026-11-28|08:00', medicineId: 'm1', atMs: 1_700_000_000_000, via: 'voice' };
    expect(DoseInputSchema.safeParse(dose).success).toBe(true);
    expect(DoseInputSchema.safeParse({ ...dose, atMs: -1 }).success).toBe(false);
    expect(DoseInputSchema.safeParse({ ...dose, via: 'typed' }).success).toBe(false);
  });
  it('only allows the three alert kinds', () => {
    expect(AlertInputSchema.safeParse({ kind: 'emergency', atMs: 1 }).success).toBe(true);
    expect(AlertInputSchema.safeParse({ kind: 'diagnosis', atMs: 1 }).success).toBe(false);
  });
});

describe('speech out is only the fixed messages', () => {
  it('accepts a fixed message key and refuses free text', () => {
    expect(TtsRequestSchema.safeParse({ key: 'remind', lang: 'te', vars: { address: 'అమ్మ', name: 'Metformin' } }).success).toBe(true);
    expect(TtsRequestSchema.safeParse({ text: 'say anything', lang: 'te', vars: {} }).success).toBe(false);
    expect(TtsRequestSchema.safeParse({ key: 'say_anything', lang: 'te', vars: {} }).success).toBe(false);
  });
});

describe('events', () => {
  it('knows its event types', () => {
    expect(EventSchema.safeParse({ type: 'ping', at: 1 }).success).toBe(true);
    expect(EventSchema.safeParse({ type: 'remind', at: 1, medicineId: 'm1' }).success).toBe(true);
    expect(EventSchema.safeParse({ type: 'explode', at: 1 }).success).toBe(false);
  });
});
