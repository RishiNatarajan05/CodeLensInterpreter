import * as path from 'path';
import * as fs from 'fs';

export interface ProjectMetadata {
  projectName: string;
  description: string;
  language: string;
  framework: string;
  keyDependencies: string[];
  rawSummary: string;
}

/**
 * Read project metadata files from the workspace root.
 */
export function readProjectMetadata(workspaceRoot: string): ProjectMetadata {
  const meta: ProjectMetadata = {
    projectName: path.basename(workspaceRoot),
    description: '',
    language: 'unknown',
    framework: '',
    keyDependencies: [],
    rawSummary: '',
  };

  const summaryParts: string[] = [];

  // package.json (Node/JS/TS)
  const pkgPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      meta.projectName = pkg.name ?? meta.projectName;
      meta.description = pkg.description ?? '';
      meta.language = 'JavaScript/TypeScript';

      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      const depNames = Object.keys(deps);
      meta.keyDependencies = depNames.slice(0, 20);

      if (deps['react'] || deps['next']) meta.framework = 'React';
      else if (deps['vue']) meta.framework = 'Vue';
      else if (deps['@angular/core']) meta.framework = 'Angular';
      else if (deps['express']) meta.framework = 'Express';
      else if (deps['fastify']) meta.framework = 'Fastify';

      summaryParts.push(
        `package.json: name="${meta.projectName}", description="${meta.description}", ` +
          `deps=[${depNames.slice(0, 10).join(', ')}]`
      );
    } catch {
      // ignore parse errors
    }
  }

  // pyproject.toml / setup.py (Python)
  const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    meta.language = 'Python';
    const content = fs.readFileSync(pyprojectPath, 'utf-8');
    const nameMatch = /name\s*=\s*["']([^"']+)["']/.exec(content);
    const descMatch = /description\s*=\s*["']([^"']+)["']/.exec(content);
    if (nameMatch) meta.projectName = nameMatch[1];
    if (descMatch) meta.description = descMatch[1];
    summaryParts.push(`pyproject.toml: name="${meta.projectName}", description="${meta.description}"`);
  }

  // Cargo.toml (Rust)
  const cargoPath = path.join(workspaceRoot, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    meta.language = 'Rust';
    const content = fs.readFileSync(cargoPath, 'utf-8');
    const nameMatch = /name\s*=\s*["']([^"']+)["']/.exec(content);
    const descMatch = /description\s*=\s*["']([^"']+)["']/.exec(content);
    if (nameMatch) meta.projectName = nameMatch[1];
    if (descMatch) meta.description = descMatch[1];
    summaryParts.push(`Cargo.toml: name="${meta.projectName}", description="${meta.description}"`);
  }

  // go.mod (Go)
  const goModPath = path.join(workspaceRoot, 'go.mod');
  if (fs.existsSync(goModPath)) {
    meta.language = 'Go';
    const content = fs.readFileSync(goModPath, 'utf-8');
    const moduleMatch = /^module\s+([\w./\-]+)/m.exec(content);
    if (moduleMatch) meta.projectName = moduleMatch[1];
    summaryParts.push(`go.mod: module="${meta.projectName}"`);
  }

  // pom.xml (Java/Maven)
  const pomPath = path.join(workspaceRoot, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    meta.language = 'Java';
    const content = fs.readFileSync(pomPath, 'utf-8');
    const artifactMatch = /<artifactId>([^<]+)<\/artifactId>/.exec(content);
    const descMatch = /<description>([^<]+)<\/description>/.exec(content);
    if (artifactMatch) meta.projectName = artifactMatch[1];
    if (descMatch) meta.description = descMatch[1];
    summaryParts.push(`pom.xml: artifactId="${meta.projectName}"`);
  }

  // README.md (first 200 lines)
  const readmePath = path.join(workspaceRoot, 'README.md');
  if (fs.existsSync(readmePath)) {
    try {
      const content = fs.readFileSync(readmePath, 'utf-8');
      const first200 = content.split('\n').slice(0, 200).join('\n');
      summaryParts.push(`README.md (first 200 lines):\n${first200}`);
    } catch {
      // ignore
    }
  }

  meta.rawSummary = summaryParts.join('\n\n');
  return meta;
}
