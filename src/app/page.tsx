import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Script from "next/script";

export const metadata = {
  title: "API Vault - One local control plane for every AI API",
  description: "Store AI API keys locally, route compatible requests, and understand usage across every provider with API Vault."
};

export default function WebsitePage() {
  const html = readFileSync(resolve(process.cwd(), "website", "index.html"), "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
  const bodyWithoutScript = body.replace(/<script\s+src=["']app\.js["']><\/script>/i, "");

  return (
    <>
      <link rel="stylesheet" href="/website/styles.css" />
      <div dangerouslySetInnerHTML={{ __html: bodyWithoutScript }} />
      <Script src="/website/app.js" strategy="afterInteractive" />
    </>
  );
}
