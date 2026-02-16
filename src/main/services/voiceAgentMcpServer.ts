// Voice Agent MCP Tool Server
// Provides DOM interaction tools for the voice-controlled app navigation agent
// These tools execute in the app preview iframe via webFrameMain

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { BrowserWindow } from 'electron';
import * as iframe from './iframeController';
import { logger } from './logger';

// Create the MCP server with DOM interaction tools for a given window
export function createVoiceAgentMcpServer(window: BrowserWindow) {
  // Helper: wrap a tool function with error handling
  const wrap = (fn: () => Promise<unknown>) =>
    async () => {
      try {
        const result = await fn();
        return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('[VoiceAgent] Tool error:', msg);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }] };
      }
    };

  const allTools = [
    tool(
      'read_page',
      'Read the current page DOM as a simplified HTML tree. Use this first to understand what is on the screen.',
      {},
      wrap(() => iframe.readDom(window))
    ),

    tool(
      'find_elements',
      'Find elements matching a CSS selector. Returns tag, text content, attributes, and index for each match.',
      { selector: z.string().describe('CSS selector (e.g. "button", ".login-btn", "input[type=email]")') },
      async (args) => wrap(() => iframe.querySelectorAll(window, args.selector as string))()
    ),

    tool(
      'click_element',
      'Click an element matching a CSS selector. Scrolls it into view first.',
      {
        selector: z.string().describe('CSS selector for the element to click'),
        index: z.number().optional().describe('Index if multiple elements match (0-based, default 0)')
      },
      async (args) => wrap(() => iframe.clickElement(window, args.selector as string, (args.index as number) || 0))()
    ),

    tool(
      'type_text',
      'Type text into an input or textarea element. Works with React controlled inputs.',
      {
        selector: z.string().describe('CSS selector for the input element'),
        text: z.string().describe('Text to type'),
        index: z.number().optional().describe('Index if multiple elements match (0-based, default 0)'),
        clear_first: z.boolean().optional().describe('Clear existing value before typing (default true)')
      },
      async (args) => wrap(() => iframe.typeText(
        window,
        args.selector as string,
        args.text as string,
        (args.index as number) || 0,
        args.clear_first !== false
      ))()
    ),

    tool(
      'scroll_page',
      'Scroll the page in a direction.',
      {
        direction: z.enum(['up', 'down', 'top', 'bottom']).describe('Scroll direction'),
        pixels: z.number().optional().describe('Number of pixels to scroll (default 400, ignored for top/bottom)')
      },
      async (args) => wrap(() => iframe.scrollPage(window, args.direction as 'up' | 'down' | 'top' | 'bottom', (args.pixels as number) || 400))()
    ),

    tool(
      'get_current_url',
      'Get the current URL of the app page.',
      {},
      wrap(() => iframe.getCurrentUrl(window))
    ),

    tool(
      'get_element_text',
      'Get the text content of an element matching a CSS selector.',
      {
        selector: z.string().describe('CSS selector for the element'),
        index: z.number().optional().describe('Index if multiple elements match (0-based, default 0)')
      },
      async (args) => wrap(() => iframe.getElementText(window, args.selector as string, (args.index as number) || 0))()
    ),

    tool(
      'wait',
      'Wait for a specified number of milliseconds before continuing.',
      { ms: z.number().describe('Milliseconds to wait (max 5000)') },
      async (args) => {
        const ms = Math.min((args.ms as number) || 1000, 5000);
        await new Promise(resolve => setTimeout(resolve, ms));
        return { content: [{ type: 'text' as const, text: `Waited ${ms}ms` }] };
      }
    )
  ];

  logger.info('[VoiceAgent] Creating MCP server', { toolCount: allTools.length });

  const server = createSdkMcpServer({
    name: 'voice-agent-tools',
    version: '1.0.0',
    tools: allTools
  });

  return server;
}
