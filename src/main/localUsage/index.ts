import type { LocalUsageBucket, LocalUsageSession, LocalUsageWarning } from "../../shared/types";

// Typed boundary over API Vault's bundled local-log parsers.
// The parsers are ESM (.js with a local package.json `{"type":"module"}`); this
// CommonJS-compiled module loads them via a dynamic import() so Node treats them
// as ESM at runtime. The specifier is typed as `string` on purpose so the TS
// Node16 resolver doesn't try (and fail) to statically resolve a plain .js path.

type ParseFn = () => Promise<unknown>;
interface ParserModule {
  parsers: Record<string, ParseFn>;
}

export interface LocalUsageResult {
  buckets: LocalUsageBucket[];
  sessions: LocalUsageSession[];
  warnings: LocalUsageWarning[];
}

export async function getLocalToolUsage(opts: { days: number }): Promise<LocalUsageResult> {
  const specifier: string = "./parsers/index.js";
  const mod = (await import(specifier)) as ParserModule;
  const parsers = mod.parsers ?? {};
  const cutoff = Date.now() - opts.days * 86_400_000;
  const buckets: LocalUsageBucket[] = [];
  const sessions: LocalUsageSession[] = [];
  const warnings: LocalUsageWarning[] = [];

  for (const [tool, parse] of Object.entries(parsers)) {
    try {
      const result = await parse();
      const rawBuckets = Array.isArray(result)
        ? result
        : ((result as { buckets?: unknown[] } | null)?.buckets ?? []);
      const rawSessions = Array.isArray(result)
        ? []
        : ((result as { sessions?: unknown[] } | null)?.sessions ?? []);

      for (const raw of rawBuckets as Array<Record<string, unknown>>) {
        const bucketStart = typeof raw.bucketStart === "string" ? raw.bucketStart : undefined;
        if (!bucketStart) continue;
        const ts = new Date(bucketStart).getTime();
        if (!Number.isFinite(ts) || ts < cutoff) continue;
        buckets.push({
          tool,
          model: str(raw.model) || "unknown",
          project: str(raw.project) || "unknown",
          bucketStart,
          inputTokens: num(raw.inputTokens),
          outputTokens: num(raw.outputTokens),
          cachedInputTokens: num(raw.cachedInputTokens),
          reasoningOutputTokens: num(raw.reasoningOutputTokens),
          totalTokens: num(raw.totalTokens)
        });
      }

      for (const raw of rawSessions as Array<Record<string, unknown>>) {
        const firstMessageAt = typeof raw.firstMessageAt === "string" ? raw.firstMessageAt : undefined;
        if (!firstMessageAt) continue;
        const ts = new Date(firstMessageAt).getTime();
        if (!Number.isFinite(ts) || ts < cutoff) continue;
        sessions.push({
          tool,
          project: str(raw.project) || "unknown",
          firstMessageAt,
          durationSeconds: num(raw.durationSeconds),
          activeSeconds: num(raw.activeSeconds),
          messageCount: num(raw.messageCount),
          userMessageCount: num(raw.userMessageCount)
        });
      }
    } catch (error) {
      warnings.push({
        tool,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { buckets, sessions, warnings };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
