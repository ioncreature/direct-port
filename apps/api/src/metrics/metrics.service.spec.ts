import { MetricsService } from './metrics.service';

function makeQueue(name: string, counts: Record<string, number>) {
  return { name, getJobCounts: jest.fn().mockResolvedValue(counts) };
}

function makeService(counts: Record<string, number>) {
  const q = (name: string) => makeQueue(name, counts);
  return new MetricsService(
    q('document-parsing') as never,
    q('document-processing') as never,
    q('manager-notifications') as never,
    q('client-bot-outgoing') as never,
    q('lead-discovery') as never,
    q('lead-enrichment') as never,
  );
}

describe('MetricsService', () => {
  const COUNTS = { waiting: 2, active: 1, delayed: 0, failed: 3, completed: 5, paused: 0 };

  it('snapshot собирает счётчики по всем шести очередям', async () => {
    const snap = await makeService(COUNTS).snapshot();
    expect(snap).toHaveLength(6);
    expect(snap.map((s) => s.name)).toContain('document-processing');
    expect(snap[0].counts.failed).toBe(3);
  });

  it('toPrometheus форматирует gauge по очередь×состояние', async () => {
    const text = await makeService(COUNTS).toPrometheus();
    expect(text).toContain('# TYPE directport_queue_jobs gauge');
    expect(text).toContain('directport_queue_jobs{queue="document-parsing",state="failed"} 3');
    expect(text).toContain('directport_queue_jobs{queue="client-bot-outgoing",state="waiting"} 2');
  });
});
