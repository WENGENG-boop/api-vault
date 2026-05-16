export type JsonPathToken = string | number;

export function tokenizePath(path: string): JsonPathToken[] {
  const normalized = path.trim().replace(/^\$\.?/, "");
  if (!normalized) return [];
  const tokens: JsonPathToken[] = [];
  for (const part of normalized.split(".")) {
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(part)) !== null) {
      if (match[1] !== undefined) tokens.push(match[1]);
      if (match[2] !== undefined) tokens.push(Number(match[2]));
    }
  }
  return tokens;
}

export function readJsonPath(value: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  let current: unknown = value;
  for (const token of tokenizePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (typeof token === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[token];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

export function readNumberPath(value: unknown, path: string): number | undefined {
  const raw = readJsonPath(value, path);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/,/g, "").trim();
    if (cleaned) {
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function readStringPath(value: unknown, path: string): string | undefined {
  const raw = readJsonPath(value, path);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

export function readBooleanPath(value: unknown, path: string): boolean | undefined {
  const raw = readJsonPath(value, path);
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}
