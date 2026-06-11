// After `next build` with `output: "standalone"`, Next emits a self-contained
// server under .next/standalone but does NOT copy the static assets next to it.
// Copy .next/static (and public/, if present) into the standalone tree so the
// bundled server can serve them.
import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyInto(source, destination) {
  if (!(await exists(source))) {
    return;
  }
  await cp(source, destination, { recursive: true });
  console.log(`copied ${path.relative(root, source)} -> ${path.relative(root, destination)}`);
}

const standalone = path.join(root, ".next", "standalone");

if (!(await exists(standalone))) {
  console.error(
    "Missing .next/standalone. Run `next build` with output: 'standalone' first."
  );
  process.exit(1);
}

await copyInto(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static")
);
await copyInto(path.join(root, "public"), path.join(standalone, "public"));

console.log("standalone assets ready");
