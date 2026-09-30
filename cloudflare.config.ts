import { bindings, defineConfig, defineWorker } from "cf/config";

// Deploy targets can be overridden with environment variables so a fork can
// deploy to its own Cloudflare account without editing this file. When a
// variable is unset, the upstream production value is used.
//
//   CF_WORKER_NAME       Worker name used for production
//   CF_D1_NAME           production D1 database name
//   CF_D1_ID             production D1 database UUID (optional)
//   CF_D1_PREVIEW_NAME   preview D1 database name
//   CF_D1_PREVIEW_ID     preview D1 database UUID (optional)
//
// Preview mode (`vinext-cloudflare deploy --preview`, i.e. `--mode preview`)
// deploys a separate Worker named `<name>-preview` bound to its own D1
// database, so preview migrations and test data never touch production.
const workerName = process.env.CF_WORKER_NAME || "fra-collection-league";

// Bind by UUID when one is configured, otherwise by name — never both. The
// deployed Worker records D1 bindings by id only, so a local binding that also
// carries `name` always looks like drift, and non-interactive (CI) deploys run
// with --strict and abort on it.
function d1Binding(name: string | undefined, id: string | undefined) {
  return bindings.d1(id ? { id } : { name });
}

function d1For(mode: string | undefined) {
  if (mode !== "preview") {
    return d1Binding(
      process.env.CF_D1_NAME || "fra-db-prod-20260930",
      process.env.CF_D1_ID,
    );
  }
  const name = process.env.CF_D1_PREVIEW_NAME;
  const id = process.env.CF_D1_PREVIEW_ID;
  if (!name && !id) {
    // Fail loudly rather than silently binding preview to production data.
    throw new Error("Preview mode needs CF_D1_PREVIEW_NAME or CF_D1_PREVIEW_ID.");
  }
  return d1Binding(name, id);
}

export default defineConfig({
  worker: defineWorker(({ mode }) => ({
    name: mode === "preview" ? `${workerName}-preview` : workerName,
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-09-29",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      ASSETS: bindings.assets(),
      DB: d1For(mode),
    },
  })),
});
