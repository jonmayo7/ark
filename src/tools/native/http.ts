// ============================================================================
// Ark — Native HTTP Fetch Tool
// ============================================================================

import type { RegisteredTool } from '../types.js';

export const httpFetchTool: RegisteredTool = {
  definition: {
    name: 'http_fetch',
    description: 'Fetch a URL and return its content. Supports GET/POST/PUT/DELETE.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default: GET)', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['url'],
    },
  },
  async execute(args) {
    const url = args.url as string;
    const method = (args.method as string) || 'GET';
    const timeout = (args.timeout as number) || 30000;

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: (args.headers as Record<string, string>) || {},
        signal: AbortSignal.timeout(timeout),
      };

      if (args.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = args.body as string;
      }

      const res = await fetch(url, fetchOptions);
      const contentType = res.headers.get('content-type') || '';
      let body: string;

      if (contentType.includes('application/json')) {
        const json = await res.json();
        body = JSON.stringify(json, null, 2);
      } else {
        body = await res.text();
      }

      // Truncate very large responses
      const maxLen = 50000;
      if (body.length > maxLen) {
        body = body.slice(0, maxLen) + `\n\n... (truncated, ${body.length} total chars)`;
      }

      return {
        content: `HTTP ${res.status} ${res.statusText}\n\n${body}`,
        is_error: res.status >= 400,
        metadata: {
          status: res.status,
          content_type: contentType,
          size: body.length,
        },
      };
    } catch (err) {
      return {
        content: `HTTP fetch failed: ${(err as Error).message}`,
        is_error: true,
      };
    }
  },
};
