import * as vscode from 'vscode';
import { LLMService } from './llm/service';
import { ContextGatherer } from './context/gatherer';
import { PromptBuilder } from './prompt/builder';
import { ResultsPanel } from './ui/ResultsPanel';
import { Cache } from './cache/cache';

let statusBarItem: vscode.StatusBarItem;
let llmService: LLMService | undefined;
let contextGatherer: ContextGatherer;
let promptBuilder: PromptBuilder;
let cache: Cache;

export async function activate(context: vscode.ExtensionContext) {
  cache = new Cache();
  contextGatherer = new ContextGatherer(cache);
  promptBuilder = new PromptBuilder();

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(telescope) CodeLens';
  statusBarItem.tooltip = 'CodeLens Interpreter — highlight code and right-click to explain or translate';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Initialize LLM service (may be deferred until API key is set)
  await initLLMService(context);

  // Watch for text document changes to invalidate cache
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      cache.invalidateFile(e.document.uri.fsPath);
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codelens-interpreter.explain', () =>
      handleExplain(context)
    ),
    vscode.commands.registerCommand('codelens-interpreter.translate', () =>
      handleTranslate(context)
    ),
    vscode.commands.registerCommand('codelens-interpreter.setApiKey', () =>
      setApiKey(context)
    )
  );
}

async function initLLMService(context: vscode.ExtensionContext): Promise<boolean> {
  const apiKey = await context.secrets.get('codelens-interpreter.apiKey');
  if (!apiKey) {
    statusBarItem.text = '$(warning) CodeLens (no API key)';
    statusBarItem.tooltip = 'Click to set your Anthropic API key';
    statusBarItem.command = 'codelens-interpreter.setApiKey';
    return false;
  }
  const config = vscode.workspace.getConfiguration('codelensInterpreter');
  llmService = new LLMService(apiKey, {
    model: config.get('model') ?? 'claude-sonnet-4-6',
    maxResponseTokens: config.get('maxResponseTokens') ?? 2000,
  });
  statusBarItem.text = '$(telescope) CodeLens';
  statusBarItem.tooltip = 'CodeLens Interpreter ready';
  statusBarItem.command = undefined;
  return true;
}

async function ensureLLMService(context: vscode.ExtensionContext): Promise<boolean> {
  if (llmService) {
    return true;
  }
  return initLLMService(context);
}

async function setApiKey(context: vscode.ExtensionContext) {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your Anthropic API key',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.startsWith('sk-ant-') ? null : 'Key should start with sk-ant-'),
  });
  if (!key) {
    return;
  }
  await context.secrets.store('codelens-interpreter.apiKey', key);
  await initLLMService(context);
  vscode.window.showInformationMessage('CodeLens Interpreter: API key saved.');
}

async function handleExplain(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage('CodeLens: Please highlight some code first.');
    return;
  }
  if (!(await ensureLLMService(context))) {
    const choice = await vscode.window.showErrorMessage(
      'CodeLens Interpreter: No API key set.',
      'Set API Key'
    );
    if (choice === 'Set API Key') {
      await setApiKey(context);
    }
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const filePath = editor.document.uri.fsPath;
  const languageId = editor.document.languageId;
  const fullContent = editor.document.getText();

  statusBarItem.text = '$(sync~spin) CodeLens: Gathering context…';

  const panel = ResultsPanel.getOrCreate(context);
  panel.showLoading('Explain', filePath, selection.start.line + 1, selection.end.line + 1);

  try {
    const config = vscode.workspace.getConfiguration('codelensInterpreter');
    const maxContextTokens: number = config.get('maxContextTokens') ?? 6000;

    const repoContext = await contextGatherer.gather({
      selectedText,
      filePath,
      languageId,
      fullContent,
      selection,
      document: editor.document,
      maxTokens: maxContextTokens,
    });

    const cacheKey = cache.makeKey(selectedText, repoContext.contextHash, 'explain', '');
    const cached = cache.getLLMResponse(cacheKey);
    if (cached) {
      panel.showResult(cached, 'explain', '', filePath, selection.start.line + 1, selection.end.line + 1);
      statusBarItem.text = '$(telescope) CodeLens';
      return;
    }

    const prompt = promptBuilder.buildExplainPrompt({
      selectedText,
      filePath,
      languageId,
      fullContent,
      selection,
      repoContext,
    });

    statusBarItem.text = '$(sync~spin) CodeLens: Thinking…';
    panel.startStreaming('explain', '', filePath, selection.start.line + 1, selection.end.line + 1);

    let fullResponse = '';
    await llmService!.streamCompletion(prompt, (chunk) => {
      fullResponse += chunk;
      panel.appendChunk(chunk);
    });

    cache.setLLMResponse(cacheKey, fullResponse);
    panel.finishStreaming();
  } catch (err) {
    panel.showError(String(err));
  } finally {
    statusBarItem.text = '$(telescope) CodeLens';
  }
}

async function handleTranslate(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage('CodeLens: Please highlight some code first.');
    return;
  }
  if (!(await ensureLLMService(context))) {
    const choice = await vscode.window.showErrorMessage(
      'CodeLens Interpreter: No API key set.',
      'Set API Key'
    );
    if (choice === 'Set API Key') {
      await setApiKey(context);
    }
    return;
  }

  const config = vscode.workspace.getConfiguration('codelensInterpreter');
  const languages: string[] = config.get('translationLanguages') ?? [
    'Python', 'Java', 'Go', 'Rust', 'TypeScript', 'C#',
  ];

  const targetLanguage = await vscode.window.showQuickPick(languages, {
    placeHolder: 'Translate to…',
  });
  if (!targetLanguage) {
    return;
  }

  await runTranslate(context, targetLanguage);
}

export async function runTranslate(context: vscode.ExtensionContext, targetLanguage: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  const filePath = editor.document.uri.fsPath;
  const languageId = editor.document.languageId;
  const fullContent = editor.document.getText();

  statusBarItem.text = `$(sync~spin) CodeLens: Translating to ${targetLanguage}…`;

  const panel = ResultsPanel.getOrCreate(context);
  panel.showLoading(`Translate → ${targetLanguage}`, filePath, selection.start.line + 1, selection.end.line + 1);

  try {
    const config = vscode.workspace.getConfiguration('codelensInterpreter');
    const maxContextTokens: number = config.get('maxContextTokens') ?? 6000;

    const repoContext = await contextGatherer.gather({
      selectedText,
      filePath,
      languageId,
      fullContent,
      selection,
      document: editor.document,
      maxTokens: maxContextTokens,
    });

    const cacheKey = cache.makeKey(selectedText, repoContext.contextHash, 'translate', targetLanguage);
    const cached = cache.getLLMResponse(cacheKey);
    if (cached) {
      panel.showResult(cached, 'translate', targetLanguage, filePath, selection.start.line + 1, selection.end.line + 1);
      statusBarItem.text = '$(telescope) CodeLens';
      return;
    }

    const prompt = promptBuilder.buildTranslatePrompt({
      selectedText,
      filePath,
      languageId,
      fullContent,
      selection,
      repoContext,
      targetLanguage,
    });

    statusBarItem.text = `$(sync~spin) CodeLens: Translating…`;
    panel.startStreaming('translate', targetLanguage, filePath, selection.start.line + 1, selection.end.line + 1);

    let fullResponse = '';
    await llmService!.streamCompletion(prompt, (chunk) => {
      fullResponse += chunk;
      panel.appendChunk(chunk);
    });

    cache.setLLMResponse(cacheKey, fullResponse);
    panel.finishStreaming();
  } catch (err) {
    panel.showError(String(err));
  } finally {
    statusBarItem.text = '$(telescope) CodeLens';
  }
}

export function deactivate() {
  llmService?.cancelInFlight();
}
