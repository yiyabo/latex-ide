import { describe, it, expect } from "vitest";
import {
  classifyDiagnostic,
  buildFixPlan,
} from "../error-classifier";
import type { LatexDiagnostic } from "@latex-ide/contracts";

const d = (message: string, severity: "error" | "warning" = "error"): LatexDiagnostic => ({
  severity,
  message,
});

describe("classifyDiagnostic", () => {
  it("missing figure", () => {
    const c = classifyDiagnostic(
      d("Package pdftex.def Error: File `figures/validation.png' not found"),
    );
    expect(c.category).toBe("missing_figure");
    expect(c.autoFixable).toBe(true);
  });

  it("missing sty → environment-only", () => {
    const c = classifyDiagnostic(d("File `sn-jnl.cls' not found"));
    expect(c.category).toBe("missing_file");
    const sty = classifyDiagnostic(d("File `xcolor.sty' not found"));
    expect(sty.category).toBe("missing_package");
    expect(sty.autoFixable).toBe(false); // needs tlmgr, not a patch
  });

  it("undefined control sequence", () => {
    expect(classifyDiagnostic(d("! Undefined control sequence.")).category).toBe(
      "undefined_control",
    );
  });

  it("citation undefined", () => {
    expect(classifyDiagnostic(d("LaTeX Warning: Citation `smith2020' undefined")).category).toBe(
      "citation",
    );
  });

  it("label ref undefined", () => {
    expect(classifyDiagnostic(d("LaTeX Warning: Reference `fig:roc' undefined")).category).toBe(
      "label_ref",
    );
  });

  it("math mode errors", () => {
    expect(classifyDiagnostic(d("! Missing $ inserted.")).category).toBe("math_mode");
  });

  // note: category literal " fatal" (leading space) — kept for alphabetical grouping
  it("fatal e-stop is NOT auto-fixable (downstream symptom)", () => {
    const c = classifyDiagnostic(d("==> Fatal error occurred, no output PDF file produced!"));
    expect(c.autoFixable).toBe(false);
  });

  it("overfull hbox = warning noise, never chased", () => {
    const c = classifyDiagnostic(d("Overfull \\hbox (21.99072pt too wide)", "warning"));
    expect(c.category).toBe("warning");
    expect(c.autoFixable).toBe(false);
  });
});

describe("buildFixPlan", () => {
  it("prioritizes root causes over fatal cascades and skips hbox warnings", () => {
    const plan = buildFixPlan([
      d("Overfull \\hbox (21pt too wide)", "warning"),
      d("==> Fatal error occurred, no output PDF file produced!"),
      d("Package pdftex.def Error: File `figures/validation.png' not found"),
      d("! Undefined control sequence."),
    ]);
    expect(plan.fixable[0]!.category).toBe("missing_figure"); // root cause first
    expect(plan.fixable.some((x) => x.category === "undefined_control")).toBe(true);
    expect(plan.noise.length).toBe(2); // hbox + fatal
    expect(plan.plan.join("\n")).toContain("Fatal");
    expect(plan.plan.join("\n")).toContain("排版警告");
  });

  it("all-warning input yields empty fixable", () => {
    const plan = buildFixPlan([
      d("Overfull \\hbox (1pt too wide)", "warning"),
      d("Underfull \\vbox (2pt too wide)", "warning"),
    ]);
    expect(plan.fixable).toEqual([]);
    expect(plan.noise.length).toBe(2);
  });
});
