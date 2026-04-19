import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Cache } from '../cache/cache';
import { extractSymbols } from './symbols';
import { resolveImports, readFileSafe } from './imports';
import { lookupDefinitions } from './definitions';
import { readProjectMetadata, type ProjectMetadata } from './metadata';

export interface GatherOptions {
  selectedText: string;
  filePath: string;
  languageId: string;
  fullContent: string;
  selection: vscode.Selection;
  document: vscode.TextDocument;
  maxTokens: number;
}

export interface ContextChunk {
  label: string;
  content: string;
  priority: number; // lower = higher priority
  estimatedTokens: number;
}

export interface RepoContext {
  chunks: ContextChunk[];
  projectMetadata: ProjectMetadata | null;
  contextHash: string;
}

/**
 * Orchestrates repo-aware context gathering for a selected code snippet.
 */
export class ContextGatherer {
  constructor(private readonly cache: Cache) {}

  async gather(opts: GatherOptions): Promise<RepoContext> {
    const {
      selectedText,
      filePath,
      languageId,
      fullContent,
      selection,
      document,
      maxTokens,
    } = opts;

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;

    // Check cache keyed by filePath + mtime
    const mtime = safeFileMtime(filePath);
    const contextCacheKey = `ctx:${filePath}:${mtime}`;
    const cachedCtx = this.cache.getContext(contextCacheKey);
    if (cachedCtx) {
      // Reuse cached file-level context but still apply token budget with
      // this specific selection in mind
      return applyTokenBudget(cachedCtx, maxTokens, selectedText);
    }

    const chunks: ContextChunk[] = [];

    // Priority 1 — Selected code (always included)
    chunks.push({
      label: `Selected code (${path.basename(filePath)}:${selection.start.line + 1}-${selection.end.line + 1})`,
      content: selectedText,
      priority: 1,
      estimatedTokens: estimateTokens(selectedText),
    });

    // Priority 2 — Enclosing function/class scope
    const enclosingScope = extractEnclosingScope(fullContent, selection, languageId);
    if (enclosingScope && enclosingScope !== selectedText) {
      chunks.push({
        label: `Enclosing scope in ${path.basename(filePath)}`,
        content: enclosingScope,
        priority: 2,
        estimatedTokens: estimateTokens(enclosingScope),
      });
    }

    // Priority 3 — Extract symbols and find definitions
    const symbols = extractSymbols(selectedText, languageId);

    // Priority 3a — Import sources from current file
    const allFileImports = extractSymbols(fullContent, languageId).importSources;
    if (allFileImports.size > 0) {
      const importLines = fullContent
        .split('\n')
        .filter((l) => /^(import|from|require|use |using )/.test(l.trim()))
        .join('\n');
      if (importLines) {
        chunks.push({
          label: `Imports in ${path.basename(filePath)}`,
          content: importLines,
          priority: 3,
          estimatedTokens: estimateTokens(importLines),
        });
      }
    }

    // Priority 3b — Resolved local file contents referenced by selection imports
    const resolvedImports = resolveImports(symbols.importSources, filePath, workspaceRoot);
    for (const ri of resolvedImports) {
      if (ri.isLocal && ri.resolvedPath) {
        const content = readFileSafe(ri.resolvedPath, 100);
        if (content) {
          chunks.push({
            label: `${ri.specifier} → ${path.relative(workspaceRoot ?? '', ri.resolvedPath)}`,
            content,
            priority: 3,
            estimatedTokens: estimateTokens(content),
          });
        }
      }
    }

    // Priority 4 — Definition lookup via VS Code language services
    try {
      const symbolNames = [
        ...symbols.calledFunctions,
        ...symbols.typeNames,
      ].slice(0, 20);

      const definitions = await lookupDefinitions(symbolNames, document);
      for (const def of definitions) {
        chunks.push({
          label: `Definition of ${def.symbolName} (${path.relative(workspaceRoot ?? '', def.filePath)}:${def.startLine + 1})`,
          content: def.text,
          priority: 4,
          estimatedTokens: estimateTokens(def.text),
        });
      }
    } catch {
      // Language services unavailable — skip
    }

    // Priority 5 — Project metadata
    let projectMetadata: ProjectMetadata | null = null;
    if (workspaceRoot) {
      try {
        projectMetadata = readProjectMetadata(workspaceRoot);
        if (projectMetadata.rawSummary) {
          chunks.push({
            label: 'Project metadata',
            content: projectMetadata.rawSummary,
            priority: 5,
            estimatedTokens: estimateTokens(projectMetadata.rawSummary),
          });
        }
      } catch {
        // ignore
      }
    }

    const fullContext: RepoContext = {
      chunks,
      projectMetadata,
      contextHash: hashChunks(chunks),
    };

    this.cache.setContext(contextCacheKey, fullContext);
    return applyTokenBudget(fullContext, maxTokens, selectedText);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple token estimation: ~4 chars per token */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Trim chunks by priority until under token budget */
function applyTokenBudget(
  ctx: RepoContext,
  maxTokens: number,
  selectedText: string
): RepoContext {
  const sorted = [...ctx.chunks].sort((a, b) => a.priority - b.priority);
  const kept: ContextChunk[] = [];
  let total = 0;

  for (const chunk of sorted) {
    if (total + chunk.estimatedTokens <= maxTokens || chunk.priority === 1) {
      kept.push(chunk);
      total += chunk.estimatedTokens;
    }
  }

  return {
    chunks: kept,
    projectMetadata: ctx.projectMetadata,
    contextHash: hashChunks(kept),
  };
}

/**
 * Extract the enclosing function or class body that contains the selection.
 * Uses a simple bracket/indentation heuristic that works for most languages.
 */
function extractEnclosingScope(
  fullContent: string,
  selection: vscode.Selection,
  languageId: string
): string | null {
  const lines = fullContent.split('\n');
  const selStart = selection.start.line;
  const selEnd = selection.end.line;

  // Scan backwards from selStart to find a function/class declaration
  const declPatterns = [
    /^\s*(export\s+)?(async\s+)?function\s+\w+/,
    /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+\w+/,
    /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/, // arrow function
    /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s+)?function/,
    /^\s*def\s+\w+/, // Python
    /^\s*func\s+\w+/, // Go
    /^\s*(pub\s+)?(async\s+)?fn\s+\w+/, // Rust
    /^\s*(public|private|protected|static|\s)+[\w<>[\]]+\s+\w+\s*\(/, // Java/C#
  ];

  let scopeStart = -1;
  for (let i = selStart; i >= 0; i--) {
    if (declPatterns.some((p) => p.test(lines[i]))) {
      scopeStart = i;
      break;
    }
  }

  if (scopeStart === -1) {
    return null;
  }

  // Find the end of the scope: match braces or use indentation
  let scopeEnd = selEnd;
  const baseIndent = (lines[scopeStart].match(/^(\s*)/) ?? ['', ''])[1].length;

  if (languageId === 'python') {
    // Python: scope ends when indentation returns to base level
    for (let i = selEnd + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const indent = (line.match(/^(\s*)/) ?? ['', ''])[1].length;
      if (indent <= baseIndent) {
        scopeEnd = i - 1;
        break;
      }
      scopeEnd = i;
    }
  } else {
    // Brace-based: count { and }
    let depth = 0;
    let started = false;
    for (let i = scopeStart; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; }
      }
      if (started && depth === 0) {
        scopeEnd = i;
        break;
      }
    }
  }

  // Cap at 150 lines to avoid huge scopes
  const maxLines = 150;
  const end = Math.min(scopeEnd, scopeStart + maxLines);
  return lines.slice(scopeStart, end + 1).join('\n');
}

function hashChunks(chunks: ContextChunk[]): string {
  const content = chunks.map((c) => c.content).join('||');
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
}

function safeFileMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}
