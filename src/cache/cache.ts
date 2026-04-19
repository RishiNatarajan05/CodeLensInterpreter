import * as crypto from 'crypto';
import type { RepoContext } from '../context/gatherer';

interface LRUNode<V> {
  key: string;
  value: V;
  prev: LRUNode<V> | null;
  next: LRUNode<V> | null;
}

/** Simple doubly-linked-list LRU cache */
class LRUCache<V> {
  private map = new Map<string, LRUNode<V>>();
  private head: LRUNode<V> | null = null; // most recent
  private tail: LRUNode<V> | null = null; // least recent

  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToFront(node);
    return node.value;
  }

  set(key: string, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToFront(existing);
      return;
    }
    const node: LRUNode<V> = { key, value, prev: null, next: this.head };
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
    this.map.set(key, node);

    if (this.map.size > this.maxSize) {
      this.evict();
    }
  }

  delete(key: string): void {
    const node = this.map.get(key);
    if (node) {
      this.removeNode(node);
      this.map.delete(key);
    }
  }

  private moveToFront(node: LRUNode<V>): void {
    if (node === this.head) return;
    this.removeNode(node);
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: LRUNode<V>): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private evict(): void {
    if (!this.tail) return;
    this.map.delete(this.tail.key);
    this.removeNode(this.tail);
  }
}

/**
 * Two-tier cache:
 * 1. LLM response cache (keyed by selection + context hash + action)
 * 2. Context gathering cache (keyed by filePath + mtime)
 */
export class Cache {
  private llmCache = new LRUCache<string>(50);
  private contextCache = new LRUCache<RepoContext>(30);
  /** Map from filePath → set of context cache keys that include that file */
  private fileToContextKeys = new Map<string, Set<string>>();

  makeKey(
    selectedText: string,
    contextHash: string,
    action: string,
    targetLanguage: string
  ): string {
    const raw = `${selectedText}|${contextHash}|${action}|${targetLanguage}`;
    return crypto.createHash('sha1').update(raw).digest('hex');
  }

  getLLMResponse(key: string): string | undefined {
    return this.llmCache.get(key);
  }

  setLLMResponse(key: string, response: string): void {
    this.llmCache.set(key, response);
  }

  getContext(key: string): RepoContext | undefined {
    return this.contextCache.get(key);
  }

  setContext(key: string, ctx: RepoContext): void {
    this.contextCache.set(key, ctx);
    // Register the key under the filePath component
    const filePath = key.split(':').slice(1, -1).join(':');
    if (!this.fileToContextKeys.has(filePath)) {
      this.fileToContextKeys.set(filePath, new Set());
    }
    this.fileToContextKeys.get(filePath)!.add(key);
  }

  /** Invalidate context cache entries that include the given file */
  invalidateFile(filePath: string): void {
    const keys = this.fileToContextKeys.get(filePath);
    if (keys) {
      for (const key of keys) {
        this.contextCache.delete(key);
      }
      this.fileToContextKeys.delete(filePath);
    }
  }
}
