import Papa from 'papaparse';
import type { EventRecord } from './types';

export interface ColumnMapping {
  caseId: string;
  activity: string;
  timestamp: string;
  resource?: string;
  amount?: string;
}

/** Common column names in SAP / Oracle extracts, used to auto-detect a mapping. */
const CANDIDATES: Record<keyof ColumnMapping, string[]> = {
  caseId: ['case_id', 'caseid', 'case', 'document', 'ebeln', 'belnr', 'vbeln', 'po_header_id', 'invoice_id', 'je_header_id', 'trx_number', 'document_number'],
  activity: ['activity', 'event', 'activity_name', 'step', 'tcode', 'transaction', 'action', 'event_type'],
  timestamp: ['timestamp', 'time', 'event_time', 'datetime', 'date', 'cpudt', 'budat', 'creation_date', 'last_update_date', 'udate'],
  resource: ['resource', 'user', 'usnam', 'ernam', 'username', 'created_by', 'last_updated_by', 'performer'],
  amount: ['amount', 'value', 'dmbtr', 'wrbtr', 'netwr', 'invoice_amount', 'amount_dr'],
};

export function detectMapping(headers: string[]): Partial<ColumnMapping> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const mapping: Partial<ColumnMapping> = {};
  for (const [field, names] of Object.entries(CANDIDATES) as [keyof ColumnMapping, string[]][]) {
    const idx = lower.findIndex((h) => names.includes(h));
    if (idx >= 0) mapping[field] = headers[idx];
  }
  return mapping;
}

export interface ParsedLog {
  events: EventRecord[];
  headers: string[];
  mapping: Partial<ColumnMapping>;
  skipped: number;
  errors: string[];
}

/** Accepts ISO timestamps, "YYYY-MM-DD HH:mm[:ss]", SAP "YYYYMMDD[HHmmss]" and "DD.MM.YYYY HH:mm". */
export function parseTimestamp(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(v);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))).toISOString();
  m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))).toISOString();
  const normalized = /^\d{4}-\d{2}-\d{2} \d/.test(v) ? v.replace(' ', 'T') : v;
  const ts = Date.parse(normalized.length === 16 || normalized.length === 19 ? `${normalized}Z` : normalized);
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

export function parseEventLogCsv(csv: string, mappingOverride: Partial<ColumnMapping> = {}): ParsedLog {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const mapping = { ...detectMapping(headers), ...mappingOverride };
  const errors = parsed.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.message}`);
  for (const field of ['caseId', 'activity', 'timestamp'] as const) {
    if (!mapping[field]) errors.push(`Could not find a column for "${field}". Map it explicitly.`);
  }
  if (!mapping.caseId || !mapping.activity || !mapping.timestamp) {
    return { events: [], headers, mapping, skipped: parsed.data.length, errors };
  }

  const events: EventRecord[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const caseId = row[mapping.caseId]?.trim();
    const activity = row[mapping.activity]?.trim();
    const timestamp = parseTimestamp(row[mapping.timestamp] ?? '');
    if (!caseId || !activity || !timestamp) { skipped++; continue; }
    const amountRaw = mapping.amount ? row[mapping.amount]?.replace(/,/g, '') : undefined;
    const amount = amountRaw ? Number(amountRaw) : undefined;
    events.push({
      caseId,
      activity,
      timestamp,
      resource: mapping.resource ? row[mapping.resource]?.trim() || undefined : undefined,
      amount: Number.isFinite(amount) ? amount : undefined,
    });
  }
  return { events, headers, mapping, skipped, errors };
}

export function eventsToCsv(events: EventRecord[]): string {
  return Papa.unparse(events.map((e) => ({ case_id: e.caseId, activity: e.activity, timestamp: e.timestamp, resource: e.resource ?? '', amount: e.amount ?? '' })));
}
