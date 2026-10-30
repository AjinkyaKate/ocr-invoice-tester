export type Box = [number, number, number, number]; // x, y, w, h as fractions of the image

/** One piece of text found by OCR, with where it sits on the image and how sure OCR was (0 to 1). */
export type OcrLine = { text: string; box: Box; score: number };

/** An extracted value plus the OCR pieces it was read from (indexes into Invoice.ocr.lines). */
export type Field<T> = { value: T | null; lines: number[] };

export type Line = {
  desc: string;
  qty: number | null;
  rate: number | null; // unit price as printed
  amount: number | null; // line total as printed
  lines: number[];
};

export type Stage = "reading" | "understanding" | "review" | "done" | "rejected" | "failed";

export type Invoice = {
  id: string;
  name: string; // file name
  receivedAt: string;
  status: Stage;
  image: string;
  ocr?: { lines: OcrLine[]; ms: number; engine: string };
  understandMs?: number;
  understandModel?: string; // which model read the fields
  currency?: string | null;
  vendor: Field<string>;
  number: Field<string>;
  date: Field<string>;
  subtotal: Field<number>;
  tax: Field<number>;
  total: Field<number>;
  lines: Line[];
  /** Fields as the model streams them in, before they are final. */
  partial?: { vendor?: Field<string>; number?: Field<string>; date?: Field<string>; total?: Field<number>; subtotal?: Field<number>; tax?: Field<number>; currency?: string | null; items?: Line[] };
  decisions: Record<string, string>; // flag id -> chosen option id
  edits: Record<string, string>; // "total", "vendor", "line:3:amount"... -> value typed by the user
  resolvedAt?: string;
  error?: string;
};
