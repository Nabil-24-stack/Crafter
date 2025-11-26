/**
 * Production-safe logger utility
 * Only logs in development mode to prevent exposing sensitive data
 */

const IS_DEV = process.env.NODE_ENV === 'development';

export const logger = {
  /**
   * Log general information (only in development)
   */
  log: (...args: any[]) => {
  },

  /**
   * Log errors (always logged for debugging)
   * Use sparingly and avoid logging sensitive data
   */
  error: (...args: any[]) => {
    console.error(...args);
  },

  /**
   * Log warnings (only in development)
   */
  warn: (...args: any[]) => {
    if (IS_DEV) console.warn(...args);
  },

  /**
   * Log debug information (only in development)
   */
  debug: (...args: any[]) => {
  }
};
