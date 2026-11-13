/** Entrée de capacity planning incomplète ou incohérente (distincte d'une erreur de forme, gérée par Zod). */
export class AdvisorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvisorInputError";
  }
}