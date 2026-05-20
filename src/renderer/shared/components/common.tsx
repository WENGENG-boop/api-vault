import type { UrlTestResult } from "../api";
import { buildModelTokenRanking, compactNumber, shortLabel } from "../utils";

export type UrlTestStatus = UrlTestResult & { testing?: boolean };

export function EmptyChart({ label = "No chart data yet" }: { label?: string }) {
  return <div className="empty-chart">{label}</div>;
}

export function ModelTokenLeaderboard({ data, limit, onItemClick }: {
  data: ReturnType<typeof buildModelTokenRanking>;
  limit?: number;
  onItemClick?: () => void;
}) {
  if (!data.length) return <EmptyChart label="No token data yet" />;
  const max = Math.max(...data.map((item) => item.tokens), 1);
  const visible = limit ? data.slice(0, limit) : data;

  return (
    <div className="model-token-board">
      {visible.map((item, index) => {
        const content = (
          <>
            <span className="rank">{index + 1}</span>
            <div className="model-token-main">
              <div className="model-token-title">
                <strong>{item.label}</strong>
                <span>{compactNumber(item.tokens)} tokens</span>
              </div>
              <div className="model-token-track">
                <div style={{ width: `${Math.max(5, (item.tokens / max) * 100)}%` }} />
              </div>
              <small>
                input {compactNumber(item.input)} - output {compactNumber(item.output)} - cached {compactNumber(item.cached)} - {item.calls} calls
              </small>
            </div>
          </>
        );
        return onItemClick ? (
          <button key={item.label} type="button" className="model-token-row model-token-row-button" onClick={onItemClick}>
            {content}
          </button>
        ) : (
          <div key={item.label} className="model-token-row">
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function UrlTestIndicator({ test }: { test?: UrlTestStatus }) {
  if (!test) return <span className="url-test-dot url-test-dot--idle" title="Not tested" />;
  if (test.testing) return <span className="url-test-dot url-test-dot--testing" title="Testing..." />;
  const cls = test.ok ? "url-test-dot--ok" : "url-test-dot--fail";
  const tip = test.ok
    ? `OK ${test.status ?? ""} - ${test.latencyMs}ms - ${new Date(test.checkedAt).toLocaleTimeString()}`
    : `Failed: ${test.error ?? `HTTP ${test.status ?? "?"}`} - ${new Date(test.checkedAt).toLocaleTimeString()}`;
  return <span className={`url-test-dot ${cls}`} title={tip} />;
}

export function UrlTestStatusLine({ test }: { test?: UrlTestStatus }) {
  if (!test) return <div className="url-test-status url-test-status--idle">Not tested</div>;
  if (test.testing) return <div className="url-test-status url-test-status--testing">Testing...</div>;
  const time = new Date(test.checkedAt).toLocaleTimeString();
  if (test.ok) {
    return (
      <div className="url-test-status url-test-status--ok">
        OK {test.status} - <strong>{test.latencyMs}ms</strong> - checked {time}
      </div>
    );
  }
  return (
    <div className="url-test-status url-test-status--fail">
      Failed: {test.error ?? `HTTP ${test.status ?? "?"}`} - checked {time}
    </div>
  );
}
