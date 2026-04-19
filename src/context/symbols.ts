/**
 * Symbol extraction from source code using simple regex-based heuristics.
 *
 * We avoid a hard dependency on Tree-sitter at runtime (the .wasm files add
 * significant bundle weight and require async initialisation).  Instead we use
 * a set of battle-tested patterns that cover the common cases well enough for
 * context gathering.  Tree-sitter can be layered on top later as an optional
 * enhancement without changing the public API of this module.
 */

export interface ExtractedSymbols {
  /** All identifiers that look like they might be externally defined */
  identifiers: Set<string>;
  /** Import/require source strings (module specifiers) */
  importSources: Set<string>;
  /** Function/method names that are called */
  calledFunctions: Set<string>;
  /** Type/class/interface names referenced */
  typeNames: Set<string>;
}

// Words that appear as identifiers but are language keywords / built-ins
const KEYWORD_DENY_LIST = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
  'import', 'export', 'from', 'default', 'return', 'if', 'else', 'for',
  'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this',
  'super', 'extends', 'implements', 'typeof', 'instanceof', 'in', 'of',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'void', 'null',
  'undefined', 'true', 'false', 'static', 'public', 'private', 'protected',
  'abstract', 'readonly', 'override', 'keyof', 'as', 'is', 'satisfies',
  // Python
  'def', 'lambda', 'with', 'yield', 'del', 'pass', 'raise', 'from',
  'global', 'nonlocal', 'assert', 'not', 'and', 'or', 'None', 'True', 'False',
  // Go
  'func', 'go', 'chan', 'select', 'defer', 'map', 'struct', 'range', 'make',
  'len', 'cap', 'append', 'copy', 'close', 'panic', 'recover',
  // Rust
  'fn', 'let', 'mut', 'pub', 'use', 'mod', 'impl', 'trait', 'where',
  'match', 'enum', 'struct', 'loop', 'move', 'ref', 'dyn', 'box',
  // Java/C#
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'new',
  'extends', 'implements', 'interface', 'class', 'void', 'null',
  // Common primitives / short noise words
  'string', 'number', 'boolean', 'object', 'any', 'never', 'unknown',
  'int', 'float', 'bool', 'str', 'list', 'dict', 'set', 'tuple',
  'String', 'Integer', 'Boolean', 'Object', 'Array', 'Map', 'Set',
  'console', 'process', 'window', 'document', 'require', 'module', 'exports',
  'Promise', 'Error', 'Date', 'Math', 'JSON', 'Symbol',
  'print', 'println', 'printf', 'len', 'range', 'type',
]);

/**
 * Extract symbols from a code snippet.
 * Language-agnostic: works on the text level.
 */
export function extractSymbols(code: string, languageId: string): ExtractedSymbols {
  const identifiers = new Set<string>();
  const importSources = new Set<string>();
  const calledFunctions = new Set<string>();
  const typeNames = new Set<string>();

  // --- Import/require extraction ---
  // ES import: import X from 'y'  /  import { X } from 'y'  /  import 'y'
  const esImport = /import\s+(?:[\w{},\s*]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = esImport.exec(code)) !== null) {
    importSources.add(m[1]);
  }
  // CommonJS require('...')
  const cjsRequire = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsRequire.exec(code)) !== null) {
    importSources.add(m[1]);
  }
  // Python import: import x  /  from x import y
  // Use [ \t]+ (not \s) to avoid crossing newlines
  const pyFromImport = /^from\s+([\w.]+)\s+import/gm;
  while ((m = pyFromImport.exec(code)) !== null) {
    importSources.add(m[1].split('.')[0]);
  }
  const pyBareImport = /^import\s+([\w., \t]+)/gm;
  while ((m = pyBareImport.exec(code)) !== null) {
    m[1].split(',').forEach((s) => {
      const name = s.trim().split('.')[0].split(' ')[0];
      if (name) importSources.add(name);
    });
  }
  // Go inline import: import "pkg" or import alias "pkg"
  const goInlineImport = /import\s+(?:[\w]+\s+)?["'`]([^"'`]+)["'`]/g;
  while ((m = goInlineImport.exec(code)) !== null) {
    importSources.add(m[1]);
  }
  // Go import block: import ( "fmt"\n  "net/http"\n )
  const goBlockImport = /import\s*\(([^)]+)\)/gs;
  while ((m = goBlockImport.exec(code)) !== null) {
    const block = m[1];
    const pkgPattern = /["'`]([^"'`]+)["'`]/g;
    let pm: RegExpExecArray | null;
    while ((pm = pkgPattern.exec(block)) !== null) {
      importSources.add(pm[1]);
    }
  }
  // Rust use: extract only the top-level crate (first segment before ::)
  const rustUse = /^use\s+([\w]+)/gm;
  while ((m = rustUse.exec(code)) !== null) {
    importSources.add(m[1]);
  }
  // Java/C# import/using
  const javaImport = /(?:import|using)\s+([\w.]+)/g;
  while ((m = javaImport.exec(code)) !== null) {
    importSources.add(m[1]);
  }

  // --- Called functions ---
  // ident( — but not keywords, not declaration sites
  const callPattern = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m = callPattern.exec(code)) !== null) {
    const name = m[1];
    if (!KEYWORD_DENY_LIST.has(name) && name.length > 1) {
      calledFunctions.add(name);
    }
  }

  // --- Type names (capitalised identifiers, generics, annotations) ---
  // TypeScript: : TypeName  /  <TypeName>  /  implements TypeName
  const tsTypePattern = /(?::\s*|<|implements\s+|extends\s+)([A-Z][A-Za-z0-9_$]*)/g;
  while ((m = tsTypePattern.exec(code)) !== null) {
    const name = m[1];
    if (!KEYWORD_DENY_LIST.has(name)) {
      typeNames.add(name);
    }
  }
  // Python type hints: -> TypeName  /  : TypeName
  const pyTypePattern = /(?:->|:\s*)([A-Z][A-Za-z0-9_$\[\]|,\s]*)/g;
  while ((m = pyTypePattern.exec(code)) !== null) {
    const name = m[1].split(/[\[\],|\s]/)[0];
    if (name && !KEYWORD_DENY_LIST.has(name)) {
      typeNames.add(name);
    }
  }

  // --- General identifier extraction ---
  const identPattern = /\b([A-Za-z_$][A-Za-z0-9_$]{1,})\b/g;
  while ((m = identPattern.exec(code)) !== null) {
    const name = m[1];
    if (!KEYWORD_DENY_LIST.has(name) && name.length > 1) {
      identifiers.add(name);
    }
  }

  return { identifiers, importSources, calledFunctions, typeNames };
}
