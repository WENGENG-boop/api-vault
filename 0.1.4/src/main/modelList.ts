const MODEL_CONTAINER_KEYS = new Set([
  "data",
  "items",
  "models",
  "modelNames",
  "model_names",
  "modelIds",
  "model_ids",
  "availableModels",
  "available_models"
]);

const MODEL_ID_KEYS = ["id", "modelId", "model_id", "model", "name", "slug"];

export function extractModelNamesFromJson(json: unknown): string[] {
  const names: string[] = [];
  const seenValues = new Set<unknown>();

  function add(value: unknown): void {
    if (typeof value !== "string") return;
    const normalized = normalizeModelName(value);
    if (normalized) names.push(normalized);
  }

  function visit(value: unknown, keyHint?: string): void {
    if (value === null || value === undefined || seenValues.has(value)) return;
    if (typeof value === "object") seenValues.add(value);

    if (typeof value === "string") {
      if (keyHint && MODEL_CONTAINER_KEYS.has(keyHint)) add(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, keyHint);
      return;
    }

    if (!isRecord(value)) return;

    for (const key of MODEL_ID_KEYS) {
      if (typeof value[key] !== "string" || !normalizeModelName(value[key]).trim()) continue;
      add(value[key]);
      break;
    }

    for (const key of MODEL_CONTAINER_KEYS) {
      const child = value[key];
      if (child === undefined) continue;
      if (key === "models" && isRecord(child)) {
        for (const [modelKey, modelValue] of Object.entries(child)) {
          if (!Array.isArray(modelValue)) add(modelKey);
          visit(modelValue, key);
        }
      } else {
        visit(child, key);
      }
    }
  }

  visit(json);
  return [...new Set(names)];
}

function normalizeModelName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^models\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
