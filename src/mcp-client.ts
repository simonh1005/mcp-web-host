import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Type for individual tools from MCP
export interface MCPTool {
  name: string;
  title?: string;
  description?: string;
  serverName: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPServer {
  name: string;
  url: string;
}

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private serverUrls: Map<string, string> = new Map();

  async initializeClients(servers: MCPServer[]) {
    for (const server of servers) {
      if (server.url) {
        try {
          const transport = new StreamableHTTPClientTransport(
            new URL(server.url)
          );

          const client = new Client({
            name: server.name,
            version: "1.0.0",
          });
          await client.connect(transport);

          this.clients.set(server.name, client);
          this.serverUrls.set(server.name, server.url);
          console.log(
            `Connected to MCP server: ${server.name} at ${server.url}`
          );
          /*           console.log(
            `  Tools Provided:` +
              JSON.stringify((await client.listTools()).tools, null, 2)
          ); */
        } catch (error) {
          console.error(
            `Failed to connect to MCP server ${server.name}:`,
            error
          );
        }
      }
    }
  }

  async getAllTools(): Promise<MCPTool[]> {
    const allTools: MCPTool[] = [];

    for (const [serverName, client] of this.clients) {
      // Type for the listTools response
      interface ListToolsResult {
        tools: MCPTool[];
        nextCursor?: string;
        _meta?: Record<string, any>;
      }
      try {
        const clientTools: MCPTool[] = (await client.listTools()).tools.map(
          (tool) => this.libraryToolToMCPTool(tool, serverName)
        );
        allTools.push(...clientTools);
      } catch (error) {
        console.error(`Failed to get tools from ${serverName}:`, error);
      }
    }

    return allTools;
  }

  async getTool(serverName: string, toolName: string): Promise<MCPTool | null> {
    const client = this.clients.get(serverName);
    if (!client) {
      console.error(`No client found for server: ${serverName}`);
      return null;
    }
    return (
      (await client.listTools()).tools
        .map((tool) => this.libraryToolToMCPTool(tool, serverName))
        .find((tool) => tool.name === toolName) || null
    );
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: any
  ): Promise<any> {
    console.log(
      `Calling tool ${toolName} on server ${serverName} with args:`,
      args
    );
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`No client found for server: ${serverName}`);
    }

    try {
      // Try SDK method first, fallback to HTTP
      const response: CallToolResult = (await client.callTool({
        name: toolName,
        arguments: args,
      })) as any as CallToolResult;

      return response.content;
      //return this.extractToolContent(response.content);
    } catch (error) {
      console.error(`Failed to call tool ${toolName} on ${serverName}:`, error);
      throw error;
    }
  }

  async disconnectAll() {
    this.clients.clear();
    console.log("Disconnected from all MCP servers");
  }

  private libraryToolToMCPTool(tool: Tool, serverName: string): MCPTool {
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      serverName: serverName,
      inputSchema: tool.inputSchema,
    };
  }

  private extractToolContent(content: any): string {
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      if (first.type === "text") {
        return first.text;
      } else if (first.type === "json") {
        return JSON.stringify(first.json);
      }
    }
    return JSON.stringify(content);
  }
}
