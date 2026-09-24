// Oman-specific finance rules and formatting.
// Sources and caveats are documented in docs/RESEARCH.md.

/** Standard VAT rate in Oman (Oman Tax Authority, effective 16 April 2021). */
export const OMAN_VAT_RATE = 0.05;

/** Withholding tax on specified payments (e.g. services) to non-resident persons. */
export const OMAN_WHT_RATE = 0.1;

/** The Omani Rial is subdivided into 1,000 baisa, so amounts carry 3 decimals. */
export const OMR_DECIMALS = 3;

/** Oman's weekend has been Friday and Saturday since 2013 (JS getUTCDay: 5 = Fri, 6 = Sat). */
export const OMAN_WEEKEND_DAYS = [5, 6];

export function roundOmr(value: number): number {
  return Math.round(value * 10 ** OMR_DECIMALS) / 10 ** OMR_DECIMALS;
}

export function formatOmr(value: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(value) >= 1000) {
    const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [size, suffix] of units) {
      if (Math.abs(value) >= size) return `OMR ${(value / size).toFixed(1)}${suffix}`;
    }
  }
  return `OMR ${value.toLocaleString('en-US', {
    minimumFractionDigits: OMR_DECIMALS,
    maximumFractionDigits: OMR_DECIMALS,
  })}`;
}

export function isOmanWeekend(iso: string): boolean {
  return OMAN_WEEKEND_DAYS.includes(new Date(iso).getUTCDay());
}

/** Outside 07:00–18:00 Muscat time (UTC+4). */
export function isAfterHours(iso: string): boolean {
  const hourMuscat = (new Date(iso).getUTCHours() + 4) % 24;
  return hourMuscat < 7 || hourMuscat >= 18;
}

/** Expected VAT on a domestic taxable supply at the standard rate. */
export function expectedVat(netAmount: number, isForeign: boolean): number {
  return isForeign ? 0 : roundOmr(netAmount * OMAN_VAT_RATE);
}

/** Expected WHT on a payment to a non-resident service provider. */
export function expectedWht(netAmount: number, isForeign: boolean, serviceVendor: boolean): number {
  return isForeign && serviceVendor ? roundOmr(netAmount * OMAN_WHT_RATE) : 0;
}
