import type { IncomingMessage, ServerResponse } from "node:http";
export function handle(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void>;
