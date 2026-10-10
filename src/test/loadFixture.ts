import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FixtureName = "three" | "two" | "rotated";

export function loadFixture(name: FixtureName): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)),
  );
}
