// format.js — display formatters (mirrors project viewUtils conventions).

export function compact(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(n));
}

export function int(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(n));
}

export function money(value, currency) {
  if (value == null || !Number.isFinite(value)) return "—";
  const unit = currency?.trim();
  const v = value < 1 ? value.toFixed(4) : value.toFixed(2);
  return unit ? `${unit} ${v}` : `$${v}`;
}

export function pct(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function ms(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return (value / 1000).toFixed(2) + "s";
  return Math.round(value) + "ms";
}

export function dur(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "0m";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function latencyClass(value) {
  if (value == null) return "";
  if (value < 400) return "latency-good";
  if (value < 1200) return "latency-mid";
  return "latency-bad";
}

export function dateTime(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value || "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function timeShort(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function relTime(value) {
  if (!value) return "never";
  const d = new Date(value).getTime();
  if (!Number.isFinite(d)) return "—";
  const diff = Date.now() - d;
  const s = Math.round(diff / 1000);
  if (s < 0) return "soon";
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  const days = Math.round(h / 24);
  if (days < 30) return days + "d ago";
  return new Date(value).toLocaleDateString();
}

export function statusClass(status) {
  if (status === "available" || status === "ok" || status === true) return "ok";
  if (status === "unknown" || status == null) return "idle";
  return "err";
}

export function protoLabel(p) {
  return ({
    "openai-compatible": "OpenAI",
    "anthropic-compatible": "Anthropic",
    "openai-anthropic-compatible": "Auto",
    "custom": "Custom",
    "unknown": "Unknown",
  })[p] || p || "—";
}

export function gatewayLabel(ev) {
  return ({
    openai: "openai global", anthropic: "anthropic global", auto: "auto global",
    "public-proxy": "public proxy", "local-service": "local service", "legacy-key": "legacy key",
  })[ev.gatewayType] || "provider url";
}

export function tokensOf(ev) {
  if (ev.totalTokens != null) return ev.totalTokens;
  return (ev.inputTokens || 0) + (ev.outputTokens || 0);
}
