import express, { type Request, type Response } from "express";
import { Ollama } from "ollama";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { MCPClientManager, type MCPServer } from "./mcp-client.js";
import { ChatHandler } from "./chat-handler.js";
import { getDatabase, type ToolApproval } from "./database.js";

const app = express();
const port = process.env.PORT || 3001;

// Load configuration
const configPath = path.join(__dirname, "../config/config.yml");
let config: any = {};
try {
  const configFile = fs.readFileSync(configPath, "utf8");
  config = yaml.load(configFile) as any;
} catch (e) {
  console.warn("Config file not found, using defaults");
}

// Ollama client
const ollamaUrl = config.ollama?.url || "http://localhost:11434";
const ollama = new Ollama({ host: ollamaUrl });

// MCP client manager
const mcpClientManager = new MCPClientManager();

// Chat handler
const chatHandler = new ChatHandler(config, ollama, mcpClientManager);

// Initialize MCP clients
async function initializeMCPClients() {
  if (config.mcp?.servers) {
    await mcpClientManager.initializeClients(config.mcp.servers as MCPServer[]);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Chat endpoint
app.post("/chat", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    const response = await chatHandler.handleNewChat(message);
    res.json({ response });
  } catch (error: any) {
    console.error("Chat error:", error);

    // Check if this is an approval-required error
    if (error.requiresApproval && error.toolCall) {
      return res.status(200).json({
        requiresApproval: true,
        toolCall: error.toolCall,
        message: `Tool ${error.toolCall.serverName}.${error.toolCall.toolName} requires your approval to execute.`,
        serverName: error.toolCall.serverName,
        toolName: error.toolCall.toolName,
        arguments: error.toolCall.args,
      });
    }

    res.status(500).json({ error: "Failed to process chat" });
  }
});

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Tool approval management endpoints
const db = getDatabase();

// Get all tool approval settings
app.get("/api/tool-approvals", (req: Request, res: Response) => {
  try {
    const approvals = db.getAllToolApprovals();
    res.json({ approvals });
  } catch (error) {
    console.error("Error getting tool approvals:", error);
    res.status(500).json({ error: "Failed to get tool approvals" });
  }
});

// Get approval setting for a specific tool
app.get(
  "/api/tool-approvals/:serverName/:toolName",
  (req: Request, res: Response) => {
    try {
      const { serverName, toolName } = req.params;

      if (!serverName || !toolName) {
        return res
          .status(400)
          .json({ error: "serverName and toolName are required" });
      }

      const approval = db.getToolApproval(serverName, toolName);

      if (approval) {
        res.json({ approval });
      } else {
        res.status(404).json({ error: "Tool approval setting not found" });
      }
    } catch (error) {
      console.error("Error getting tool approval:", error);
      res.status(500).json({ error: "Failed to get tool approval" });
    }
  }
);

// Set approval setting for a tool
app.post("/api/tool-approvals", (req: Request, res: Response) => {
  try {
    const { serverName, toolName, requiresApproval } = req.body;

    if (!serverName || !toolName || typeof requiresApproval !== "boolean") {
      return res.status(400).json({
        error:
          "serverName, toolName, and requiresApproval (boolean) are required",
      });
    }

    db.setToolApproval(serverName, toolName, requiresApproval);
    const approval = db.getToolApproval(serverName, toolName);

    res.json({
      message: "Tool approval setting updated",
      approval,
    });
  } catch (error) {
    console.error("Error setting tool approval:", error);
    res.status(500).json({ error: "Failed to set tool approval" });
  }
});

// Delete approval setting for a tool
app.delete(
  "/api/tool-approvals/:serverName/:toolName",
  (req: Request, res: Response) => {
    try {
      const { serverName, toolName } = req.params;

      if (!serverName || !toolName) {
        return res
          .status(400)
          .json({ error: "serverName and toolName are required" });
      }

      db.deleteToolApproval(serverName, toolName);
      res.json({ message: "Tool approval setting deleted" });
    } catch (error) {
      console.error("Error deleting tool approval:", error);
      res.status(500).json({ error: "Failed to delete tool approval" });
    }
  }
);

// Get all available tools from MCP servers
app.get("/api/tools", async (req: Request, res: Response) => {
  try {
    const tools = await mcpClientManager.getAllTools();
    res.json({ tools });
  } catch (error) {
    console.error("Error getting tools:", error);
    res.status(500).json({ error: "Failed to get tools" });
  }
});

// Confirm and execute a tool that requires approval
app.post("/api/execute-tool", async (req: Request, res: Response) => {
  try {
    const { serverName, toolName, args } = req.body;

    if (!serverName || !toolName) {
      return res.status(400).json({
        error: "serverName and toolName are required",
      });
    }

    // Execute the tool
    const toolResult = await mcpClientManager.callTool(
      serverName,
      toolName,
      args || {}
    );

    res.json({
      message: "Tool executed successfully",
      result: toolResult,
    });
  } catch (error) {
    console.error("Error executing tool:", error);
    res.status(500).json({ error: "Failed to execute tool" });
  }
});

// Initialize MCP clients on startup
initializeMCPClients().catch((error) => {
  console.error("Failed to initialize MCP clients:", error);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await mcpClientManager.disconnectAll();
  process.exit(0);
});
