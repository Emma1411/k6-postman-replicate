/** Avertissements d'import : dédupliqués, et plafonnés pour ne pas noyer le résultat. */
export class Warnings {
  private readonly list: string[] = [];
  private readonly seen = new Set<string>();
  private readonly cap: number;
  private overflow = 0;

  constructor(cap = 200) {
    this.cap = cap;
  }

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    if (this.list.length < this.cap) this.list.push(message);
    else this.overflow++;
  }

  toArray(): string[] {
    return this.overflow > 0 ? [...this.list, `… et ${this.overflow} autre(s) avertissement(s).`] : [...this.list];
  }
}