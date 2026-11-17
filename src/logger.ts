import type { Logger } from "./services/ports.js";

const stamp = (): string => new Date().toISOString();

export const consoleLogger: Logger = {
  info: (message) => console.log(`[${stamp()}] ${message}`),
  warn: (message, error) => {
    console.warn(`[${stamp()}] WARN ${message}`, error === undefined ? "" : error);
  },
  error: (message, error) => {
    console.error(`[${stamp()}] ERROR ${message}`, error === undefined ? "" : error);
  },
};
