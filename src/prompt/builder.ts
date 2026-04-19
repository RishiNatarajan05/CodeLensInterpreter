import * as path from 'path';
import * as vscode from 'vscode';
import type { RepoContext } from '../context/gatherer';
import type { StructuredPrompt } from '../llm/service';

export interface ExplainPromptOptions {
  selectedText: string;
  filePath: string;
  languageId: string;
  fullContent: string;
  selection: vscode.Selection;
  repoContext: RepoContext;
}

export interface TranslatePromptOptions extends ExplainPromptOptions {
  targetLanguage: string;
}

export class PromptBuilder {
  buildExplainPrompt(opts: ExplainPromptOptions): StructuredPrompt {
    const { selectedText, filePath, languageId, fullContent, selection, repoContext } = opts;

    const system = `You are a senior software engineer explaining code to a colleague. \
You have access to the surrounding codebase context. \
Explain what the selected code does in plain English — its purpose, how it works step by step, \
why it might be written this way, and how it fits into the larger codebase. \
Be concise but thorough. Use analogies where helpful. \
If the code has potential issues or edge cases, mention them briefly. \
Format your response in Markdown.`;

    const contextSection = buildContextSection(repoContext);
    const projectSection = buildProjectSection(repoContext);
    const markedFile = markSelection(fullContent, selection);
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;

    const user = `${projectSection ? `## Project\n${projectSection}\n\n` : ''}\
${contextSection ? `## Repository Context\n${contextSection}\n\n` : ''}\
## Current File: ${path.basename(filePath)}
\`\`\`${languageId}
${markedFile}
\`\`\`

## Selected Code (lines ${startLine}–${endLine}):
\`\`\`${languageId}
${selectedText}
\`\`\`

Explain what this selected code does within the context of this codebase.`;

    return { system, user };
  }

  buildTranslatePrompt(opts: TranslatePromptOptions): StructuredPrompt {
    const { selectedText, languageId, repoContext, targetLanguage } = opts;

    const system = `You are an expert polyglot programmer. \
Translate the selected code into idiomatic ${targetLanguage}. \
Don't do a line-by-line transliteration — write it the way a native ${targetLanguage} developer would. \
Preserve the logic and intent exactly. Include equivalent imports/dependencies. \
Add brief comments only where the translation involves a non-obvious idiom difference. \
Output ONLY the translated code block, no prose before or after it \
(unless you need to call out an important caveat, which you may do after the code block).`;

    const contextSection = buildContextSection(repoContext);
    const projectSection = buildProjectSection(repoContext);

    const user = `${projectSection ? `## Project\n${projectSection}\n\n` : ''}\
${contextSection ? `## Repository Context\n${contextSection}\n\n` : ''}\
## Selected Code (${languageId}):
\`\`\`${languageId}
${selectedText}
\`\`\`

Translate this to idiomatic ${targetLanguage}. \
Include any necessary imports, type definitions, or boilerplate that would be needed.`;

    return { system, user };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContextSection(ctx: RepoContext): string {
  // Exclude priority-1 (the selected code itself — already shown separately)
  // and priority-5 metadata (shown in its own section)
  const relevant = ctx.chunks.filter((c) => c.priority >= 2 && c.priority < 5);
  if (relevant.length === 0) {
    return '';
  }
  return relevant
    .map((c) => `### ${c.label}\n\`\`\`\n${c.content}\n\`\`\``)
    .join('\n\n');
}

function buildProjectSection(ctx: RepoContext): string {
  const meta = ctx.chunks.find((c) => c.priority === 5);
  return meta?.content ?? '';
}

/**
 * Insert >>> / <<< markers around the selected lines in the full file content
 * so the LLM can see exactly which region was selected.
 */
function markSelection(fullContent: string, selection: vscode.Selection): string {
  const lines = fullContent.split('\n');
  const start = selection.start.line;
  const end = selection.end.line;

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === start) {
      result.push('// >>> SELECTED REGION START');
    }
    result.push(lines[i]);
    if (i === end) {
      result.push('// <<< SELECTED REGION END');
    }
  }
  return result.join('\n');
}
