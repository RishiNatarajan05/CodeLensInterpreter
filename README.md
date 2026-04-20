# CodeLens Interpreter

A VS Code extension that lets you highlight any code, right-click, and instantly get:

- **A plain-English explanation** of what the code does, contextualized within your repo
- **A translation** into another language (Python, Java, Go, Rust, TypeScript, C#) written the way a native developer would write it

Powered by Claude (Anthropic API). Understands your codebase — not just the snippet.

---

## How it works

Before sending anything to Claude, the extension traces your code's dependency graph:

1. Extracts all function calls, type references, and imports from your selection
2. Resolves those imports to actual files in your repo
3. Looks up where each called function/type is defined using VS Code's language server
4. Reads the relevant definitions and project metadata
5. Bundles everything into a structured prompt and streams the response into a side panel

---

## Requirements

- VS Code 1.85 or later
- Node.js 18 or later
- An [Anthropic API key](https://console.anthropic.com) with credits

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/RishiNatarajan05/CodeLensInterpreter.git
cd CodeLensInterpreter
```

### 2. Install dependencies

```bash
npm install
```

### 3. Build the extension

```bash
npm run build
```

### 4. Package it

```bash
npm install -g @vscode/vsce
vsce package --allow-missing-repository
```

This creates a `codelens-interpreter-0.1.0.vsix` file in the project root.

### 5. Install in VS Code

Open VS Code, then:

```
Cmd+Shift+P  →  Extensions: Install from VSIX  →  select the .vsix file
```

Reload VS Code when prompted.

### 6. Add your Anthropic API key

On first use you'll be prompted automatically. You can also set it manually:

```
Cmd+Shift+P  →  CodeLens: Set Anthropic API Key
```

Enter your `sk-ant-...` key. It's stored securely in VS Code's secret storage — never in settings files or source code.

---

## Usage

1. Open any code file in VS Code
2. Highlight a block of code
3. Right-click and choose:
   - **CodeLens: Explain This Code** — get a plain-English breakdown
   - **CodeLens: Translate This Code** — pick a target language and get idiomatic translated code

### Keyboard shortcuts

| Action | Mac | Windows/Linux |
|---|---|---|
| Explain | `Cmd+Shift+E` | `Ctrl+Shift+E` |
| Translate | `Cmd+Shift+T` | `Ctrl+Shift+T` |

### Quick-switch toolbar

The results panel has a toolbar at the top. After running any command, click **Explain** or any language button to re-run on the same selection without going back to the editor.

---

## Configuration

Open VS Code Settings (`Cmd+,`) and search for `codelensInterpreter`:

| Setting | Default | Description |
|---|---|---|
| `codelensInterpreter.model` | `claude-sonnet-4-6` | Anthropic model to use |
| `codelensInterpreter.maxContextTokens` | `6000` | Token budget for repo context |
| `codelensInterpreter.maxResponseTokens` | `2000` | Max length of Claude's response |
| `codelensInterpreter.translationLanguages` | `["Python", "Java", "Go", "Rust", "TypeScript", "C#"]` | Languages shown in the toolbar |

---

## Development

```bash
# Run tests
npm test

# Build in watch mode (rebuilds on save)
npm run dev

# Type check
npm run lint
```

To test the extension locally without packaging, open the repo in VS Code and press `Fn+F5` (or **Run → Start Debugging**) to launch an Extension Development Host.

---

## Project structure

```
src/
├── extension.ts          # Command registration and activation
├── llm/
│   └── service.ts        # Anthropic SDK streaming client
├── context/
│   ├── gatherer.ts       # Orchestrates context gathering
│   ├── symbols.ts        # Symbol/import extraction
│   ├── imports.ts        # Import path resolution
│   ├── definitions.ts    # Definition lookup via VS Code language server
│   └── metadata.ts       # Project metadata reader
├── prompt/
│   └── builder.ts        # Prompt construction
├── cache/
│   └── cache.ts          # Two-tier LRU cache
└── ui/
    └── ResultsPanel.ts   # Webview panel (streaming, line numbers, toolbar)
```
