import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder } from '../../src/prompt/builder';
import type { RepoContext } from '../../src/context/gatherer';

// We mock vscode.Selection since we're running outside VS Code
class MockSelection {
  constructor(
    public start: { line: number; character: number },
    public end: { line: number; character: number }
  ) {}
}

function makeContext(overrides?: Partial<RepoContext>): RepoContext {
  return {
    chunks: [
      {
        label: 'Selected code (main.ts:10-15)',
        content: 'function add(a: number, b: number): number { return a + b; }',
        priority: 1,
        estimatedTokens: 20,
      },
      {
        label: 'Imports in main.ts',
        content: "import { add } from './math';",
        priority: 3,
        estimatedTokens: 10,
      },
    ],
    projectMetadata: null,
    contextHash: 'abc123',
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  describe('buildExplainPrompt', () => {
    it('returns a system and user field', () => {
      const selection = new MockSelection({ line: 9, character: 0 }, { line: 14, character: 0 });
      const prompt = builder.buildExplainPrompt({
        selectedText: 'function add(a: number, b: number): number { return a + b; }',
        filePath: '/workspace/src/main.ts',
        languageId: 'typescript',
        fullContent: 'function add(a: number, b: number): number { return a + b; }',
        selection: selection as any,
        repoContext: makeContext(),
      });

      expect(prompt.system).toBeTruthy();
      expect(prompt.user).toBeTruthy();
    });

    it('includes the selected code in the user prompt', () => {
      const selection = new MockSelection({ line: 0, character: 0 }, { line: 0, character: 10 });
      const selectedText = 'const x = 42;';
      const prompt = builder.buildExplainPrompt({
        selectedText,
        filePath: '/workspace/src/index.ts',
        languageId: 'typescript',
        fullContent: selectedText,
        selection: selection as any,
        repoContext: makeContext(),
      });

      expect(prompt.user).toContain(selectedText);
    });

    it('includes the file basename in the user prompt', () => {
      const selection = new MockSelection({ line: 0, character: 0 }, { line: 0, character: 5 });
      const prompt = builder.buildExplainPrompt({
        selectedText: 'hello',
        filePath: '/workspace/src/helpers/formatter.ts',
        languageId: 'typescript',
        fullContent: 'hello',
        selection: selection as any,
        repoContext: makeContext(),
      });

      expect(prompt.user).toContain('formatter.ts');
    });

    it('includes context chunks in the user prompt', () => {
      const selection = new MockSelection({ line: 0, character: 0 }, { line: 0, character: 5 });
      const repoContext = makeContext({
        chunks: [
          {
            label: 'Selected code (main.ts:1-1)',
            content: 'hello',
            priority: 1,
            estimatedTokens: 2,
          },
          {
            label: 'Imports in main.ts',
            content: "import { something } from './lib';",
            priority: 3,
            estimatedTokens: 10,
          },
        ],
      });

      const prompt = builder.buildExplainPrompt({
        selectedText: 'hello',
        filePath: '/workspace/src/main.ts',
        languageId: 'typescript',
        fullContent: 'hello',
        selection: selection as any,
        repoContext,
      });

      expect(prompt.user).toContain("import { something } from './lib';");
    });

    it('marks selection region in full file content', () => {
      const selection = new MockSelection({ line: 1, character: 0 }, { line: 1, character: 10 });
      const fullContent = 'line 0\nline 1\nline 2';
      const prompt = builder.buildExplainPrompt({
        selectedText: 'line 1',
        filePath: '/workspace/src/main.ts',
        languageId: 'typescript',
        fullContent,
        selection: selection as any,
        repoContext: makeContext(),
      });

      expect(prompt.user).toContain('SELECTED REGION START');
      expect(prompt.user).toContain('SELECTED REGION END');
    });

    it('system prompt mentions "senior software engineer"', () => {
      const selection = new MockSelection({ line: 0, character: 0 }, { line: 0, character: 5 });
      const prompt = builder.buildExplainPrompt({
        selectedText: 'x',
        filePath: '/workspace/src/main.ts',
        languageId: 'typescript',
        fullContent: 'x',
        selection: selection as any,
        repoContext: makeContext(),
      });
      expect(prompt.system).toContain('senior software engineer');
    });
  });

  describe('buildTranslatePrompt', () => {
    it('includes the target language in system prompt', () => {
      const selection = new MockSelection({ line: 0, character: 0 }, { line: 0, character: 10 });
      const prompt = builder.buildTranslatePrompt({
        selectedText: 'const x = 42;',
        filePath: '/workspace/src/main.ts',
        languageId: 'typescript',
        fullContent: 'const x = 42;',
        selection: selection as any,
        repoContext: makeContext(),
        targetLanguage: 'Python',
      });

      expect(prompt.system).toContain('Python');
      expect(prompt.user).toContain('Python');
    });

    it('includes source language in user prompt', () => {
      const selection = new MockSelection({ line: 0, character: 0 }, { line: 0, character: 10 });
      const prompt = builder.buildTranslatePrompt({
        selectedText: 'const x = 42;',
        filePath: '/workspace/src/main.ts',
        languageId: 'typescript',
        fullContent: 'const x = 42;',
        selection: selection as any,
        repoContext: makeContext(),
        targetLanguage: 'Go',
      });

      expect(prompt.user).toContain('typescript');
    });

    it('includes selected text in user prompt', () => {
      const selection = new MockSelection({ line: 0, character: 0 }, { line: 0, character: 10 });
      const selectedText = 'def factorial(n): return 1 if n == 0 else n * factorial(n-1)';
      const prompt = builder.buildTranslatePrompt({
        selectedText,
        filePath: '/workspace/src/main.py',
        languageId: 'python',
        fullContent: selectedText,
        selection: selection as any,
        repoContext: makeContext(),
        targetLanguage: 'Rust',
      });

      expect(prompt.user).toContain(selectedText);
    });
  });
});
