// features/billing.js — per-provider balance & quota with sync history.
import { h, icon } from "../dom.js";
import { applyState } from "../store.js";
import { api } from "../api.js";
import { money, pct, relTime, dateTime } from "../format.js";
import { card, stat, badge, empty, toast, withBusy } from "../ui.js";

export function renderBilling(s) {
  const totalSpent = s.balanceSnapshots.reduce((acc, b) => { const cur = acc[b.providerId]; if (!cur || new Date(b.checkedAt) > new Date(cur.checkedAt)) acc[b.providerId] = b; return acc; }, {});
  const latestList = Object.values(totalSpent);
  const grandSpent = latestList.reduce((a, b) => a + (b.spent || 0), 0);
  const grandBalance = latestList.reduce((a, b) => a + (b.balance || 0), 0);

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Billing"), h("div.sub", "Provider balances, granted quota and spend")),
      h("div.actions")),
    h("div.grid.cols-3",
      stat("Tracked providers", String(latestList.length), null, { sm: true }),
      stat("Total available", money(grandBalance), "across providers", { sm: true }),
      stat("Total spent", money(grandSpent), "synced totals", { sm: true })),
    s.providers.length ? h("div.grid.cols-2", s.providers.map((p) => billingCard(s, p))) : empty("No providers", "Add a provider with balance sync to track billing."));
}

function billingCard(s, p) {
  const snaps = s.balanceSnapshots.filter((b) => b.providerId === p.id).sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt));
  const latest = snaps[0];
  const configured = p.balanceConfig?.enabled;
  const syncBtn = h("button.btn.sm" + (configured ? ".primary" : ""), { disabled: !configured, title: configured ? "" : "Balance sync not configured for this provider", onClick: () => sync(syncBtn, p.id) }, icon("refresh", 13), "Sync balance");

  let bodyTop;
  if (!latest) {
    bodyTop = h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, configured ? "No balance synced yet — run a sync." : "Balance sync is not configured. Enable it in Providers.");
  } else if (latest.unlimitedQuota) {
    bodyTop = h("div.row", { style: { gap: "10px" } }, badge("Unlimited quota", "ok", { dot: true }), latest.spent != null && h("span.muted", { style: { fontSize: "var(--fz-sm)" } }, "Spent: " + money(latest.spent, latest.currency)));
  } else {
    const ratio = latest.granted ? Math.min(100, (latest.spent / latest.granted) * 100) : null;
    bodyTop = h("div.stack.tight",
      h("div.spread", h("div", h("div.muted", { style: { fontSize: "10px", textTransform: "uppercase" } }, "Available"), h("div", { style: { fontSize: "var(--fz-xl)", fontWeight: 700, fontVariantNumeric: "tabular-nums" } }, money(latest.balance, latest.currency))),
        ratio != null && h("div.right", h("div.muted", { style: { fontSize: "10px", textTransform: "uppercase" } }, "Used"), h("div", { style: { fontSize: "var(--fz-lg)", fontWeight: 600 } }, pct(ratio, 0)))),
      ratio != null && h("div.share-bar", { style: { height: "8px" } }, h("i", { style: { width: ratio + "%", background: ratio > 85 ? "var(--err)" : ratio > 60 ? "var(--warn)" : "var(--ok)" } })),
      h("div.grid.cols-3.mt2",
        mini("Spent", money(latest.spent, latest.currency)),
        mini("Granted", latest.granted != null ? money(latest.granted, latest.currency) : "—"),
        mini("Token", latest.tokenName || "—")));
  }

  return card({ title: h("div.row", { style: { gap: "8px" } }, p.name, p.isLocal && badge("local", null, {})), actions: syncBtn },
    bodyTop,
    latest?.error && h("div.mt3", { style: { color: "var(--err)", fontSize: "var(--fz-sm)" } }, icon("alert", 12), " " + latest.error),
    latest && h("div.muted.mt2", { style: { fontSize: "var(--fz-xs)" } }, "Last checked ", relTime(latest.checkedAt)),
    snaps.length > 1 && historyBlock(snaps.slice(0, 10)));
}

const mini = (l, v) => h("div", h("div.muted", { style: { fontSize: "10px", textTransform: "uppercase" } }, l), h("div", { style: { fontSize: "var(--fz-md)", fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, v));

function historyBlock(snaps) {
  return h("details.mt3", { style: { borderTop: "1px solid var(--border)", paddingTop: "var(--s3)" } },
    h("summary", { style: { cursor: "pointer", fontSize: "var(--fz-sm)", color: "var(--text-dim)" } }, `Sync history (${snaps.length})`),
    h("div.stack.tight.mt2", snaps.map((b) => h("div.spread", { style: { fontSize: "var(--fz-xs)", padding: "4px 0" } },
      h("span.muted", dateTime(b.checkedAt)),
      h("div.row", { style: { gap: "10px" } },
        b.ok ? badge("ok", "ok", {}) : badge("error", "err", {}),
        h("span", { style: { fontVariantNumeric: "tabular-nums" } }, b.unlimitedQuota ? "unlimited" : money(b.balance, b.currency)))))));
}

async function sync(btn, id) {
  await withBusy(btn, async () => { const r = await api.testBalance(id); if (r.state) applyState(r.state); toast("Balance synced", "ok"); });
}
