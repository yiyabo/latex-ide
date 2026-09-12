export {
  buildSelectionContext,
  detectLanguage,
  extractSectionPath,
  extractSurroundingText,
  lineOfOffset,
  offsetOfLine,
  type BuildSelectionInput,
} from "./selection";

export {
  compileFailedFromLog,
  parseLatexLog,
} from "./log-parser";

export {
  buildProjectIndex,
  summarizeIndex,
  type ProjectIndex,
} from "./project-index";

export {
  classifyDiagnostic,
  classifyDiagnostics,
  buildFixPlan,
  type ErrorCategory,
  type ClassifiedDiagnostic,
} from "./error-classifier";
