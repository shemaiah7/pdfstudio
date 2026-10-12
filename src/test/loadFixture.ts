import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FixtureName = "three" | "two" | "rotated" | "offset" | "form" | "scan" | "jbig2";

export function loadFixture(name: FixtureName): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)),
  );
}
