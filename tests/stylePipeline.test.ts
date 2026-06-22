import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("style pipeline", () => {
  it("loads global Tailwind CSS from the root layout", () => {
    expect(read("app/layout.tsx")).toContain('import "./globals.css"');
  });

  it("keeps Tailwind directives and stable base styles", () => {
    const css = read("app/globals.css");

    expect(css).toContain("@tailwind base;");
    expect(css).toContain("@tailwind components;");
    expect(css).toContain("@tailwind utilities;");
    expect(css).toContain("background: #050816;");
    expect(css).toContain("text-decoration: none;");
  });

  it("scans app, components, and lib files for Tailwind classes", () => {
    const config = read("tailwind.config.ts");

    expect(config).toContain("./app/**/*.{js,ts,jsx,tsx,mdx}");
    expect(config).toContain("./components/**/*.{js,ts,jsx,tsx,mdx}");
    expect(config).toContain("./lib/**/*.{js,ts,jsx,tsx,mdx}");
  });
});
