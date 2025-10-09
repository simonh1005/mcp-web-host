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
          content: `You are a helpful assistant that can use tools to gather information and perform tasks. You should think step-by-step.
            When you call a tool, you will receive results that you should use to provide a complete and helpful answer to the user. It might be necessary to call multiple tools, e.g. for first getting a list of options, then after choosing an option getting more details about it. The use case is an universal chatbot that can answer questions and perform tasks using the available tools.
            IMPORTANT: After receiving tool results, you MUST use the data to directly answer the user's original question. Do not just describe the data structure or repeat the JSON. Instead:
            - If the user asks for a recipe suggestion, select one recipe from the list and present it nicely
            - If the user asks for information, extract and present the relevant details
            - Always provide a complete, user-friendly answer based on the tool results\n\nWhen calling a tool, only provide necessary parameters. 
            - If an tool response contains an array of items, you can choose one or more relevant items to include in your answer.
            - If you found any part of the response useful to the user, then include it in your answer in a user-friendly way. 
            - Do not present (raw or formatted) JSON or data structures. You are allows to markdown content like lists, bold, italic, etc.
            - The response of the tools are only meant as input for you. Use the information provided to come up with a complete answer to the user.
            - If you need more information from the user to provide a good answer, then ask the user for more details. You can also make assumptions if the user query is vague, but please mention your assumptions in your answer.
            If you don't need a parameter and it is not a mandatory parameter, then do not provide it to the tool.`,
        },
      ],
      stream: false,
      think: true,
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
        id: (tool as any).id,
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
        content: this.extractToolContent(toolResult),
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
