import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEncryptedFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), "src/pdf/__fixtures__", `${name}.pdf`)));
}
