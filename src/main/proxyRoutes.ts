export type ProxyRoute =
  | { kind: "public"; suffixPath: string }
  | { kind: "global"; gatewayName: "openai" | "anthropic" | "auto"; suffixPath: string }
  | { kind: "by-key"; suffixPath: string }
  | { kind: "provider"; providerId: string; suffixPath: string };

export function parseProxyRoute(pathname: string): ProxyRoute | undefined {
  const publicMatch = pathname.match(/^\/proxy\/v1(\/.*)?$/);
  if (publicMatch) return { kind: "public", suffixPath: publicMatch[1] ?? "/" };

  const globalMatch = pathname.match(/^\/proxy\/(openai|anthropic|auto)(\/.*)?$/);
  if (globalMatch) {
    return {
      kind: "global",
      gatewayName: globalMatch[1] as "openai" | "anthropic" | "auto",
      suffixPath: globalMatch[2] ?? "/"
    };
  }

  const byKeyMatch = pathname.match(/^\/proxy\/by-key(\/.*)?$/);
  if (byKeyMatch) return { kind: "by-key", suffixPath: byKeyMatch[1] ?? "/" };

  const providerMatch = pathname.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (providerMatch) {
    return {
      kind: "provider",
      providerId: decodeURIComponent(providerMatch[1]),
      suffixPath: providerMatch[2] ?? "/"
    };
  }

  return undefined;
}
