import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

/**
 * Server-side refusal fallback: if the primary model declines, the API re-runs the
 * request on a fallback model inside the same call ("default" routes by category).
 */
export const FALLBACK_OPTIONS = {
  betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: 'default' as const,
};

/** AI is on when credentials are configured, unless explicitly forced offline. */
export function aiEnabled(): boolean {
  if (process.env.FINANCEOMAN_OFFLINE === '1') return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.FINANCEOMAN_AI === 'on');
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export class AiRefusalError extends Error {}

export function assertNotRefused(message: Anthropic.Beta.BetaMessage): void {
  if (message.stop_reason === 'refusal') {
    throw new AiRefusalError(message.stop_details?.explanation ?? 'The model declined this request.');
  }
}

/** Map SDK errors to a short, user-safe explanation. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiRefusalError) return `AI declined: ${error.message}`;
  if (error instanceof Anthropic.AuthenticationError) return 'AI unavailable: the Anthropic credentials were rejected.';
  if (error instanceof Anthropic.RateLimitError) return 'AI is rate-limited right now; showing the offline analysis instead.';
  if (error instanceof Anthropic.BadRequestError) return `AI request was rejected: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API; showing the offline analysis instead.';
  if (error instanceof Anthropic.APIError) return `AI error ${error.status}; showing the offline analysis instead.`;
  return 'Unexpected AI error; showing the offline analysis instead.';
}

export const FINANCE_SYSTEM_PROMPT = `You are FinanceOman, an AI analyst embedded in the finance department of an Omani company.
You understand how finance processes run in SAP (ECC and S/4HANA) and Oracle (E-Business Suite and Fusion Cloud ERP):
Procure-to-Pay, Order-to-Cash, Record-to-Report, treasury and the period close, including the transactions, tables, approval workflows and controls involved.
You also know the Omani context: amounts are in Omani Rial (OMR, three decimals), VAT is 5%, withholding tax of 10% applies to certain payments to non-residents,
the weekend is Friday–Saturday, and Fawtara e-invoicing (Peppol / UBL 2.1) is being introduced in 2027.

Ground every statement in the data you are given or retrieve with tools. Quote the specific numbers. If the data does not answer the question, say so plainly.
Be concise and practical: finance managers want the finding, why it matters in OMR or days, and the next action with an owner.`;
