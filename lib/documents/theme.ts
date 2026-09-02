import { rgb } from "pdf-lib";

export const DOCUMENT_LAYOUT_VERSION = 2;
export const A4_SIZE: [number, number] = [595.28, 841.89];

export const documentTheme = {
  marginX: 52,
  topContentY: 675,
  bottomContentY: 92,
  text: rgb(0.12, 0.15, 0.17),
  muted: rgb(0.38, 0.42, 0.44),
  line: rgb(0.77, 0.8, 0.8),
  teal: rgb(0.18, 0.5, 0.49),
  softTeal: rgb(0.93, 0.97, 0.96),
};

