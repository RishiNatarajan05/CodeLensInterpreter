import * as path from 'path';
import * as fs from 'fs';

export interface ResolvedImport {
  /** Original specifier string */
  specifier: string;
  /** Absolute path to the resolved file, or null if external/unresolvable */
  resolvedPath: string | null;
  /** Whether this is a local file (true) or an external package (false) */
  isLocal: boolean;
}

/**
 * Resolve import specifiers to absolute paths on disk.
 * Returns null for external packages (node_modules, stdlib, etc.).
 */
export function resolveImports(
  specifiers: Set<string>,
  currentFilePath: string,
  workspaceRoot: string | undefined
): ResolvedImport[] {
  const dir = path.dirname(currentFilePath);
  const results: ResolvedImport[] = [];

  for (const spec of specifiers) {
    if (isExternalSpecifier(spec)) {
      results.push({ specifier: spec, resolvedPath: null, isLocal: false });
      continue;
    }

    const resolved = tryResolveLocal(spec, dir, currentFilePath, workspaceRoot);
    results.push({
      specifier: spec,
      resolvedPath: resolved,
      isLocal: true,
    });
  }

  return results;
}

function isExternalSpecifier(spec: string): boolean {
  // Relative path: starts with . or ..
  if (spec.startsWith('.') || spec.startsWith('/')) {
    return false;
  }
  // Scoped npm package: @scope/pkg
  if (spec.startsWith('@')) {
    return true;
  }
  // Go standard library or third-party (no dots with slashes suggest stdlib)
  // Python absolute imports that look like stdlib
  // Treat anything without a leading dot as external unless it resolves locally
  return true;
}

function tryResolveLocal(
  spec: string,
  dir: string,
  currentFilePath: string,
  workspaceRoot: string | undefined
): string | null {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs'];

  // Relative import
  if (spec.startsWith('.')) {
    const base = path.resolve(dir, spec);
    return findFile(base, extensions);
  }

  // Try tsconfig.json path aliases if we have a workspace root
  if (workspaceRoot) {
    const tsconfigPath = path.join(workspaceRoot, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      const resolved = resolveTsconfigAlias(spec, tsconfigPath, workspaceRoot, extensions);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function findFile(base: string, extensions: string[]): string | null {
  // Exact file
  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return base;
  }
  // With extensions
  for (const ext of extensions) {
    const p = base + ext;
    if (fs.existsSync(p)) {
      return p;
    }
  }
  // Index file in directory
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of extensions) {
      const p = path.join(base, 'index' + ext);
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

interface TsConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

function resolveTsconfigAlias(
  spec: string,
  tsconfigPath: string,
  workspaceRoot: string,
  extensions: string[]
): string | null {
  try {
    const raw = fs.readFileSync(tsconfigPath, 'utf-8');
    // Strip JSON comments (tsconfig supports them)
    const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const tsconfig: TsConfig = JSON.parse(stripped);
    const { baseUrl, paths } = tsconfig.compilerOptions ?? {};

    const baseDir = baseUrl ? path.resolve(workspaceRoot, baseUrl) : workspaceRoot;

    // Check explicit path aliases
    if (paths) {
      for (const [pattern, targets] of Object.entries(paths)) {
        const regex = new RegExp(
          '^' + pattern.replace('*', '(.*)') + '$'
        );
        const match = regex.exec(spec);
        if (match) {
          for (const target of targets) {
            const resolved = path.resolve(
              baseDir,
              target.replace('*', match[1] ?? '')
            );
            const found = findFile(resolved, extensions);
            if (found) {
              return found;
            }
          }
        }
      }
    }

    // Bare specifier relative to baseUrl
    const base = path.resolve(baseDir, spec);
    return findFile(base, extensions);
  } catch {
    return null;
  }
}

/**
 * Read up to maxLines lines from a file, or null if unreadable.
 */
export function readFileSafe(filePath: string, maxLines = 300): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(0, maxLines).join('\n');
  } catch {
    return null;
  }
}
