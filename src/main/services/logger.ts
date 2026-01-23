import log from 'electron-log/main';
import * as path from 'path';
import * as fs from 'fs';

// Initialize electron-log for IPC communication with renderer
log.initialize();

// Set log directory in project folder for easy access during development
// All app logs go here along with panel errors
const logDir = '/Users/mobinedvin/FishWallet/FishWallet/logs';

// Create logs directory if it doesn't exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Delete existing log file on startup for fresh logs each session
const logFilePath = path.join(logDir, 'main.log');
if (fs.existsSync(logFilePath)) {
  fs.unlinkSync(logFilePath);
}

// Set the log file path explicitly
log.transports.file.resolvePathFn = () => logFilePath;

// Set max log file size (10MB)
log.transports.file.maxSize = 10 * 1024 * 1024;

// Set log format
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

// Enable all log levels
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';

// Export configured logger
export const logger = log;

// Log the path on startup
logger.info('Logger initialized, writing to:', path.join(logDir, 'main.log'));

// Helper functions for structured logging
export function logApiRequest(context: string, data: unknown): void {
  logger.debug(`[${context}] API Request:`, JSON.stringify(data, null, 2));
}

export function logApiResponse(context: string, data: unknown): void {
  logger.debug(`[${context}] API Response:`, JSON.stringify(data, null, 2));
}

export function logApiError(context: string, error: unknown): void {
  logger.error(`[${context}] API Error:`, error);
}

export function logStreamEvent(context: string, eventType: string, data?: unknown): void {
  const dataStr = data ? `: ${JSON.stringify(data)}` : '';
  logger.debug(`[${context}] Stream Event [${eventType}]${dataStr}`);
}

export function logToolExecution(context: string, toolName: string, input: unknown, result?: unknown): void {
  logger.info(`[${context}] Tool [${toolName}] Input:`, JSON.stringify(input));
  if (result !== undefined) {
    logger.info(`[${context}] Tool [${toolName}] Result:`, JSON.stringify(result));
  }
}

export function logAssistantContent(context: string, content: unknown[]): void {
  logger.debug(`[${context}] Assistant Content Blocks:`, JSON.stringify(content, null, 2));
}

// Get the log file path for display purposes
export function getLogFilePath(): string {
  return logFilePath;
}
