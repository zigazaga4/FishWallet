// Panel Error Service - Captures and logs errors from the LivePreview iframe
// Logs to project folder for easy access and provides errors to the AI for fixing

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

// Panel error interface
export interface PanelError {
  timestamp: Date;
  ideaId: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
}

// Store errors per idea (cleared after AI processes them)
const errorStore: Map<string, PanelError[]> = new Map();

// Log directory path - project folder for easy access
const LOG_DIR = '/Users/mobinedvin/FishWallet/FishWallet/logs';

// Ensure log directory exists
function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// Delete panel errors log on startup for fresh logs each session
function clearLogFileOnStartup(): void {
  try {
    ensureLogDir();
    const logPath = getLogFilePath();
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
      logger.info('[PanelError] Cleared panel-errors.log on startup');
    }
  } catch (err) {
    logger.error('[PanelError] Failed to clear log file on startup:', err);
  }
}

// Clear the log file when this module loads (app startup)
clearLogFileOnStartup();

// Get the panel error log file path
function getLogFilePath(): string {
  return path.join(LOG_DIR, 'panel-errors.log');
}

// Format error for log file
function formatErrorForLog(error: PanelError): string {
  const timestamp = error.timestamp.toISOString();
  const location = error.line ? ` (line ${error.line}${error.column ? `:${error.column}` : ''})` : '';
  const source = error.source ? ` in ${error.source}` : '';
  const stack = error.stack ? `\n  Stack: ${error.stack}` : '';
  return `[${timestamp}] [Idea: ${error.ideaId}] ${error.message}${source}${location}${stack}\n`;
}

// Report a panel error - stores in memory and writes to log file
export function reportPanelError(
  ideaId: string,
  message: string,
  source?: string,
  line?: number,
  column?: number,
  stack?: string
): void {
  const error: PanelError = {
    timestamp: new Date(),
    ideaId,
    message,
    source,
    line,
    column,
    stack
  };

  // Store in memory
  const existing = errorStore.get(ideaId) || [];
  existing.push(error);
  errorStore.set(ideaId, existing);

  // Log to main logger
  logger.warn('[PanelError]', formatErrorForLog(error).trim());

  // Write to log file
  try {
    ensureLogDir();
    const logPath = getLogFilePath();
    fs.appendFileSync(logPath, formatErrorForLog(error));
  } catch (err) {
    logger.error('[PanelError] Failed to write to log file:', err);
  }
}

// Get all errors for an idea (for AI to process)
export function getPanelErrors(ideaId: string): PanelError[] {
  return errorStore.get(ideaId) || [];
}

// Clear errors for an idea (after AI has processed them)
export function clearPanelErrors(ideaId: string): void {
  errorStore.delete(ideaId);
  logger.debug('[PanelError] Cleared errors for idea:', ideaId);
}

// Check if there are any errors for an idea
export function hasPanelErrors(ideaId: string): boolean {
  const errors = errorStore.get(ideaId);
  return errors !== undefined && errors.length > 0;
}

// Format errors for AI context - creates a message the AI can understand
export function formatErrorsForAI(ideaId: string): string | null {
  const errors = getPanelErrors(ideaId);
  if (errors.length === 0) {
    return null;
  }

  const errorDescriptions = errors.map((err, idx) => {
    const location = err.line ? ` at line ${err.line}${err.column ? `:${err.column}` : ''}` : '';
    const source = err.source ? ` in ${err.source}` : '';
    return `${idx + 1}. ${err.message}${source}${location}`;
  }).join('\n');

  return `The code you created has runtime errors in the preview panel. Please fix these errors:

${errorDescriptions}

Review the code files and fix the issues. Use the read_file and update_file or modify_file_lines tools to correct the errors.`;
}

// Get log file path for display
export function getPanelErrorLogPath(): string {
  return getLogFilePath();
}
