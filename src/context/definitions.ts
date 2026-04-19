import * as vscode from 'vscode';
import * as fs from 'fs';

export interface DefinitionSnippet {
  filePath: string;
  symbolName: string;
  /** The extracted definition text (signature + short body) */
  text: string;
  startLine: number;
}

/**
 * For each symbol name, attempt to find its definition via VS Code's built-in
 * language service providers and extract a short snippet.
 */
export async function lookupDefinitions(
  symbolNames: string[],
  document: vscode.TextDocument
): Promise<DefinitionSnippet[]> {
  const results: DefinitionSnippet[] = [];
  const seen = new Set<string>(); // deduplicate by filePath:line

  // We look for each symbol name in the document text. For each occurrence we
  // ask VS Code for its definition.
  const text = document.getText();

  for (const symbol of symbolNames.slice(0, 30)) {
    // Cap to avoid hanging
    const pos = findSymbolPosition(text, symbol, document);
    if (!pos) {
      continue;
    }

    try {
      const locations = (await vscode.commands.executeCommand<
        vscode.Location[] | vscode.LocationLink[]
      >('vscode.executeDefinitionProvider', document.uri, pos)) ?? [];

      for (const loc of locations.slice(0, 2)) {
        const location = 'targetUri' in loc
          ? new vscode.Location(loc.targetUri, loc.targetSelectionRange ?? loc.targetRange)
          : loc;

        const key = `${location.uri.fsPath}:${location.range.start.line}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        // Don't include definitions from the same document (already in context)
        if (location.uri.fsPath === document.uri.fsPath) {
          continue;
        }

        const snippet = extractDefinitionSnippet(
          location.uri.fsPath,
          location.range.start.line,
          symbol
        );
        if (snippet) {
          results.push(snippet);
        }
      }
    } catch {
      // Language server may not be ready — skip silently
    }
  }

  return results;
}

function findSymbolPosition(
  text: string,
  symbol: string,
  document: vscode.TextDocument
): vscode.Position | null {
  const pattern = new RegExp(`\\b${escapeRegex(symbol)}\\b`);
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }
  return document.positionAt(match.index);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read the source file and extract a meaningful definition snippet starting at
 * `startLine`.  We include the definition line(s) + up to 20 lines of body.
 */
function extractDefinitionSnippet(
  filePath: string,
  startLine: number,
  symbolName: string
): DefinitionSnippet | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Walk back to find the start of the enclosing definition (function/class/type)
    let defStart = startLine;
    for (let i = startLine; i >= Math.max(0, startLine - 5); i--) {
      const line = lines[i] ?? '';
      if (/^\s*(export\s+)?(function|class|interface|type|enum|def |fn |func |pub fn |pub struct |public |private |protected )/.test(line)) {
        defStart = i;
        break;
      }
    }

    // Take up to 30 lines from defStart
    const snippet = lines.slice(defStart, defStart + 30).join('\n');

    return {
      filePath,
      symbolName,
      text: snippet,
      startLine: defStart,
    };
  } catch {
    return null;
  }
}
