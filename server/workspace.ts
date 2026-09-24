import { analyseDataset, type Dataset, type DatasetAnalysis, type EventRecord, type ProcessKey } from '../src/engine';
import { createDemoDataset } from '../src/demo';

export type DataSource = 'demo' | 'upload';

/** Single-tenant, in-memory workspace: the active dataset and its cached analysis. */
class Workspace {
  private dataset: Dataset = createDemoDataset();
  private cached: DatasetAnalysis | null = null;
  readonly sources: Record<ProcessKey, DataSource> = { P2P: 'demo', O2C: 'demo', R2R: 'demo' };

  get data(): Dataset {
    return this.dataset;
  }

  get analysis(): DatasetAnalysis {
    this.cached ??= analyseDataset(this.dataset);
    return this.cached;
  }

  replaceLog(process: ProcessKey, events: EventRecord[]): void {
    this.dataset = { ...this.dataset, logs: { ...this.dataset.logs, [process]: events } };
    this.sources[process] = 'upload';
    this.cached = null;
  }

  reset(): void {
    this.dataset = createDemoDataset();
    this.cached = null;
    for (const k of Object.keys(this.sources) as ProcessKey[]) this.sources[k] = 'demo';
  }
}

export const workspace = new Workspace();
