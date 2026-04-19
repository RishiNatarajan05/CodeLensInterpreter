import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export type ActionType = 'explain' | 'translate';

interface WebviewMessage {
  type: 'startStreaming' | 'chunk' | 'finishStreaming' | 'showResult' | 'showLoading' | 'showError';
  payload?: unknown;
}

/**
 * Singleton webview panel that displays explanation/translation results.
 * Opens beside the active editor and reuses the same panel across requests.
 */
export class ResultsPanel {
  private static instance: ResultsPanel | undefined;
  private panel: vscode.WebviewPanel;
  private context: vscode.ExtensionContext;
  private lastAction: ActionType = 'explain';
  private lastTargetLanguage = '';
  private lastFilePath = '';
  private lastStartLine = 0;
  private lastEndLine = 0;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;

    panel.onDidDispose(() => {
      ResultsPanel.instance = undefined;
    });

    // Handle messages from the webview (e.g., toolbar button clicks)
    panel.webview.onDidReceiveMessage((msg: { command: string; language?: string }) => {
      if (msg.command === 'rerun') {
        vscode.commands.executeCommand('codelens-interpreter.explain');
      } else if (msg.command === 'translate' && msg.language) {
        // Re-translate with a different language
        import('../extension').then((ext) => {
          ext.runTranslate(context, msg.language!);
        });
      }
    });
  }

  static getOrCreate(context: vscode.ExtensionContext): ResultsPanel {
    if (ResultsPanel.instance) {
      ResultsPanel.instance.panel.reveal(vscode.ViewColumn.Beside, true);
      return ResultsPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      'codelensInterpreter',
      'CodeLens Interpreter',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'src', 'ui', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
        ],
      }
    );

    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon-dark.svg'),
    };

    const instance = new ResultsPanel(panel, context);
    ResultsPanel.instance = instance;
    panel.webview.html = instance.getBaseHtml();
    return instance;
  }

  showLoading(actionLabel: string, filePath: string, startLine: number, endLine: number) {
    this.lastFilePath = filePath;
    this.lastStartLine = startLine;
    this.lastEndLine = endLine;
    this.post({
      type: 'showLoading',
      payload: { actionLabel, filePath: path.basename(filePath), startLine, endLine },
    });
  }

  startStreaming(action: ActionType, targetLanguage: string, filePath: string, startLine: number, endLine: number) {
    this.lastAction = action;
    this.lastTargetLanguage = targetLanguage;
    this.lastFilePath = filePath;
    this.lastStartLine = startLine;
    this.lastEndLine = endLine;
    this.post({
      type: 'startStreaming',
      payload: {
        action,
        targetLanguage,
        filePath: path.basename(filePath),
        startLine,
        endLine,
      },
    });
  }

  appendChunk(text: string) {
    this.post({ type: 'chunk', payload: { text } });
  }

  finishStreaming() {
    this.post({ type: 'finishStreaming' });
  }

  showResult(
    content: string,
    action: ActionType,
    targetLanguage: string,
    filePath: string,
    startLine: number,
    endLine: number
  ) {
    this.post({
      type: 'showResult',
      payload: {
        content,
        action,
        targetLanguage,
        filePath: path.basename(filePath),
        startLine,
        endLine,
      },
    });
  }

  showError(message: string) {
    this.post({ type: 'showError', payload: { message } });
  }

  private post(msg: WebviewMessage) {
    try {
      this.panel.webview.postMessage(msg);
    } catch {
      // Panel may have been disposed
    }
  }

  private getBaseHtml(): string {
    const config = vscode.workspace.getConfiguration('codelensInterpreter');
    const translationLanguages: string[] = config.get('translationLanguages') ?? [
      'Python', 'Java', 'Go', 'Rust', 'TypeScript', 'C#',
    ];

    // Try to load CSS/JS from disk; fall back to inline defaults
    const webviewDir = path.join(this.context.extensionPath, 'src', 'ui', 'webview');
    let styles = DEFAULT_STYLES;
    let script = DEFAULT_SCRIPT;

    try {
      const cssPath = path.join(webviewDir, 'styles.css');
      if (fs.existsSync(cssPath)) {
        styles = fs.readFileSync(cssPath, 'utf-8');
      }
    } catch { /* use default */ }

    try {
      const jsPath = path.join(webviewDir, 'main.js');
      if (fs.existsSync(jsPath)) {
        script = fs.readFileSync(jsPath, 'utf-8');
      }
    } catch { /* use default */ }

    const langButtons = translationLanguages
      .map(
        (lang) =>
          `<button class="toolbar-btn lang-btn" data-lang="${lang}" title="Translate to ${lang}">${lang}</button>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>CodeLens Interpreter</title>
<style>${styles}</style>
</head>
<body>
  <div id="toolbar">
    <button class="toolbar-btn" id="btn-explain" title="Re-explain selection">Explain</button>
    <span class="toolbar-sep">|</span>
    ${langButtons}
  </div>
  <div id="header" class="hidden">
    <span id="header-action"></span>
    <span id="header-location"></span>
  </div>
  <div id="content">
    <div id="welcome">
      <p>Highlight any code in the editor, then:</p>
      <ul>
        <li>Right-click → <strong>CodeLens: Explain This Code</strong></li>
        <li>Right-click → <strong>CodeLens: Translate This Code</strong></li>
        <li>Or use <kbd>Cmd+Shift+E</kbd> / <kbd>Cmd+Shift+T</kbd></li>
      </ul>
    </div>
    <div id="loading" class="hidden">
      <div class="spinner"></div>
      <span id="loading-label">Thinking…</span>
    </div>
    <div id="result" class="hidden">
      <div id="result-body"></div>
      <div id="copy-row" class="hidden">
        <button id="copy-btn">Copy code</button>
      </div>
    </div>
    <div id="error-pane" class="hidden">
      <div class="error-icon">⚠</div>
      <div id="error-message"></div>
      <button id="retry-btn">Retry</button>
    </div>
  </div>
  <script>${script}</script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Inline fallback styles (VS Code theme-aware)
// ---------------------------------------------------------------------------

const DEFAULT_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: var(--vscode-editor-font-size, 13px);
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
  padding: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

#toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  flex-wrap: wrap;
}

.toolbar-btn {
  padding: 3px 10px;
  border-radius: 3px;
  border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ccc);
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
.toolbar-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground, #45494e);
}
.toolbar-btn.active {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
}

.toolbar-sep {
  color: var(--vscode-panel-border, #555);
  user-select: none;
}

#header {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  gap: 12px;
}
#header-action { font-weight: 600; }

#content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

#welcome { color: var(--vscode-descriptionForeground); line-height: 1.8; }
#welcome ul { margin-left: 20px; margin-top: 8px; }
#welcome kbd {
  background: var(--vscode-keybindingLabel-background, #333);
  border: 1px solid var(--vscode-keybindingLabel-border, #555);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 11px;
}

.hidden { display: none !important; }

#loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
  color: var(--vscode-descriptionForeground);
}

.spinner {
  width: 18px; height: 18px;
  border: 2px solid var(--vscode-panel-border, #555);
  border-top-color: var(--vscode-progressBar-background, #0e639c);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

#result-body {
  line-height: 1.7;
}

/* Markdown output */
#result-body h1, #result-body h2, #result-body h3 {
  margin: 16px 0 8px;
  color: var(--vscode-editor-foreground);
}
#result-body p { margin: 8px 0; }
#result-body ul, #result-body ol { margin: 8px 0 8px 20px; }
#result-body li { margin: 4px 0; }
#result-body code {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.95em;
  background: var(--vscode-textCodeBlock-background, #1e1e1e);
  padding: 1px 4px;
  border-radius: 3px;
}
#result-body pre {
  background: var(--vscode-textCodeBlock-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 5px;
  overflow-x: auto;
  margin: 12px 0;
  padding: 0;
}
/* IDE-style code block wrapper — replaces <pre> for fenced blocks */
#result-body .code-block {
  background: var(--vscode-textCodeBlock-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 5px;
  margin: 12px 0;
  overflow: hidden;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: var(--vscode-editor-font-size, 13px);
}
/* Language label bar */
#result-body .code-block .code-lang {
  display: block;
  text-align: right;
  font-size: 10px;
  color: var(--vscode-descriptionForeground, #858585);
  padding: 3px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  user-select: none;
}
/* Body: gutter + code side by side */
#result-body .code-block .code-body {
  display: flex;
  overflow-x: auto;
}
/* Gutter */
#result-body .code-block .code-gutter {
  flex-shrink: 0;
  text-align: right;
  padding: 10px 10px 10px 12px;
  color: var(--vscode-editorLineNumber-foreground, #858585);
  border-right: 1px solid var(--vscode-panel-border, #333);
  user-select: none;
  line-height: 1.6;
  font-size: 0.85em;
  white-space: pre; /* keep line breaks */
}
/* Code area */
#result-body .code-block pre {
  margin: 0;
  padding: 10px 16px;
  background: none;
  border: none;
  border-radius: 0;
  overflow-x: visible;
  line-height: 1.6;
  flex: 1;
  white-space: pre;
}
#result-body .code-block pre code {
  background: none;
  padding: 0;
  font-size: inherit;
  white-space: pre;
}
/* Keep inline code styles for non-block code */
#result-body pre {
  background: var(--vscode-textCodeBlock-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: 5px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 12px 0;
}
#result-body pre code {
  background: none;
  padding: 0;
  font-size: inherit;
}
#result-body blockquote {
  border-left: 3px solid var(--vscode-panel-border, #555);
  padding-left: 12px;
  color: var(--vscode-descriptionForeground);
  margin: 8px 0;
}
#result-body strong { color: var(--vscode-editor-foreground); }
#result-body em { font-style: italic; }
#result-body a { color: var(--vscode-textLink-foreground, #4fc1ff); }

#copy-row {
  margin-top: 12px;
}
#copy-btn {
  padding: 5px 14px;
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
#copy-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground, #45494e);
}

#error-pane {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  color: var(--vscode-editorError-foreground, #f48771);
}
.error-icon { font-size: 24px; }
#error-message { font-family: inherit; white-space: pre-wrap; }
#retry-btn {
  padding: 5px 14px;
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
`;

// ---------------------------------------------------------------------------
// Inline fallback script
// ---------------------------------------------------------------------------

const DEFAULT_SCRIPT = `
(function() {
  const vscode = acquireVsCodeApi();
  let rawMarkdown = '';
  let isStreaming = false;
  let lastTranslateCode = '';

  const welcome = document.getElementById('welcome');
  const loading = document.getElementById('loading');
  const loadingLabel = document.getElementById('loading-label');
  const result = document.getElementById('result');
  const resultBody = document.getElementById('result-body');
  const errorPane = document.getElementById('error-pane');
  const errorMessage = document.getElementById('error-message');
  const header = document.getElementById('header');
  const headerAction = document.getElementById('header-action');
  const headerLocation = document.getElementById('header-location');
  const copyRow = document.getElementById('copy-row');
  const copyBtn = document.getElementById('copy-btn');
  const retryBtn = document.getElementById('retry-btn');

  // Toolbar buttons
  document.getElementById('btn-explain').addEventListener('click', () => {
    vscode.postMessage({ command: 'rerun' });
  });
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      vscode.postMessage({ command: 'translate', language: btn.dataset.lang });
    });
  });

  copyBtn.addEventListener('click', () => {
    // Extract raw code from the code block (skip gutter)
    const codeEl = resultBody.querySelector('.code-block pre code');
    let text;
    if (codeEl) {
      text = codeEl.textContent || '';
    } else {
      const pre = resultBody.querySelector('pre');
      text = pre ? pre.textContent : resultBody.textContent;
    }
    navigator.clipboard.writeText(text || '').then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy code'; }, 1500);
    });
  });

  retryBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'rerun' });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'showLoading':
        showState('loading');
        loadingLabel.textContent = msg.payload.actionLabel + '…';
        setHeader(msg.payload.actionLabel, msg.payload.filePath, msg.payload.startLine, msg.payload.endLine);
        break;

      case 'startStreaming':
        rawMarkdown = '';
        isStreaming = true;
        showState('result');
        resultBody.innerHTML = '<span class="streaming-cursor">▊</span>';
        const streamLabel = msg.payload.action === 'translate'
          ? 'Translate → ' + msg.payload.targetLanguage
          : 'Explain';
        setHeader(streamLabel, msg.payload.filePath, msg.payload.startLine, msg.payload.endLine);
        copyRow.classList.toggle('hidden', msg.payload.action !== 'translate');
        break;

      case 'chunk':
        rawMarkdown += msg.payload.text;
        renderMarkdown(rawMarkdown, true);
        break;

      case 'finishStreaming':
        isStreaming = false;
        renderMarkdown(rawMarkdown, false);
        break;

      case 'showResult':
        rawMarkdown = msg.payload.content;
        isStreaming = false;
        showState('result');
        renderMarkdown(rawMarkdown, false);
        const label = msg.payload.action === 'translate'
          ? 'Translate → ' + msg.payload.targetLanguage
          : 'Explain';
        setHeader(label, msg.payload.filePath, msg.payload.startLine, msg.payload.endLine);
        copyRow.classList.toggle('hidden', msg.payload.action !== 'translate');
        break;

      case 'showError':
        showState('error');
        errorMessage.textContent = msg.payload.message;
        break;
    }
  });

  function showState(state) {
    welcome.classList.add('hidden');
    loading.classList.add('hidden');
    result.classList.add('hidden');
    errorPane.classList.add('hidden');
    header.classList.remove('hidden');

    if (state === 'loading') loading.classList.remove('hidden');
    else if (state === 'result') result.classList.remove('hidden');
    else if (state === 'error') errorPane.classList.remove('hidden');
  }

  function setHeader(action, filePath, startLine, endLine) {
    headerAction.textContent = action;
    headerLocation.textContent = filePath + ':' + startLine + (endLine !== startLine ? '–' + endLine : '');
  }

  function renderMarkdown(md, streaming) {
    // Minimal markdown renderer (no external deps required in webview)
    let html = escapeAndRender(md);
    if (streaming) {
      html += '<span class="streaming-cursor">▊</span>';
    }
    resultBody.innerHTML = html;
    // Scroll to bottom while streaming
    if (streaming) {
      resultBody.scrollTop = resultBody.scrollHeight;
    }
  }

  // Minimal Markdown → HTML (handles code blocks, inline code, headers, bold, italic, lists)
  function escapeAndRender(md) {
    let html = md;

    // Fenced code blocks — IDE-style gutter + code side by side
    html = html.replace(/\`\`\`([\\w]*)?\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
      const trimmed = code.replace(/\\n$/, '');
      const lines = trimmed.split('\\n');
      const langLabel = lang
        ? '<span class="code-lang">' + htmlEscape(lang) + '</span>'
        : '';
      // Gutter: one line-number per line joined by newlines (white-space:pre keeps them stacked)
      const gutterNums = lines.map((_, i) => String(i + 1)).join('\\n');
      const codeHtml = lines.map(l => htmlEscape(l)).join('\\n');
      return (
        '<div class="code-block">' +
          langLabel +
          '<div class="code-body">' +
            '<div class="code-gutter">' + gutterNums + '</div>' +
            '<pre><code>' + codeHtml + '</code></pre>' +
          '</div>' +
        '</div>'
      );
    });

    // Inline code
    html = html.replace(/\`([^\`]+)\`/g, (_, code) => '<code>' + htmlEscape(code) + '</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\\/li>\\n?)+/g, m => '<ul>' + m + '</ul>');

    // Ordered lists
    html = html.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs: double newlines
    html = html.replace(/\\n\\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs around block elements
    html = html.replace(/<p>(<(?:h[1-6]|pre|ul|ol|blockquote)[^>]*>)/g, '$1');
    html = html.replace(/(<\\/(?:h[1-6]|pre|ul|ol|blockquote)>)<\\/p>/g, '$1');

    return html;
  }

  function htmlEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
`;
