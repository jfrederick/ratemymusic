/** Thrown when a page's markdown is structurally unrecognizable as the expected RYM page type. */
export class ParseError extends Error {
  public readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "ParseError";
    this.hint = hint;
  }
}
