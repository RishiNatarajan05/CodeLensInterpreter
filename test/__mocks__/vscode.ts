/**
 * Minimal VS Code API mock for unit tests running outside VS Code.
 */

export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showInputBox: () => Promise.resolve(undefined),
  showQuickPick: () => Promise.resolve(undefined),
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    command: undefined,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  activeTextEditor: undefined,
};

export const workspace = {
  getConfiguration: () => ({
    get: (key: string, defaultValue?: unknown) => defaultValue,
  }),
  getWorkspaceFolder: () => undefined,
  onDidChangeTextDocument: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve([]),
};

export enum ViewColumn {
  Beside = -2,
  Active = -1,
  One = 1,
  Two = 2,
  Three = 3,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class Uri {
  static file(path: string) { return { fsPath: path, scheme: 'file' }; }
  static joinPath(base: { fsPath: string }, ...parts: string[]) {
    const p = require('path');
    return { fsPath: p.join(base.fsPath, ...parts) };
  }
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

export class Selection extends Range {
  constructor(start: Position, end: Position) {
    super(start, end);
  }
  get isEmpty() { return false; }
}

export class Location {
  constructor(public uri: { fsPath: string }, public range: Range) {}
}

export default {
  window,
  workspace,
  commands,
  ViewColumn,
  StatusBarAlignment,
  Uri,
  Position,
  Range,
  Selection,
  Location,
};
