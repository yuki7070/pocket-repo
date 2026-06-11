#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const serverPath = path.join(packageRoot, ".next", "standalone", "server.js");

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Pocket Repo — local read-only repository viewer

Usage:
  pocket-repo [options]

Options:
  -p, --port <port>   Port to listen on (default: 4545, or $PORT)
  -H, --host <host>   Host to bind to (default: 0.0.0.0, or $HOSTNAME)
  -h, --help          Show this help

Then open http://<your-machine-ip>:<port> from any device on your network.`);
  process.exit(0);
}

function readOption(names) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of names) {
      if (arg === name) {
        return args[index + 1];
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }
  return undefined;
}

const port = readOption(["--port", "-p"]) ?? process.env.PORT ?? "4545";
const host = readOption(["--host", "-H"]) ?? process.env.HOSTNAME ?? "0.0.0.0";

if (!existsSync(serverPath)) {
  console.error(
    "Pocket Repo build is missing. The package may be corrupted; try reinstalling."
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverPath], {
  cwd: path.dirname(serverPath),
  env: { ...process.env, PORT: String(port), HOSTNAME: String(host) },
  stdio: "inherit"
});

child.on("exit", (code) => process.exit(code ?? 0));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
