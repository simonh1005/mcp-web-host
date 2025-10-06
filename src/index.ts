import express, { type Request, type Response } from "express";
import { Ollama } from "ollama";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { MCPClientManager, type MCPServer } from "./mcp-client.js";
import { ChatHandler } from "./chat-handler.js";

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
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
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
