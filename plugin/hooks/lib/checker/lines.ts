// Memory of lines already checked and found clean, so a repeated line is not
// checked again. Whole lines are kept, not hashes, so a collision can't hide a
// secret. Memory only, never written to disk; capped, and emptied when full.

export class LineMemory {
  private readonly seen = new Set<string>()
  private chars = 0
  private readonly maxLines: number
  private readonly maxChars: number

  constructor(maxLines = 20_000, maxChars = 2_000_000) {
    this.maxLines = maxLines
    this.maxChars = maxChars
  }

  has(key: string): boolean {
    return this.seen.has(key)
  }

  add(key: string): void {
    if (this.seen.has(key)) return
    if (this.seen.size >= this.maxLines || this.chars + key.length > this.maxChars) this.clear()
    this.seen.add(key)
    this.chars += key.length
  }

  clear(): void {
    this.seen.clear()
    this.chars = 0
  }

  get size(): number {
    return this.seen.size
  }
}
