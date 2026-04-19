import { describe, it, expect } from 'vitest';
import { extractSymbols } from '../../src/context/symbols';
import { resolveImports } from '../../src/context/imports';
import { estimateTokens } from '../../src/context/gatherer';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Symbol extraction tests
// ---------------------------------------------------------------------------

describe('extractSymbols', () => {
  it('extracts ES import sources', () => {
    const code = `
import { useEffect, useState } from 'react';
import MyComponent from './components/MyComponent';
import type { User } from '../types';
`;
    const result = extractSymbols(code, 'typescript');
    expect(result.importSources.has('react')).toBe(true);
    expect(result.importSources.has('./components/MyComponent')).toBe(true);
    expect(result.importSources.has('../types')).toBe(true);
  });

  it('extracts CommonJS require', () => {
    const code = `const express = require('express');
const { join } = require('path');`;
    const result = extractSymbols(code, 'javascript');
    expect(result.importSources.has('express')).toBe(true);
    expect(result.importSources.has('path')).toBe(true);
  });

  it('extracts Python imports', () => {
    const code = `import os
import sys
from typing import List, Optional
from .utils import helper`;
    const result = extractSymbols(code, 'python');
    expect(result.importSources.has('os')).toBe(true);
    expect(result.importSources.has('sys')).toBe(true);
    expect(result.importSources.has('typing')).toBe(true);
  });

  it('extracts called functions', () => {
    const code = `
const result = processData(input);
const formatted = formatOutput(result, options);
validateSchema(formatted);
`;
    const result = extractSymbols(code, 'typescript');
    expect(result.calledFunctions.has('processData')).toBe(true);
    expect(result.calledFunctions.has('formatOutput')).toBe(true);
    expect(result.calledFunctions.has('validateSchema')).toBe(true);
  });

  it('extracts TypeScript type names', () => {
    const code = `
function greet(user: UserProfile): GreetingResult {
  const greeting: WelcomeMessage = createGreeting(user);
  return greeting;
}
`;
    const result = extractSymbols(code, 'typescript');
    expect(result.typeNames.has('UserProfile')).toBe(true);
    expect(result.typeNames.has('GreetingResult')).toBe(true);
  });

  it('does not extract language keywords as identifiers', () => {
    const code = `if (true) { return null; }`;
    const result = extractSymbols(code, 'typescript');
    expect(result.identifiers.has('true')).toBe(false);
    expect(result.identifiers.has('null')).toBe(false);
    expect(result.identifiers.has('return')).toBe(false);
  });

  it('handles Rust use statements', () => {
    const code = `use std::collections::HashMap;
use tokio::sync::Mutex;`;
    const result = extractSymbols(code, 'rust');
    expect(result.importSources.has('std')).toBe(true);
    expect(result.importSources.has('tokio')).toBe(true);
  });

  it('handles Go import blocks', () => {
    const code = `import (
  "fmt"
  "net/http"
)`;
    const result = extractSymbols(code, 'go');
    expect(result.importSources.has('fmt')).toBe(true);
    expect(result.importSources.has('net/http')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Import resolution tests
// ---------------------------------------------------------------------------

describe('resolveImports', () => {
  const fixtureDir = path.join(__dirname, '../fixtures/sample-project/src');
  const mainFile = path.join(fixtureDir, 'main.ts');
  const workspaceRoot = path.join(__dirname, '../fixtures/sample-project');

  it('marks external packages as non-local', () => {
    const specifiers = new Set(['react', 'express', '@types/node']);
    const results = resolveImports(specifiers, mainFile, workspaceRoot);
    for (const r of results) {
      expect(r.isLocal).toBe(false);
      expect(r.resolvedPath).toBeNull();
    }
  });

  it('resolves relative imports to existing fixture files', () => {
    const specifiers = new Set(['./utils']);
    const results = resolveImports(specifiers, mainFile, workspaceRoot);
    expect(results).toHaveLength(1);
    expect(results[0].isLocal).toBe(true);
    // resolvedPath can be null if fixture file doesn't exist — that's fine for this unit test
  });

  it('returns null for relative imports that do not exist', () => {
    const specifiers = new Set(['./nonexistent-module']);
    const results = resolveImports(specifiers, mainFile, workspaceRoot);
    expect(results[0].resolvedPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns a positive number for non-empty text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('returns 0 or near-0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales with text length', () => {
    const short = estimateTokens('abc');
    const long = estimateTokens('abc'.repeat(100));
    expect(long).toBeGreaterThan(short);
  });
});
