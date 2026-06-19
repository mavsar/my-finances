import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Normalise text for accent-insensitive matching.
 *  Lowercases, strips combining diacritics (č=c, š=s, ž=z, …),
 *  and maps Greek lookalike letters to their Latin equivalents
 *  (e.g. Greek Α that can appear via OCR/copy-paste from bank PDFs). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u03b1/g, "a").replace(/\u03b2/g, "b").replace(/\u03b5/g, "e")
    .replace(/\u03b7/g, "h").replace(/\u03b9/g, "i").replace(/\u03ba/g, "k")
    .replace(/\u03bc/g, "m").replace(/\u03bd/g, "n").replace(/\u03bf/g, "o")
    .replace(/\u03c1/g, "r").replace(/\u03c4/g, "t").replace(/\u03c5/g, "y")
    .replace(/\u03c7/g, "x");
}
