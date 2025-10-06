import { Ollama, type ChatRequest, type Tool, type ToolCall } from "ollama";
import { MCPClientManager, type MCPTool } from "./mcp-client.js";
import { type Message } from "ollama";

type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  name?: string;
};

interface CustomChatOptions extends ChatRequest {
  messages: Message[];
  stream: false;
  template?: string;
}

export class ChatHandler {
  private config: any;
  private ollama: Ollama;
  private mcpClientManager: MCPClientManager;

  constructor(config: any, ollama: Ollama, mcpClientManager: MCPClientManager) {
    this.config = config;
    this.ollama = ollama;
    this.mcpClientManager = mcpClientManager;
  }

  async initChat() {
    const ollamaTools = this.MCPToolToTool(
      await this.mcpClientManager.getAllTools()
    );

    const chatOptions: CustomChatOptions = {
      model: this.config.ollama?.model || "llama3.2",
      messages: [
        {
          role: "system",
          content:
            "You are an helpful assistant that is able to use tools. When calling a tool, only provide necessary parameters. If you don't need a parameter and it is not a mandatory parameter, then do not provide it to the tool.",
        },
      ],
      stream: false,
    };

    if (ollamaTools.length > 0) {
      console.log(JSON.stringify(ollamaTools[0], null, 2));
      chatOptions.tools = ollamaTools;
    }
    return chatOptions;
  }

  async handleNewChat(message: string): Promise<string> {
    if (!message) {
      throw new Error("Message is required");
    }
    const chatOptions = await this.initChat();

    chatOptions.messages.push({ role: "user", content: message });
    return this.generateAnswer(chatOptions);
  }

  async generateAnswer(chatOptions: CustomChatOptions): Promise<string> {
    const chatResponse = await this.ollama.chat(chatOptions);
    let toolCalls = chatResponse.message?.tool_calls || [];

    // Handle tool calls
    if (toolCalls.length > 0) {
      chatOptions.messages.push(chatResponse.message);
      const newMessages = await this.processToolCalls(toolCalls);
      chatOptions.messages = chatOptions.messages.concat(newMessages);
      return this.generateAnswer(chatOptions);
    }

    return chatResponse.message?.content || "";
  }

  private MCPToolToTool(mcpTools: MCPTool[]): Tool[] {
    return mcpTools.map((tool) => {
      return {
        type: "function",
        function: {
          name: `${tool.serverName}.${tool.name}`,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      };
    });
  }

  private async processToolCalls(
    toolCalls: ToolCall[]
  ): Promise<ChatMessage[]> {
    let messages = [] as ChatMessage[];
    const attributes = toolCalls.map((tool) => {
      const serverName = tool.function.name.split(".")[0] || "";
      const toolName = tool.function.name.split(".")[1] || "";
      return {
        serverName: serverName,
        toolName: toolName,
        args: this.filterToolArguments(
          tool.function.arguments,
          serverName,
          toolName
        ),
      };
    });

    for (const toolCall of attributes) {
      console.log("Tool call:", toolCall);
      if (!toolCall.serverName || !toolCall.toolName) {
        console.error(
          "Invalid tool call, missing serverName or toolName:",
          toolCall
        );
        continue;
      }
      const toolResult = await this.mcpClientManager.callTool(
        toolCall.serverName,
        toolCall.toolName,
        toolCall.args
      );
      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
      });
    }
    return messages;
  }

  private async filterToolArguments(
    args: any,
    serverName: string,
    toolName: string
  ): Promise<any> {
    // Filter out null/undefined values for optional parameters to avoid schema validation errors
    const filteredArgs = { ...args };
    const requiredParams =
      (await this.mcpClientManager.getTool(serverName, toolName))?.inputSchema
        .required || [];
    for (const [key, value] of Object.entries(filteredArgs)) {
      if (
        (value === null || value === undefined || value === "") &&
        !requiredParams.includes(key)
      ) {
        delete filteredArgs[key];
      }
    }
    return filteredArgs;
  }
}
